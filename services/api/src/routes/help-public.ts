/**
 * The public help centre (ADR-0023): HTML pages at /help/<slug>, a sitemap, and images at /help-assets/<id>.
 * These are pages, not API, so they are not in the OpenAPI contract. No sign-in, no cookie.
 *
 * Pages are cached with the Cache API under the website's help_version, which every visible change bumps, so a
 * change shows at once. Browsers revalidate with an ETag of that version. Requests that reach the database are
 * rate-limited per IP.
 */
import {
  enforce,
  findHelpSite,
  helpArticlePage,
  helpAssetKey,
  helpAssetInfo,
  helpHome,
  helpLanguageFromPath,
  helpLanguages,
  helpSitemap,
  limitKeyForIp,
  pickHelpLanguage,
  searchHelp,
  type HelpSite,
} from '@openchat/core';
import { HELP_LANGUAGES, readAbuseLimits } from '@openchat/shared';
import type { Context } from 'hono';
import { HSTS } from '../app-headers';
import { limiterFor, publicDatabase, type App, type AppEnv } from '../context';
import { articlePage, helpHomePath, HELP_PAGE_CSP, homePage, notFoundPage, searchPage, sitemapXml } from '../help/pages';

/** Requests per IP per minute that reach the database. Cached pages do not count. */
export const HELP_PAGE_LIMIT = { limit: 300, windowSeconds: 60 };
/** How long the edge keeps a page. Any change makes a new key, so this only bounds storage. */
const EDGE_SECONDS = 7 * 24 * 60 * 60;

const pageHeaders = (site: HelpSite, extra: Record<string, string> = {}): Record<string, string> => ({
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': HELP_PAGE_CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': HSTS,
  ...(site.helpNoindex ? { 'x-robots-tag': 'noindex' } : {}),
  ...extra,
});

async function limit(c: Context<AppEnv>): Promise<void> {
  const limits = readAbuseLimits(c.env);
  await enforce(limiterFor(c.env), await limitKeyForIp({ limits }, 'help-page-ip', c.req.header('cf-connecting-ip') ?? 'unknown'), HELP_PAGE_LIMIT);
}

function waitUntil(c: Context<AppEnv>, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise.catch(() => undefined));
  } catch {
    // No execution context, as in some tests: the page is simply not cached.
  }
}

/**
 * A cached page, or a new one. The key carries the help version; the ETag is that version, so a browser that has
 * the page is told so without the page being built.
 */
async function cachedPage(c: Context<AppEnv>, site: HelpSite, build: () => Promise<{ status: number; html: string }>): Promise<Response> {
  // The website as well as the version: an address can pass from one website to another, and versions are per website.
  const etag = `W/"${site.websiteId}-${site.helpVersion}"`;
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-cache' } });
  const url = new URL(c.req.url);
  url.search = `?site=${site.websiteId}&v=${site.helpVersion}`;
  const key = new Request(url.toString());
  const cache = typeof caches === 'undefined' ? null : (caches as unknown as { default: Cache }).default;
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return new Response(hit.body, { status: hit.status, headers: pageHeaders(site, { etag, 'cache-control': 'no-cache' }) });

  await limit(c);
  const { status, html } = await build();
  if (cache && status === 200) {
    waitUntil(c, cache.put(key, new Response(html, { status, headers: pageHeaders(site, { 'cache-control': `public, s-maxage=${EDGE_SECONDS}` }) })));
  }
  return new Response(html, { status, headers: pageHeaders(site, status === 200 ? { etag, 'cache-control': 'no-cache' } : { 'cache-control': 'no-store' }) });
}

const notFoundText = (c: Context<AppEnv>) => c.text('Not found', 404, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });

/** The language of the strings on a page with no articles to choose from. */
const fallbackLanguage = (c: Context<AppEnv>) => pickHelpLanguage(c.req.header('accept-language'), [...HELP_LANGUAGES]) ?? 'en';

