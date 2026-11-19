/**
 * The AI assistant's settings, sources and chunks (ADR-0022). Scoped by a WorkspaceContext for people, and by
 * the workspace ID of a job for the indexing job, as dispatch is.
 *
 * A source's vectors live in Vectorize under the IDs of its chunks, `<source id>.<generation>.<n>`. A change to a
 * source bumps its generation and queues indexing through the outbox. Vectors of a generation no longer in use
 * are deleted through the outbox too, from the generation and count alone.
 */
import { newId } from '@openchat/shared';
import type { WorkspaceContext } from './context';
import { DB_NOW_MS, rawHandle, type Database } from './internal/handle';

export type AssistantSourceKind = 'page' | 'text';
export type AssistantSourceStatus = 'pending' | 'indexing' | 'ready' | 'failed';

export interface AssistantSettingsRow {
  id: string;
  websiteId: string;
  name: string;
  model: string | null;
  updatedAt: number;
}

export interface AssistantSourceRow {
  id: string;
  websiteId: string;
  kind: AssistantSourceKind;
  title: string;
  url: string | null;
  status: AssistantSourceStatus;
  errorCode: string | null;
  generation: number;
  indexedGeneration: number | null;
  chunkCount: number;
  pageCount: number;
  indexedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** What the indexing job reads: the source, with what it is allowed to fetch. */
export interface AssistantSourceForIndexing extends AssistantSourceRow {
  content: string | null;
  allowedOriginsJson: string;
}

export interface AssistantChunkRow {
  id: string;
  sourceId: string;
  title: string;
  url: string | null;
  content: string;
}

export interface NewAssistantChunk {
  id: string;
  title: string;
  url: string | null;
  content: string;
}

/** Vectors to delete: `count` chunks of one generation of one source. */
export interface AssistantVectorRange {
  sourceId: string;
  generation: number;
  count: number;
}

export const SOURCE_CHANGED_TOPIC = 'assistant.source_changed';
export const VECTORS_REMOVED_TOPIC = 'assistant.vectors_removed';

export const assistantChunkId = (sourceId: string, generation: number, n: number) => `${sourceId}.${generation}.${n}`;

const SETTINGS_COLUMNS = `id, website_id AS websiteId, name, model, updated_at AS updatedAt`;
const SOURCE_COLUMNS = `id, website_id AS websiteId, kind, title, url, status, error_code AS errorCode, generation,
  indexed_generation AS indexedGeneration, chunk_count AS chunkCount, page_count AS pageCount, indexed_at AS indexedAt,
  created_at AS createdAt, updated_at AS updatedAt`;

/** An outbox row asking for this generation to be indexed, written only if the source is at that generation. */
const queueIndexing = (d1: D1Database, workspaceId: string, sourceId: string) =>
  d1
    .prepare(
      `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
       SELECT ?3, ?1, '${SOURCE_CHANGED_TOPIC}', ?2, json_object('generation', generation), ${DB_NOW_MS}
         FROM assistant_sources WHERE workspace_id = ?1 AND id = ?2`,
    )
    .bind(workspaceId, sourceId, newId('outbox'));

/** An outbox row to delete the vectors of the generation in use, if any. Must run before that changes. */
const queueVectorRemoval = (d1: D1Database, workspaceId: string, sourceId: string, condition = '1') =>
  d1
    .prepare(
      `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
       SELECT ?3, ?1, '${VECTORS_REMOVED_TOPIC}', ?2, json_object('sourceId', id, 'generation', indexed_generation, 'count', chunk_count), ${DB_NOW_MS}
         FROM assistant_sources WHERE workspace_id = ?1 AND id = ?2 AND indexed_generation IS NOT NULL AND chunk_count > 0 AND ${condition}`,
    )
    .bind(workspaceId, sourceId, newId('outbox'));

export function assistantRepository(database: Database, ctx: WorkspaceContext) {
  const d1 = rawHandle(database);
  const w = ctx.workspaceId;
  const website = `EXISTS (SELECT 1 FROM websites WHERE workspace_id = ?1 AND id = ?2)`;

  return {
    async website(websiteId: string): Promise<{ id: string; name: string; allowedOrigins: string[] } | null> {
      const row = await d1
        .prepare(`SELECT id, name, allowed_origins_json AS originsJson FROM websites WHERE workspace_id = ?1 AND id = ?2`)
        .bind(w, websiteId)
        .first<{ id: string; name: string; originsJson: string }>();
      return row ? { id: row.id, name: row.name, allowedOrigins: JSON.parse(row.originsJson) as string[] } : null;
    },

    async settings(websiteId: string): Promise<AssistantSettingsRow | null> {
      return d1.prepare(`SELECT ${SETTINGS_COLUMNS} FROM assistant_settings WHERE workspace_id = ?1 AND website_id = ?2`).bind(w, websiteId).first<AssistantSettingsRow>();
    },

    /** Null if the website does not exist here. */
    async saveSettings(websiteId: string, input: { name: string; model: string | null }): Promise<AssistantSettingsRow | null> {
      return d1
        .prepare(
          `INSERT INTO assistant_settings (id, workspace_id, website_id, name, model, created_at, updated_at)
           SELECT ?3, ?1, ?2, ?4, ?5, ${DB_NOW_MS}, ${DB_NOW_MS} WHERE ${website}
           ON CONFLICT (workspace_id, website_id) DO UPDATE SET name = excluded.name, model = excluded.model, updated_at = excluded.updated_at
           RETURNING ${SETTINGS_COLUMNS}`,
        )
        .bind(w, websiteId, newId('assistant'), input.name, input.model)
        .first<AssistantSettingsRow>();
    },

    async listSources(websiteId: string): Promise<AssistantSourceRow[]> {
      const { results } = await d1
        .prepare(`SELECT ${SOURCE_COLUMNS} FROM assistant_sources WHERE workspace_id = ?1 AND website_id = ?2 ORDER BY created_at, id`)
        .bind(w, websiteId)
        .all<AssistantSourceRow>();
      return results;
    },

    async source(sourceId: string): Promise<(AssistantSourceRow & { content: string | null }) | null> {
      return d1
        .prepare(`SELECT ${SOURCE_COLUMNS}, content FROM assistant_sources WHERE workspace_id = ?1 AND id = ?2`)
        .bind(w, sourceId)
        .first<AssistantSourceRow & { content: string | null }>();
    },

    /**
     * 'missing' if the website does not exist here, 'full' at the limit. The outbox row is written in the same
     * batch, so that indexing cannot be lost between the two.
     */
    async createSource(
      websiteId: string,
      input: { kind: AssistantSourceKind; title: string; url: string | null; content: string | null },
      maxSources: number,
    ): Promise<AssistantSourceRow | 'missing' | 'full'> {
      const id = newId('assistantSource');
      const [inserted] = await d1.batch([
        d1
          .prepare(
            `INSERT INTO assistant_sources (id, workspace_id, website_id, kind, title, url, content, created_at, updated_at)
             SELECT ?3, ?1, ?2, ?4, ?5, ?6, ?7, ${DB_NOW_MS}, ${DB_NOW_MS}
              WHERE ${website} AND (SELECT COUNT(*) FROM assistant_sources WHERE workspace_id = ?1 AND website_id = ?2) < ?8`,
          )
          .bind(w, websiteId, id, input.kind, input.title, input.url, input.content, maxSources),
        queueIndexing(d1, w, id),
      ]);
      if (inserted!.meta.changes === 1) return (await this.source(id))!;
      return (await this.website(websiteId)) ? 'full' : 'missing';
    },

    /**
     * A new generation: of the same pages, or of new text. The vectors in use stay until it is indexed, so the
     * assistant keeps answering meanwhile. Null if there is no such source.
     */
    async reindexSource(sourceId: string, change: { title?: string | undefined; content?: string | undefined } = {}): Promise<AssistantSourceRow | null> {
      const [updated] = await d1.batch([
        d1
          .prepare(
            `UPDATE assistant_sources
                SET generation = generation + 1, status = 'pending', error_code = NULL, title = COALESCE(?3, title),
                    content = CASE WHEN kind = 'text' THEN COALESCE(?4, content) ELSE content END, updated_at = ${DB_NOW_MS}
              WHERE workspace_id = ?1 AND id = ?2`,
          )
          .bind(w, sourceId, change.title ?? null, change.content ?? null),
        queueIndexing(d1, w, sourceId),
      ]);
      if (updated!.meta.changes !== 1) return null;
      return this.source(sourceId);
    },

    /**
     * Its chunks go by cascade, and its vectors through the outbox. RETURNING, because D1 counts the cascaded
     * rows in `meta.changes`.
     */
    async deleteSource(sourceId: string): Promise<boolean> {
      const results = await d1.batch([
        queueVectorRemoval(d1, w, sourceId),
        d1.prepare(`DELETE FROM assistant_sources WHERE workspace_id = ?1 AND id = ?2 RETURNING id`).bind(w, sourceId),
      ]);
      return results[1]!.results.length === 1;
    },

    /** Chunks of this website only, in the order asked. A vector whose chunk is gone is left out. */
    async chunks(websiteId: string, ids: string[]): Promise<AssistantChunkRow[]> {
      if (ids.length === 0) return [];
      const { results } = await d1
        .prepare(
          `SELECT c.id, c.source_id AS sourceId, c.title, c.url, c.content
             FROM json_each(?3) j JOIN assistant_chunks c ON c.workspace_id = ?1 AND c.website_id = ?2 AND c.id = j.value
            ORDER BY j.key`,
        )
        .bind(w, websiteId, JSON.stringify(ids))
        .all<AssistantChunkRow>();
      return results;
    },

    /** Counts one answer against today's limit. False, and nothing counted, at the limit. */
    async takeAnswer(limit: number, day: string): Promise<boolean> {
      const row = await d1
        .prepare(
          `INSERT INTO assistant_usage (workspace_id, day, answers) VALUES (?1, ?2, 1)
           ON CONFLICT (workspace_id, day) DO UPDATE SET answers = answers + 1 WHERE answers < ?3
           RETURNING answers`,
        )
        .bind(w, day, limit)
        .first<{ answers: number }>();
      return row !== null && row.answers <= limit;
    },
  };
}

export type AssistantRepository = ReturnType<typeof assistantRepository>;

// ---------- For the indexing job, which has a workspace ID from its envelope and no user ----------

export async function assistantSourceForIndexing(database: Database, workspaceId: string, sourceId: string): Promise<AssistantSourceForIndexing | null> {
  return rawHandle(database)
    .prepare(
      `SELECT s.id, s.website_id AS websiteId, s.kind, s.title, s.url, s.status, s.error_code AS errorCode, s.generation,
              s.indexed_generation AS indexedGeneration, s.chunk_count AS chunkCount, s.page_count AS pageCount, s.indexed_at AS indexedAt,
              s.created_at AS createdAt, s.updated_at AS updatedAt, s.content, w.allowed_origins_json AS allowedOriginsJson
         FROM assistant_sources s JOIN websites w ON w.workspace_id = s.workspace_id AND w.id = s.website_id
        WHERE s.workspace_id = ?1 AND s.id = ?2`,
    )
    .bind(workspaceId, sourceId)
    .first<AssistantSourceForIndexing>();
}

/** False if the source has moved on to another generation, or is gone. */
export async function startAssistantIndexing(database: Database, workspaceId: string, sourceId: string, generation: number): Promise<boolean> {
  const result = await rawHandle(database)
    .prepare(`UPDATE assistant_sources SET status = 'indexing', updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND id = ?2 AND generation = ?3`)
    .bind(workspaceId, sourceId, generation)
    .run();
  return result.meta.changes === 1;
}

/** Chunks per statement: JSON of up to about 300 KB, well under D1's 2 MB for one value. */
const CHUNKS_PER_STATEMENT = 200;

/**
 * Puts a generation's chunks in use, in one batch, only if the source is still at that generation. Every statement
 * carries that condition, because a check in one statement does not guard the others. False if it has moved on,
 * and then the caller deletes the vectors it wrote.
 */
export async function finishAssistantIndexing(
  database: Database,
  workspaceId: string,
  sourceId: string,
  generation: number,
  result: { chunks: NewAssistantChunk[]; pageCount: number; day: string },
): Promise<boolean> {
  const d1 = rawHandle(database);
  const current = `EXISTS (SELECT 1 FROM assistant_sources WHERE workspace_id = ?1 AND id = ?2 AND generation = ?3)`;
  const inserts = [];
  for (let start = 0; start < result.chunks.length; start += CHUNKS_PER_STATEMENT) {
    inserts.push(
      d1
        .prepare(
          `INSERT INTO assistant_chunks (id, workspace_id, website_id, source_id, title, url, content, created_at)
           SELECT json_extract(j.value, '$.id'), ?1, s.website_id, ?2, json_extract(j.value, '$.title'), json_extract(j.value, '$.url'), json_extract(j.value, '$.content'), ${DB_NOW_MS}
             FROM json_each(?4) j JOIN assistant_sources s ON s.workspace_id = ?1 AND s.id = ?2 AND s.generation = ?3`,
        )
        .bind(workspaceId, sourceId, generation, JSON.stringify(result.chunks.slice(start, start + CHUNKS_PER_STATEMENT))),
    );
  }
  const statements = [
    // The generation in use until now, unless it is this one, which a retried job may have finished already.
    queueVectorRemoval(d1, workspaceId, sourceId, `generation = ${Number(generation)} AND indexed_generation <> ${Number(generation)}`),
    d1.prepare(`DELETE FROM assistant_chunks WHERE workspace_id = ?1 AND source_id = ?2 AND ${current}`).bind(workspaceId, sourceId, generation),
    ...inserts,
    d1
      .prepare(
        `UPDATE assistant_sources
            SET status = 'ready', error_code = NULL, indexed_generation = ?3, chunk_count = ?4, page_count = ?5, indexed_at = ${DB_NOW_MS}, updated_at = ${DB_NOW_MS}
          WHERE workspace_id = ?1 AND id = ?2 AND generation = ?3`,
      )
      .bind(workspaceId, sourceId, generation, result.chunks.length, result.pageCount),
    d1
      .prepare(
        `INSERT INTO assistant_usage (workspace_id, day, pages, chunks) SELECT ?1, ?4, ?5, ?6 WHERE ${current}
         ON CONFLICT (workspace_id, day) DO UPDATE SET pages = pages + excluded.pages, chunks = chunks + excluded.chunks`,
      )
      .bind(workspaceId, sourceId, generation, result.day, result.pageCount, result.chunks.length),
  ];
  const results = await d1.batch(statements);
  return results[statements.length - 2]!.meta.changes === 1;
}

/** The chunks in use stay: a page that cannot be read today keeps yesterday's answers. */
export async function failAssistantIndexing(database: Database, workspaceId: string, sourceId: string, generation: number, errorCode: string): Promise<void> {
  await rawHandle(database)
    .prepare(`UPDATE assistant_sources SET status = 'failed', error_code = ?4, updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND id = ?2 AND generation = ?3`)
    .bind(workspaceId, sourceId, generation, errorCode)
    .run();
}

/**
 * Page sources last read more than `olderThanMs` ago get a new generation, a few at a time. Each one is guarded
 * by the time it read, so an overlapping run cannot refresh one twice. Returns the workspace and source IDs, for
 * dispatch.
 */
export async function refreshStaleAssistantPages(database: Database, olderThanMs: number, limit: number): Promise<{ workspaceId: string; id: string }[]> {
  const d1 = rawHandle(database);
  const { results } = await d1
    .prepare(
      `SELECT workspace_id AS workspaceId, id, generation FROM assistant_sources
        WHERE kind = 'page' AND indexed_at < ${DB_NOW_MS} - ?1 AND status IN ('ready', 'failed') ORDER BY indexed_at LIMIT ?2`,
    )
    .bind(olderThanMs, limit)
    .all<{ workspaceId: string; id: string; generation: number }>();
  const refreshed = [];
  for (const row of results) {
    // Guarded by the generation it read, so that an overlapping run, or an admin's refresh, wins once.
    const [updated] = await d1.batch([
      d1
        .prepare(`UPDATE assistant_sources SET generation = generation + 1, status = 'pending', updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND id = ?2 AND generation = ?3`)
        .bind(row.workspaceId, row.id, row.generation),
      d1
        .prepare(
          `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
           SELECT ?3, ?1, '${SOURCE_CHANGED_TOPIC}', ?2, json_object('generation', generation), ${DB_NOW_MS}
             FROM assistant_sources WHERE workspace_id = ?1 AND id = ?2 AND generation = ?4 + 1 AND status = 'pending'`,
        )
        .bind(row.workspaceId, row.id, newId('outbox'), row.generation),
    ]);
    if (updated!.meta.changes === 1) refreshed.push({ workspaceId: row.workspaceId, id: row.id });
  }
  return refreshed;
}
