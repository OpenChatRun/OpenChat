import { completeSetupRoute, getSetupRoute } from '@openchat/api-contracts';
import { setupInstallation, setupStatus } from '@openchat/core';
import { setupDeps, type App } from '../context';

/** First-time setup in the browser, for an installation made with the Deploy to Cloudflare button. See ADR-0020. */
export function registerSetupRoutes(app: App) {
  app.openapi(getSetupRoute, async (c) => c.json({ status: await setupStatus(setupDeps(c.env)) }, 200));

  app.openapi(completeSetupRoute, async (c) => {
    const body = c.req.valid('json');
    await setupInstallation(setupDeps(c.env), { ...body, origin: new URL(c.req.url).origin, ip: c.req.header('cf-connecting-ip') ?? 'unknown' });
    return c.body(null, 204);
  });
}
