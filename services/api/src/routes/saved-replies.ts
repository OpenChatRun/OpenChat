import { createSavedReplyRoute, deleteSavedReplyRoute, listSavedRepliesRoute, updateSavedReplyRoute } from '@openchat/api-contracts';
import { createSavedReply, deleteSavedReply, listSavedReplies, updateSavedReply } from '@openchat/core';
import { workspaceContext } from '@openchat/core';
import type { Context } from 'hono';
import { authDeps, type App, type AppEnv } from '../context';

export function registerSavedReplyRoutes(app: App) {
  const scoped = async (c: Context<AppEnv>, workspaceId: string) => {
    const { db } = await authDeps(c.env);
    return { db, ctx: await workspaceContext(db, c.get('principal'), workspaceId) };
  };

  app.openapi(listSavedRepliesRoute, async (c) => {
    const { db, ctx } = await scoped(c, c.req.valid('param').workspaceId);
    return c.json(await listSavedReplies(db, ctx), 200);
  });

  app.openapi(createSavedReplyRoute, async (c) => {
    const { db, ctx } = await scoped(c, c.req.valid('param').workspaceId);
    return c.json(await createSavedReply(db, ctx, c.req.valid('json')), 201);
  });

  app.openapi(updateSavedReplyRoute, async (c) => {
    const { workspaceId, savedReplyId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await updateSavedReply(db, ctx, savedReplyId, c.req.valid('json')), 200);
  });

  app.openapi(deleteSavedReplyRoute, async (c) => {
    const { workspaceId, savedReplyId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    await deleteSavedReply(db, ctx, savedReplyId);
    return c.body(null, 204);
  });
}
