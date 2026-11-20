/**
 * Published help articles as a source for the AI assistant (ADR-0023, step 4), as learned answers are: no
 * assistant_sources row, chunks of their own, and vectors named `<article>.<version>.<n>` so that the sources'
 * removal deletes them too.
 *
 * A website's articles are brought up to date by one sync job, queued through the outbox when an article is published
 * or a published one changes, and when the assistant's settings are saved. Only websites with the assistant are
 * synced. Unpublishing or deleting queues the removal of the article's vectors in the same batch.
 */
import { newId } from '@openchat/shared';
import { HELP_ASSISTANT_SYNC_TOPIC, VECTORS_REMOVED_TOPIC } from './assistant-repository';
import type { WorkspaceContext } from './context';
import { DB_NOW_MS, rawHandle, type Database } from './internal/handle';

/** Articles a sync looks at in one job. More are taken by the next sync. */
const SYNC_LIMIT = 1000;
/** Chunks per statement, as for sources. */
const CHUNKS_PER_STATEMENT = 200;

/**
 * An outbox row to sync the website of article ?2, if it has the assistant and `condition` holds. `condition` is SQL
 * on help_articles, with ?1 the workspace, ?2 the article, and ?3 onwards `params`. The row's aggregate is the
 * article, so that the route that changed it dispatches it; the website is in the payload.
 */
export const queueHelpAssistantSync = (d1: D1Database, workspaceId: string, articleId: string, condition: string, ...params: unknown[]) =>
  d1
    .prepare(
      `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
       SELECT ?${params.length + 3}, ?1, '${HELP_ASSISTANT_SYNC_TOPIC}', a.id, json_object('websiteId', a.website_id), ${DB_NOW_MS}
         FROM help_articles a WHERE a.workspace_id = ?1 AND a.id = ?2 AND ${condition}
          AND EXISTS (SELECT 1 FROM assistant_settings s WHERE s.workspace_id = ?1 AND s.website_id = a.website_id)`,
    )
    .bind(workspaceId, articleId, ...params, newId('outbox'));

/**
 * The statements that take an article out of the assistant: its vectors through the outbox, then its chunks, then
 * the record of them. `condition` is SQL on help_articles, with ?1 the workspace and ?2 the article.
 */
export const helpArticleUnindexStatements = (d1: D1Database, workspaceId: string, articleId: string, condition = '1') => [
  d1
    .prepare(
      `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
       SELECT ?3, ?1, '${VECTORS_REMOVED_TOPIC}', id, json_object('sourceId', id, 'generation', indexed_version, 'count', indexed_chunks), ${DB_NOW_MS}
         FROM help_articles WHERE workspace_id = ?1 AND id = ?2 AND indexed_version IS NOT NULL AND indexed_chunks > 0 AND ${condition}`,
    )
    .bind(workspaceId, articleId, newId('outbox')),
  d1
    .prepare(`DELETE FROM help_article_chunks WHERE workspace_id = ?1 AND article_id = ?2 AND EXISTS (SELECT 1 FROM help_articles WHERE workspace_id = ?1 AND id = ?2 AND ${condition})`)
    .bind(workspaceId, articleId),
  d1.prepare(`UPDATE help_articles SET indexed_version = NULL, indexed_chunks = 0 WHERE workspace_id = ?1 AND id = ?2 AND ${condition}`).bind(workspaceId, articleId),
];

// ---------- For the jobs, which have a workspace ID from their envelope and no user ----------

/** Published articles of a website with the assistant whose copy is not of their current version. */
export async function helpArticlesToIndex(database: Database, workspaceId: string, websiteId: string): Promise<{ id: string; version: number }[]> {
  const { results } = await rawHandle(database)
    .prepare(
      `SELECT a.id, a.version FROM help_articles a
        WHERE a.workspace_id = ?1 AND a.website_id = ?2 AND a.status = 'published' AND a.indexed_version IS NOT a.version
          AND EXISTS (SELECT 1 FROM assistant_settings s WHERE s.workspace_id = ?1 AND s.website_id = ?2)
        ORDER BY a.id LIMIT ${SYNC_LIMIT}`,
    )
    .bind(workspaceId, websiteId)
    .all<{ id: string; version: number }>();
  return results;
}