export function registerHelpPublicRoutes(app: App) {
  const db = (c: Context<AppEnv>) => publicDatabase(c.env);

  async function siteOr404(c: Context<AppEnv>): Promise<HelpSite | null> {
    return findHelpSite(db(c), c.req.param('slug') ?? '');
  }

  /** Chooses the visitor's language. Not cached: it depends on the browser. */
  app.get('/help/:slug', async (c) => {
    const site = await siteOr404(c);
    if (!site) return notFoundText(c);
    await limit(c);
    const languages = await helpLanguages(db(c), site);
    const language = pickHelpLanguage(c.req.header('accept-language'), languages);
    if (language) return c.redirect(helpHomePath(site, language), 302);
    const html = homePage({ site, language: fallbackLanguage(c), languages, origin: new URL(c.req.url).origin, collections: [], articles: [] });
    return new Response(html, { status: 200, headers: pageHeaders(site, { 'cache-control': 'no-store', vary: 'accept-language' }) });
  });

  app.get('/help/:slug/sitemap.xml', async (c) => {
    const site = await siteOr404(c);
    if (!site || site.helpNoindex) return notFoundText(c);
    await limit(c);
    const [articles, languages] = await Promise.all([helpSitemap(db(c), site), helpLanguages(db(c), site)]);
    return c.body(sitemapXml(new URL(c.req.url).origin, site, articles, languages), 200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
  });

  app.get('/help/:slug/:lang', async (c) => {
    const site = await siteOr404(c);
    const language = helpLanguageFromPath(c.req.param('lang'));
    if (!site || !language) return notFoundText(c);
    return cachedPage(c, site, async () => {
      const [languages, home] = await Promise.all([helpLanguages(db(c), site), helpHome(db(c), site, language)]);
      if (!languages.includes(language)) return { status: 404, html: notFoundPage({ site, language, languages }) };
      return { status: 200, html: homePage({ site, language, languages, origin: new URL(c.req.url).origin, ...home }) };
    });
  });

  /** Not cached: every query differs. Rate-limited like a page. */
  app.get('/help/:slug/:lang/search', async (c) => {
    const site = await siteOr404(c);
    const language = helpLanguageFromPath(c.req.param('lang'));
    if (!site || !language) return notFoundText(c);
    await limit(c);
    const query = (c.req.query('q') ?? '').slice(0, 200).trim();
    const [languages, results] = await Promise.all([helpLanguages(db(c), site), searchHelp(db(c), site, language, query)]);
    return new Response(searchPage({ site, language, languages, query, results }), {
      status: 200,
      headers: pageHeaders(site, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }),
    });
  });

  app.get('/help/:slug/:lang/:article', async (c) => {
    const site = await siteOr404(c);
    const language = helpLanguageFromPath(c.req.param('lang'));
    if (!site || !language) return notFoundText(c);
    return cachedPage(c, site, async () => {
      const [languages, article] = await Promise.all([helpLanguages(db(c), site), helpArticlePage(db(c), site, language, c.req.param('article'))]);
      if (!article) return { status: 404, html: notFoundPage({ site, language, languages }) };
      return { status: 200, html: articlePage({ site, language, languages, origin: new URL(c.req.url).origin, article }) };
    });
  });

  /** Images in articles. Immutable: an image is never replaced under the same ID. */
  app.get('/help-assets/:id', async (c) => {
    const asset = await helpAssetInfo(db(c), c.req.param('id'));
    if (!asset) return notFoundText(c);
    const object = await c.env.ATTACHMENTS.get(helpAssetKey(asset.id));
    if (!object) return notFoundText(c);
    return new Response(object.body, {
      status: 200,
      headers: {
        'content-type': asset.contentType,
        'content-length': String(object.size),
        'cache-control': 'public, max-age=31536000, immutable',
        'content-security-policy': "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
        // The widget shows articles on the company's own site, from step 3.
        'cross-origin-resource-policy': 'cross-origin',
      },
    });
  });
}

/** The pages above, for the test that keeps the app and the contract in step. */
export const HELP_PUBLIC_ROUTES = ['GET /help/:slug', 'GET /help/:slug/sitemap.xml', 'GET /help/:slug/:lang', 'GET /help/:slug/:lang/search', 'GET /help/:slug/:lang/:article', 'GET /help-assets/:id'];
