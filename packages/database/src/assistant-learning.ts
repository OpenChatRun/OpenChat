/**
 * Answers the AI assistant learns from resolved conversations (ADR-0022, step 3). A learned answer is one general
 * question and answer, never the conversation's messages. Only `approved` ones are used, and each keeps the ID of
 * its conversation, so that erasure and retention delete it, and its vector, with the conversation.
 *
 * Its vector's ID is `<id>.<generation>.0`, a one-chunk "source", so `assistant.vectors_removed` deletes it as it
 * deletes a source's. Approving, editing or rejecting bumps the generation; an index job puts the new one in use.
 */
import { newId } from '@openchat/shared';
import type { WorkspaceContext } from './context';
import { DB_NOW_MS, rawHandle, type Database } from './internal/handle';
import { VECTORS_REMOVED_TOPIC, assistantChunkId } from './assistant-repository';

export type AssistantLearnedStatus = 'pending' | 'approved' | 'rejected' | 'discarded';

export interface AssistantLearnedRow {
  id: string;
  websiteId: string;
  conversationId: string;
  question: string;
  answer: string;
  status: AssistantLearnedStatus;
  generation: number;
  indexedGeneration: number | null;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const LEARNED_CHANGED_TOPIC = 'assistant.learned_changed';

const LEARNED_COLUMNS = `id, website_id AS websiteId, conversation_id AS conversationId, question, answer, status, generation,
  indexed_generation AS indexedGeneration, decided_at AS decidedAt, created_at AS createdAt, updated_at AS updatedAt`;

/** The vector of a learned answer at a generation. */
export const learnedVectorId = (id: string, generation: number) => assistantChunkId(id, generation, 0);

/** An outbox row asking for the current generation to be indexed, if it is approved and not indexed yet. */
const queueLearnedIndexing = (d1: D1Database, workspaceId: string, where: string, ...binds: unknown[]) =>
  d1
    .prepare(
      `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
       SELECT ?1, workspace_id, '${LEARNED_CHANGED_TOPIC}', id, json_object('generation', generation), ${DB_NOW_MS}
         FROM assistant_learned WHERE workspace_id = ?2 AND status = 'approved' AND (indexed_generation IS NULL OR indexed_generation <> generation) AND ${where}`,
    )
    .bind(newId('outbox'), workspaceId, ...binds);

/** An outbox row to delete the vector in use, if there is one. Must run before the row changes. */
const queueLearnedRemoval = (d1: D1Database, workspaceId: string, id: string) =>
  d1
    .prepare(
      `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
       SELECT ?3, workspace_id, '${VECTORS_REMOVED_TOPIC}', id, json_object('sourceId', id, 'generation', indexed_generation, 'count', 1), ${DB_NOW_MS}
         FROM assistant_learned WHERE workspace_id = ?1 AND id = ?2 AND indexed_generation IS NOT NULL`,
    )
    .bind(workspaceId, id, newId('outbox'));

/**
 * For erasure and retention, in their batches, before the conversations go: one outbox row per learned answer
 * whose vector is in use. `conversations` is SQL naming the conversation IDs, `workspace` the workspace ID,
 * `aggregate` the aggregate the caller dispatches, so that these go with its own row, and `condition` must hold
 * too. The outbox ID is fixed by the answer and generation, so a repeat adds nothing.
 */
export function learnedVectorRemovalSql(workspace: string, conversations: string, aggregate: string, condition = '1'): string {
  return `INSERT OR IGNORE INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
    SELECT 'obx_learned_' || l.id || '_' || l.indexed_generation, l.workspace_id, '${VECTORS_REMOVED_TOPIC}', ${aggregate},
           json_object('sourceId', l.id, 'generation', l.indexed_generation, 'count', 1), ${DB_NOW_MS}
      FROM assistant_learned l
     WHERE l.workspace_id = ${workspace} AND l.conversation_id IN ${conversations} AND l.indexed_generation IS NOT NULL AND ${condition}`;
}

export function assistantLearningRepository(database: Database, ctx: WorkspaceContext) {
  const d1 = rawHandle(database);
  const w = ctx.workspaceId;

  return {
    async autoApprove(): Promise<boolean> {
      const row = await d1.prepare(`SELECT assistant_auto_approve AS value FROM workspaces WHERE id = ?1`).bind(w).first<{ value: number }>();
      return row?.value === 1;
    },

    /** Audited when it changes. */
    async setAutoApprove(value: boolean): Promise<void> {
      const differs = `(SELECT assistant_auto_approve FROM workspaces WHERE id = ?1) <> ?2`;
      await d1.batch([
        d1
          .prepare(
            `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, target_type, target_id, metadata_json, created_at)
             SELECT ?3, ?1, 'user', (SELECT user_id FROM workspace_members WHERE id = ?4), 'assistant.auto_approve_changed', 'workspace', ?1,
                    json_object('autoApprove', CAST(?2 AS INTEGER)), ${DB_NOW_MS}
              WHERE ${differs}`,
          )
          .bind(w, value ? 1 : 0, newId('audit'), ctx.memberId),
        d1.prepare(`UPDATE workspaces SET assistant_auto_approve = ?2, updated_at = ${DB_NOW_MS} WHERE id = ?1 AND ${differs}`).bind(w, value ? 1 : 0),
      ]);
    },

    /** Newest first. Discarded ones are never listed: there is nothing in them. */
    async list(websiteId: string, status: Exclude<AssistantLearnedStatus, 'discarded'>, limit: number): Promise<AssistantLearnedRow[]> {
      const { results } = await d1
        .prepare(`SELECT ${LEARNED_COLUMNS} FROM assistant_learned WHERE workspace_id = ?1 AND website_id = ?2 AND status = ?3 ORDER BY created_at DESC, id DESC LIMIT ?4`)
        .bind(w, websiteId, status, limit)
        .all<AssistantLearnedRow>();
      return results;
    },

    async counts(websiteId: string): Promise<Record<'pending' | 'approved' | 'rejected', number>> {
      const { results } = await d1
        .prepare(`SELECT status, COUNT(*) AS n FROM assistant_learned WHERE workspace_id = ?1 AND website_id = ?2 AND status <> 'discarded' GROUP BY status`)
        .bind(w, websiteId)
        .all<{ status: AssistantLearnedStatus; n: number }>();
      const counts = { pending: 0, approved: 0, rejected: 0 };
      for (const row of results) if (row.status !== 'discarded') counts[row.status] = row.n;
      return counts;
    },

    async get(id: string): Promise<AssistantLearnedRow | null> {
      return d1.prepare(`SELECT ${LEARNED_COLUMNS} FROM assistant_learned WHERE workspace_id = ?1 AND id = ?2 AND status <> 'discarded'`).bind(w, id).first<AssistantLearnedRow>();
    },

    /**
     * Approves or rejects, with the words as given. A new generation either way: the vector in use, if any, goes
     * through the outbox, and an approved one is indexed again. Null if there is no such answer.
     */
    async decide(id: string, input: { status: 'approved' | 'rejected'; question?: string | undefined; answer?: string | undefined }): Promise<AssistantLearnedRow | null> {
      const [, updated] = await d1.batch([
        queueLearnedRemoval(d1, w, id),
        d1
          .prepare(
            `UPDATE assistant_learned
                SET status = ?3, question = COALESCE(?4, question), answer = COALESCE(?5, answer), generation = generation + 1,
                    indexed_generation = NULL, decided_by_member_id = ?6, decided_at = ${DB_NOW_MS}, updated_at = ${DB_NOW_MS}
              WHERE workspace_id = ?1 AND id = ?2 AND status <> 'discarded'`,
          )
          .bind(w, id, input.status, input.question ?? null, input.answer ?? null, ctx.memberId),
        queueLearnedIndexing(d1, w, 'id = ?3', id),
      ]);
      if (updated!.meta.changes !== 1) return null;
      return this.get(id);
    },

    async remove(id: string): Promise<boolean> {
      const results = await d1.batch([queueLearnedRemoval(d1, w, id), d1.prepare(`DELETE FROM assistant_learned WHERE workspace_id = ?1 AND id = ?2 AND status <> 'discarded' RETURNING id`).bind(w, id)]);
      return results[1]!.results.length === 1;
    },
  };
}

export type AssistantLearningRepository = ReturnType<typeof assistantLearningRepository>;

// ---------- For the learning job, which has a workspace ID from its envelope and no user ----------

/** What the learning job needs to decide whether to read a conversation, in one query. */
export interface AssistantLearnContext {
  conversationId: string;
  websiteId: string;
  websiteName: string;
  status: string;
  lastMessageSeq: number;
  learn: number | null;
  model: string | null;
  contactName: string | null;
  contactEmail: string | null;
  autoApprove: number;
  /** The learned answer already here, if any. */
  learnedStatus: AssistantLearnedStatus | null;
  learnedSeq: number | null;
}

export async function assistantLearnContext(database: Database, workspaceId: string, conversationId: string): Promise<AssistantLearnContext | null> {
  return rawHandle(database)
    .prepare(
      `SELECT c.id AS conversationId, c.website_id AS websiteId, ws.name AS websiteName, c.status, c.last_message_seq AS lastMessageSeq, s.learn, s.model,
              ct.name AS contactName, ct.email AS contactEmail, w.assistant_auto_approve AS autoApprove,
              l.status AS learnedStatus, l.learned_seq AS learnedSeq
         FROM conversations c
         JOIN workspaces w ON w.id = c.workspace_id
         JOIN websites ws ON ws.workspace_id = c.workspace_id AND ws.id = c.website_id
         LEFT JOIN contacts ct ON ct.workspace_id = c.workspace_id AND ct.id = c.contact_id
         LEFT JOIN assistant_settings s ON s.workspace_id = c.workspace_id AND s.website_id = c.website_id
         LEFT JOIN assistant_learned l ON l.workspace_id = c.workspace_id AND l.conversation_id = c.id
        WHERE c.workspace_id = ?1 AND c.id = ?2`,
    )
    .bind(workspaceId, conversationId)
    .first<AssistantLearnContext>();
}

/**
 * What the visitor and the team wrote, oldest first, and the team's names. The visitor's messages and members'
 * replies only: the query cannot return an internal note, a system message, or the assistant's own answers, and
 * its type has nowhere to put one.
 */
export async function assistantLearnTranscript(
  database: Database,
  workspaceId: string,
  conversationId: string,
  limit: number,
): Promise<{ messages: { from: 'visitor' | 'team'; content: string }[]; teamNames: string[] }> {
  const { results } = await rawHandle(database)
    .prepare(
      `SELECT CASE WHEN m.sender_type = 'visitor' THEN 'visitor' ELSE 'team' END AS "from", m.content, u.name AS memberName
         FROM messages m
         LEFT JOIN workspace_members wm ON m.sender_type = 'member' AND wm.workspace_id = m.workspace_id AND wm.id = m.sender_id
         LEFT JOIN users u ON u.id = wm.user_id
        WHERE m.workspace_id = ?1 AND m.conversation_id = ?2 AND m.visibility = 'public' AND m.message_type IN ('text', 'image', 'file')
          AND m.sender_type IN ('visitor', 'member') AND m.assistant_id IS NULL AND m.content <> ''
        ORDER BY m.seq DESC LIMIT ?3`,
    )
    .bind(workspaceId, conversationId, limit)
    .all<{ from: 'visitor' | 'team'; content: string; memberName: string | null }>();
  const teamNames = [...new Set(results.map((r) => r.memberName).filter((name): name is string => !!name))];
  return { messages: results.reverse().map((r) => ({ from: r.from, content: r.content })), teamNames };
}

/**
 * Saves what was learned from a conversation, or that nothing was. Written only while the conversation is resolved
 * and the website still learns, and never over a decision a supervisor made or over something learned from as
 * many messages. An approved one is queued for indexing in the same batch. Its ID if it was written, for dispatch.
 */
export async function saveAssistantLearned(
  database: Database,
  workspaceId: string,
  input: {
    conversationId: string;
    learnedSeq: number;
    question: string;
    answer: string;
    status: 'pending' | 'approved' | 'discarded';
    discardReason?: string | undefined;
  },
): Promise<string | null> {
  const d1 = rawHandle(database);
  const [saved] = await d1.batch([
    d1
      .prepare(
        `INSERT INTO assistant_learned (id, workspace_id, website_id, conversation_id, question, answer, status, discard_reason, learned_seq, created_at, updated_at)
         SELECT ?3, c.workspace_id, c.website_id, c.id, ?4, ?5, ?6, ?7, ?8, ${DB_NOW_MS}, ${DB_NOW_MS}
           FROM conversations c JOIN assistant_settings s ON s.workspace_id = c.workspace_id AND s.website_id = c.website_id AND s.learn = 1
          WHERE c.workspace_id = ?1 AND c.id = ?2 AND c.status = 'resolved'
         ON CONFLICT (workspace_id, conversation_id) DO UPDATE
            SET question = excluded.question, answer = excluded.answer, status = excluded.status, discard_reason = excluded.discard_reason,
                learned_seq = excluded.learned_seq, generation = generation + 1, updated_at = excluded.updated_at
          WHERE assistant_learned.status IN ('pending', 'discarded') AND assistant_learned.learned_seq < excluded.learned_seq`,
      )
      .bind(workspaceId, input.conversationId, newId('assistantLearned'), input.question, input.answer, input.status, input.discardReason ?? null, input.learnedSeq),
    queueLearnedIndexing(d1, workspaceId, 'conversation_id = ?3 AND learned_seq = ?4', input.conversationId, input.learnedSeq),
  ]);
  if (saved!.meta.changes !== 1) return null;
  const row = await d1.prepare(`SELECT id FROM assistant_learned WHERE workspace_id = ?1 AND conversation_id = ?2`).bind(workspaceId, input.conversationId).first<{ id: string }>();
  return row?.id ?? null;
}

export async function assistantLearnedForIndexing(database: Database, workspaceId: string, id: string): Promise<AssistantLearnedRow | null> {
  return rawHandle(database).prepare(`SELECT ${LEARNED_COLUMNS} FROM assistant_learned WHERE workspace_id = ?1 AND id = ?2`).bind(workspaceId, id).first<AssistantLearnedRow>();
}

/** Puts a generation's vector in use, if the answer is still approved at that generation. False if it moved on. */
export async function finishLearnedIndexing(database: Database, workspaceId: string, id: string, generation: number): Promise<boolean> {
  const result = await rawHandle(database)
    .prepare(`UPDATE assistant_learned SET indexed_generation = ?3, updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND id = ?2 AND generation = ?3 AND status = 'approved'`)
    .bind(workspaceId, id, generation)
    .run();
  return result.meta.changes === 1;
}
