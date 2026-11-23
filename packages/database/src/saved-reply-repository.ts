/** Saved replies: text a team writes once and puts into the reply box often. One workspace's, like everything else. */
import { newId } from '@openchat/shared';
import { DB_NOW_MS, rawHandle, type Database } from './internal/handle';
import type { WorkspaceContext } from './context';

export interface SavedReplyRow {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export const MAX_SAVED_REPLIES = 200;
const COLUMNS = `id, title, content, created_at AS createdAt, updated_at AS updatedAt`;

/** A title is unique in its workspace, whatever its case. */
const isDuplicate = (error: unknown) => error instanceof Error && /UNIQUE constraint failed/i.test(error.message);

export function savedReplyRepository(database: Database, ctx: WorkspaceContext) {
  const d1 = rawHandle(database);
  const w = ctx.workspaceId;
  return {
    async list(): Promise<SavedReplyRow[]> {
      const { results } = await d1.prepare(`SELECT ${COLUMNS} FROM saved_replies WHERE workspace_id = ?1 ORDER BY title LIMIT ${MAX_SAVED_REPLIES}`).bind(w).all<SavedReplyRow>();
      return results;
    },
    /** 'full' at the limit, 'duplicate' when the title is taken. The limit is checked in the statement that inserts. */
    async create(input: { title: string; content: string }): Promise<SavedReplyRow | 'full' | 'duplicate'> {
      try {
        const row = await d1
          .prepare(
            `INSERT INTO saved_replies (id, workspace_id, title, content, created_at, updated_at)
             SELECT ?1, ?2, ?3, ?4, ${DB_NOW_MS}, ${DB_NOW_MS}
              WHERE (SELECT COUNT(*) FROM saved_replies WHERE workspace_id = ?2) < ${MAX_SAVED_REPLIES}
             RETURNING ${COLUMNS}`,
          )
          .bind(newId('savedReply'), w, input.title, input.content)
          .first<SavedReplyRow>();
        return row ?? 'full';
      } catch (error) {
        if (isDuplicate(error)) return 'duplicate';
        throw error;
      }
    },
    async update(id: string, change: { title?: string | undefined; content?: string | undefined }): Promise<SavedReplyRow | 'duplicate' | null> {
      try {
        return await d1
          .prepare(`UPDATE saved_replies SET title = COALESCE(?3, title), content = COALESCE(?4, content), updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND id = ?2 RETURNING ${COLUMNS}`)
          .bind(w, id, change.title ?? null, change.content ?? null)
          .first<SavedReplyRow>();
      } catch (error) {
        if (isDuplicate(error)) return 'duplicate';
        throw error;
      }
    },
    async remove(id: string): Promise<boolean> {
      const result = await d1.prepare(`DELETE FROM saved_replies WHERE workspace_id = ?1 AND id = ?2`).bind(w, id).run();
      return result.meta.changes === 1;
    },
  };
}
