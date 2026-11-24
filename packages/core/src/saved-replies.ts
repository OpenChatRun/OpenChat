/** Saved replies. Every member reads them; supervisors write them. */
import { savedReplyRepository, type Database, type SavedReplyRow, type WorkspaceContext } from '@openchat/database';
import { AppError, notFound, toIso } from '@openchat/shared';
import { requireCapability } from './workspaces';

const toSavedReply = (row: SavedReplyRow) => ({ id: row.id, title: row.title, content: row.content, createdAt: toIso(row.createdAt), updatedAt: toIso(row.updatedAt) });
const duplicate = () => new AppError(409, 'saved_reply_exists', 'A saved reply with this title already exists');

export async function listSavedReplies(db: Database, ctx: WorkspaceContext) {
  return { data: (await savedReplyRepository(db, ctx).list()).map(toSavedReply) };
}

export async function createSavedReply(db: Database, ctx: WorkspaceContext, input: { title: string; content: string }) {
  requireCapability(ctx, 'savedReply.manage');
  const row = await savedReplyRepository(db, ctx).create(input);
  if (row === 'full') throw new AppError(409, 'too_many_saved_replies', 'This workspace has as many saved replies as it can have');
  if (row === 'duplicate') throw duplicate();
  return toSavedReply(row);
}

export async function updateSavedReply(db: Database, ctx: WorkspaceContext, id: string, change: { title?: string | undefined; content?: string | undefined }) {
  requireCapability(ctx, 'savedReply.manage');
  const row = await savedReplyRepository(db, ctx).update(id, change);
  if (row === 'duplicate') throw duplicate();
  if (!row) throw notFound();
  return toSavedReply(row);
}

export async function deleteSavedReply(db: Database, ctx: WorkspaceContext, id: string) {
  requireCapability(ctx, 'savedReply.manage');
  if (!(await savedReplyRepository(db, ctx).remove(id))) throw notFound();
}
