/** The AI assistant's settings, sources and test panel (ADR-0022). Supervisors only, checked in @openchat/core. */
import {
  addAssistantSourceRoute,
  deleteAssistantSourceRoute,
  getAssistantRoute,
  saveAssistantSettingsRoute,
  testAssistantRoute,
  updateAssistantSourceRoute,
} from '@openchat/api-contracts';
import { addAssistantSource, deleteAssistantSource, getAssistant, saveAssistantSettings, testAssistant, updateAssistantSource, workspaceContext, type AssistantDeps } from '@openchat/core';
import { readAbuseLimits } from '@openchat/shared';
import type { Context } from 'hono';
import { assistantCanReply } from '../assistant/reply';
import { assistantRuntime } from '../assistant/runtime';
import { authDeps, type App, type AppEnv } from '../context';
import { dispatchSoon } from '../dispatch';

async function scoped(c: Context<AppEnv>, workspaceId: string): Promise<{ deps: AssistantDeps; ctx: Awaited<ReturnType<typeof workspaceContext>> }> {
  const { db } = await authDeps(c.env);
  return {
    deps: { db, runtime: assistantRuntime(c.env), limits: readAbuseLimits(c.env), defaultModel: c.env.ASSISTANT_MODEL, canReply: assistantCanReply(c.env) },
    ctx: await workspaceContext(db, c.get('principal'), workspaceId),
  };
}

/** Authentication comes from the /api/v1/workspaces/* prefix in routes/workspaces.ts. */
export function registerAssistantRoutes(app: App) {
  app.openapi(getAssistantRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    return c.json(await getAssistant(deps, ctx, websiteId), 200);
  });

  app.openapi(saveAssistantSettingsRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    return c.json(await saveAssistantSettings(deps, ctx, websiteId, c.req.valid('json')), 200);
  });

  app.openapi(addAssistantSourceRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    const source = await addAssistantSource(deps, ctx, websiteId, c.req.valid('json'));
    dispatchSoon(c, workspaceId, [source.id]);
    return c.json(source, 201);
  });

  app.openapi(updateAssistantSourceRoute, async (c) => {
    const { workspaceId, sourceId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    const source = await updateAssistantSource(deps, ctx, sourceId, c.req.valid('json'));
    dispatchSoon(c, workspaceId, [source.id]);
    return c.json(source, 200);
  });

  app.openapi(deleteAssistantSourceRoute, async (c) => {
    const { workspaceId, sourceId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    await deleteAssistantSource(deps, ctx, sourceId);
    dispatchSoon(c, workspaceId, [sourceId]);
    return c.body(null, 204);
  });

  app.openapi(testAssistantRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    return c.json(await testAssistant(deps, ctx, websiteId, c.req.valid('json').question), 200);
  });
}
