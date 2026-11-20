/** The help centre, for members (ADR-0023). Any member reads; supervisors change it, checked in @openchat/core. */
import {
  createHelpArticleRoute,
  createHelpDraftRunRoute,
  startHelpDraftRunRoute,
  uploadHelpDraftFileRoute,
  createHelpCollectionRoute,
  deleteHelpArticleRoute,
  deleteHelpAssetRoute,
  deleteHelpCollectionRoute,
  getHelpArticleRoute,
  getHelpCentreRoute,
  saveHelpSettingsRoute,
  setHelpArticleStatusRoute,
  updateHelpArticleRoute,
  updateHelpCollectionRoute,
  uploadHelpAssetRoute,
} from '@openchat/api-contracts';
import {
  assertAttachmentContent,
  checkHelpAsset,
  checkHelpDraftFile,
  createHelpDraftRun,
  getHelpDraftRun,
  helpDraftFileType,
  helpDraftPrefix,
  recordHelpDraftFile,
  startHelpDraftRun,
  type HelpDraftDeps,
  cleanAttachmentFilename,
  createHelpArticle,
  createHelpCollection,
  deleteHelpArticle,
  deleteHelpAsset,
  deleteHelpCollection,
  getHelpArticle,
  getHelpCentre,
  helpAssetKey,
  recordHelpAsset,
  saveHelpSettings,
  setHelpArticleStatus,
  updateHelpArticle,
  updateHelpCollection,
  workspaceContext,
} from '@openchat/core';
import { AppError, newId, readAbuseLimits } from '@openchat/shared';
import type { Context } from 'hono';
import { textRuntime } from '../assistant/runtime';
import { dispatchSoon } from '../dispatch';
import { authDeps, type App, type AppEnv } from '../context';

const draftDeps = (c: Context<AppEnv>, db: HelpDraftDeps['db']): HelpDraftDeps => ({ db, runtime: textRuntime(c.env), limits: readAbuseLimits(c.env), defaultModel: c.env.ASSISTANT_MODEL });

async function scoped(c: Context<AppEnv>, workspaceId: string) {
  const { db } = await authDeps(c.env);
  return { db, ctx: await workspaceContext(db, c.get('principal'), workspaceId) };
}

/** Authentication comes from the /api/v1/workspaces/* prefix in routes/workspaces.ts. */
export function registerHelpRoutes(app: App) {
  app.openapi(getHelpCentreRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await getHelpCentre(db, ctx, websiteId, { canDraft: textRuntime(c.env) !== null }), 200);
  });

  app.openapi(saveHelpSettingsRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await saveHelpSettings(db, ctx, websiteId, c.req.valid('json')), 200);
  });

  app.openapi(createHelpCollectionRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await createHelpCollection(db, ctx, websiteId, c.req.valid('json')), 201);
  });

  app.openapi(updateHelpCollectionRoute, async (c) => {
    const { workspaceId, collectionId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await updateHelpCollection(db, ctx, collectionId, c.req.valid('json')), 200);
  });

  app.openapi(deleteHelpCollectionRoute, async (c) => {
    const { workspaceId, collectionId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    await deleteHelpCollection(db, ctx, collectionId);
    return c.body(null, 204);
  });

  app.openapi(createHelpArticleRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await createHelpArticle(db, ctx, websiteId, c.req.valid('json')), 201);
  });

  app.openapi(getHelpArticleRoute, async (c) => {
    const { workspaceId, articleId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await getHelpArticle(db, ctx, articleId), 200);
  });

  app.openapi(updateHelpArticleRoute, async (c) => {
    const { workspaceId, articleId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await updateHelpArticle(db, ctx, articleId, c.req.valid('json')), 200);
  });

  app.openapi(setHelpArticleStatusRoute, async (c) => {
    const { workspaceId, articleId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await setHelpArticleStatus(db, ctx, articleId, c.req.valid('json').status), 200);
  });

  app.openapi(deleteHelpArticleRoute, async (c) => {
    const { workspaceId, articleId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    await deleteHelpArticle(db, ctx, articleId);
    return c.body(null, 204);
  });

  app.openapi(uploadHelpAssetRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const declared = Number(c.req.header('content-length'));
    await checkHelpAsset(db, ctx, websiteId, { contentType, sizeBytes: declared });
    const filename = cleanAttachmentFilename(c.req.valid('query').filename);
    // At most 5 MB, so it is read whole: the length and the first bytes are both checked before anything is stored.
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length !== declared) throw new AppError(400, 'validation_failed', 'The image is not the size it said');
    assertAttachmentContent(contentType, bytes.subarray(0, 512));
    const id = newId('helpAsset');
    await c.env.ATTACHMENTS.put(helpAssetKey(id), bytes, { httpMetadata: { contentType } });
    const asset = await recordHelpAsset(db, ctx, websiteId, { id, contentType, sizeBytes: bytes.length, filename });
    if (!asset) {
      await c.env.ATTACHMENTS.delete(helpAssetKey(id));
      throw new AppError(409, 'too_many_assets', 'This help centre has as many images as it can have');
    }
    return c.json(asset, 201);
  });

  app.openapi(deleteHelpAssetRoute, async (c) => {
    const { workspaceId, assetId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    await deleteHelpAsset(db, ctx, assetId);
    // After the row: a failure here leaves a file nothing points to, never a row with no file.
    await c.env.ATTACHMENTS.delete(helpAssetKey(assetId));
    return c.body(null, 204);
  });

  app.openapi(createHelpDraftRunRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    return c.json(await createHelpDraftRun(draftDeps(c, db), ctx, websiteId, c.req.valid('json')), 201);
  });

  app.openapi(uploadHelpDraftFileRoute, async (c) => {
    const { workspaceId, runId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    const deps = draftDeps(c, db);
    const declared = Number(c.req.header('content-length'));
    const { index } = await checkHelpDraftFile(deps, ctx, runId, declared);
    const name = cleanAttachmentFilename(c.req.valid('query').filename);
    // At most 10 MB, so it is read whole, and its length and first bytes are checked before it is stored.
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length !== declared) throw new AppError(400, 'validation_failed', 'The file is not the size it said');
    const { contentType } = helpDraftFileType(name, bytes.subarray(0, 512));
    const key = `${helpDraftPrefix(runId)}file-${index}`;
    await c.env.ATTACHMENTS.put(key, bytes, { httpMetadata: { contentType } });
    if (!(await recordHelpDraftFile(deps, ctx, runId, index, { name, contentType, sizeBytes: bytes.length }))) {
      await c.env.ATTACHMENTS.delete(key);
      throw new AppError(409, 'draft_started', 'This draft has started already, or took another file at the same time');
    }
    return c.json(await getHelpDraftRun(deps, ctx, runId), 201);
  });

  app.openapi(startHelpDraftRunRoute, async (c) => {
    const { workspaceId, runId } = c.req.valid('param');
    const { db, ctx } = await scoped(c, workspaceId);
    const run = await startHelpDraftRun(draftDeps(c, db), ctx, runId);
    dispatchSoon(c, workspaceId, [runId]);
    return c.json(run, 200);
  });
}