export interface HelpArticleForIndexing {
  id: string;
  websiteId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  version: number;
  publicBaseUrl: string;
}

/** The article, only while it is published at `version`. */
export async function helpArticleForIndexing(database: Database, workspaceId: string, articleId: string, version: number): Promise<HelpArticleForIndexing | null> {
  return rawHandle(database)
    .prepare(
      `SELECT a.id, a.website_id AS websiteId, a.title, a.summary, a.body_markdown AS bodyMarkdown, a.version,
              (SELECT public_base_url FROM installation LIMIT 1) AS publicBaseUrl
         FROM help_articles a WHERE a.workspace_id = ?1 AND a.id = ?2 AND a.version = ?3 AND a.status = 'published'`,
    )
    .bind(workspaceId, articleId, version)
    .first<HelpArticleForIndexing>();
}

/**
 * Puts a version's chunks in use, only if the article is still published at that version: every statement carries
 * the condition. False if not, and then the caller deletes the vectors it wrote.
 */
export async function finishHelpArticleIndexing(database: Database, workspaceId: string, articleId: string, version: number, chunks: { id: string; content: string }[], day: string): Promise<boolean> {
  const d1 = rawHandle(database);
  const current = `EXISTS (SELECT 1 FROM help_articles WHERE workspace_id = ?1 AND id = ?2 AND version = ?3 AND status = 'published')`;
  const inserts = [];
  for (let start = 0; start < chunks.length; start += CHUNKS_PER_STATEMENT) {
    inserts.push(
      d1
        .prepare(
          `INSERT INTO help_article_chunks (id, workspace_id, website_id, article_id, content, created_at)
           SELECT json_extract(j.value, '$.id'), ?1, a.website_id, ?2, json_extract(j.value, '$.content'), ${DB_NOW_MS}
             FROM json_each(?4) j JOIN help_articles a ON a.workspace_id = ?1 AND a.id = ?2 AND a.version = ?3 AND a.status = 'published'`,
        )
        .bind(workspaceId, articleId, version, JSON.stringify(chunks.slice(start, start + CHUNKS_PER_STATEMENT))),
    );
  }
  const statements = [
    // The copy in use until now, unless it is this one, which a retried job may have finished already.
    helpArticleUnindexStatements(d1, workspaceId, articleId, `version = ${Number(version)} AND status = 'published' AND indexed_version <> ${Number(version)}`)[0]!,
    d1.prepare(`DELETE FROM help_article_chunks WHERE workspace_id = ?1 AND article_id = ?2 AND ${current}`).bind(workspaceId, articleId, version),
    ...inserts,
    d1
      .prepare(`UPDATE help_articles SET indexed_version = ?3, indexed_chunks = ?4 WHERE workspace_id = ?1 AND id = ?2 AND version = ?3 AND status = 'published'`)
      .bind(workspaceId, articleId, version, chunks.length),
    d1
      .prepare(
        `INSERT INTO assistant_usage (workspace_id, day, pages, chunks) SELECT ?1, ?4, 0, ?5 WHERE ${current}
         ON CONFLICT (workspace_id, day) DO UPDATE SET chunks = chunks + excluded.chunks`,
      )
      .bind(workspaceId, articleId, version, day, chunks.length),
  ];
  const results = await d1.batch(statements);
  return results[statements.length - 2]!.meta.changes === 1;
}

/** For the assistant page: published articles of a website, and how many the assistant answers from. */
export async function helpAssistantCounts(database: Database, ctx: WorkspaceContext, websiteId: string): Promise<{ published: number; inUse: number }> {
  const row = await rawHandle(database)
    .prepare(
      `SELECT COUNT(*) AS published, COALESCE(SUM(indexed_version = version), 0) AS inUse
         FROM help_articles WHERE workspace_id = ?1 AND website_id = ?2 AND status = 'published'`,
    )
    .bind(ctx.workspaceId, websiteId)
    .first<{ published: number; inUse: number }>();
  return { published: row?.published ?? 0, inUse: row?.inUse ?? 0 };
}
