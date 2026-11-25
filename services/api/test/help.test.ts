/**
 * The help centre (ADR-0023, step 1): who may change it, what visitors see at /help/<slug>, search in languages
 * with and without spaces, images, the audit trail, and that a change is never hidden by the page cache.
 * The real Worker and D1.
 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { hashPassword } from '@openchat/auth';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';

const ORIGIN = 'https://chat.example.com';
const PASSWORD = 'correct horse battery';
const W = 'work_a';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let counter = 0;
async function call(method: string, path: string, options: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: Uint8Array } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        'cf-connecting-ip': `198.51.100.${++counter % 250}`,
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.raw ? { body: options.raw } : options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    env as unknown as Env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

let hash = '';
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

const tokens: Record<'boss' | 'agent' | 'other', string> = { boss: '', agent: '', other: '' };
beforeEach(async () => {
  const tables = ['help_articles', 'help_collections', 'help_assets', 'audit_log', 'outbox', 'websites', 'workspace_members', 'auth_tokens', 'auth_sessions', 'workspaces', 'users', 'installation'];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installation (id, name, public_base_url, created_at, updated_at) VALUES ('inst_test', 'Test', ?1, 1, 1)`).bind(ORIGIN),
    env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('work_a', 'Acme', 'acme', 1, 1), ('work_b', 'Other', 'other', 1, 1)`),
    ...[['boss', 'supervisor', W], ['agent', 'agent', W], ['other', 'supervisor', 'work_b']].flatMap(([name, role, workspace]) => [
      env.DB.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, 1)`).bind(`user_${name}`, `${name}@example.com`, name, hash),
      env.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'active', 1, 1)`).bind(`mem_${name}`, workspace, `user_${name}`, role),
    ]),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, settings_json, created_at, updated_at) VALUES ('site_a', ?1, 'Shop', 'key_a', '{"primaryColor":"#ffcc00"}', 1, 1)`).bind(W),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, created_at, updated_at) VALUES ('site_b', 'work_b', 'Other shop', 'key_b', 1, 1)`),
    // A website's version only grows. These rows are made again for each test, so they start where no cached page is.
    env.DB.prepare(`UPDATE websites SET help_version = ?1`).bind(Date.now() * 10 + (++counter % 10)),
  ]);
  for (const name of ['boss', 'agent', 'other'] as const) {
    const login = await call('POST', '/api/v1/auth/login', { body: { email: `${name}@example.com`, password: PASSWORD, clientType: 'dashboard' } });
    tokens[name] = ((await login.json()) as { accessToken: string }).accessToken;
  }
});

// ---------- Helpers ----------

type Article = { id: string; slug: string; version: number; status: string; bodyHtml: string; translationGroupId: string; collectionId: string | null };
const api = (path: string) => `/api/v1/workspaces/${W}${path}`;

async function turnOn(slug = 'shop') {
  const response = await call('PUT', api('/websites/site_a/help/settings'), { token: tokens.boss, body: { slug } });
  expect(response.status).toBe(200);
}

async function write(input: Record<string, unknown>, token = tokens.boss): Promise<Article> {
  const response = await call('POST', api('/websites/site_a/help/articles'), { token, body: { language: 'en', ...input } });
  expect(response.status).toBe(201);
  return (await response.json()) as Article;
}

async function publish(article: Article, status: 'published' | 'draft' = 'published'): Promise<Article> {
  const response = await call('PUT', api(`/help/articles/${article.id}/status`), { token: tokens.boss, body: { status } });
  expect(response.status).toBe(200);
  return (await response.json()) as Article;
}

const page = async (path: string, headers: Record<string, string> = {}) => {
  const response = await call('GET', path, { headers });
  return { status: response.status, headers: response.headers, html: await response.text() };
};

const audit = async () =>
  (await env.DB.prepare(`SELECT action, metadata_json AS metadata FROM audit_log WHERE workspace_id = ?1 ORDER BY created_at, rowid`).bind(W).all<{ action: string; metadata: string }>()).results;

// ---------- Members ----------

describe('who may change the help centre', () => {
  it('lets every member read it, and only supervisors change it', async () => {
    const article = await write({ title: 'Returns' });
    expect((await call('GET', api('/websites/site_a/help'), { token: tokens.agent })).status).toBe(200);
    expect((await call('GET', api(`/help/articles/${article.id}`), { token: tokens.agent })).status).toBe(200);
    expect((await call('POST', api('/websites/site_a/help/articles'), { token: tokens.agent, body: { language: 'en', title: 'Mine' } })).status).toBe(403);
    expect((await call('PUT', api(`/help/articles/${article.id}/status`), { token: tokens.agent, body: { status: 'published' } })).status).toBe(403);
    expect((await call('PUT', api('/websites/site_a/help/settings'), { token: tokens.agent, body: { slug: 'mine' } })).status).toBe(403);
    expect((await call('DELETE', api(`/help/articles/${article.id}`), { token: tokens.agent })).status).toBe(403);
  });

  it('renders Markdown from an allow-list, so nothing a writer types runs on a visitor\'s page', async () => {
    const article = await write({
      title: 'Returns <script>alert(1)</script>',
      bodyMarkdown: '# Steps\n\n1. Open **Orders**\n2. Choose [Return](https://shop.example/returns)\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) ![x](https://tracker.example/p.png)',
    });
    expect(article.bodyHtml).toContain('<h2>Steps</h2>');
    expect(article.bodyHtml).toContain('<ol><li>Open <strong>Orders</strong></li>');
    expect(article.bodyHtml).toContain('<a href="https://shop.example/returns" target="_blank" rel="noopener nofollow ugc">Return</a>');
    expect(article.bodyHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(article.bodyHtml).not.toMatch(/<img|href="javascript/);
  });

  it('keeps a slug free for each article, and refuses one in use', async () => {
    const one = await write({ title: 'Opening hours' });
    const two = await write({ title: 'Opening hours' });
    const search = await write({ title: 'Search' });
    expect([one.slug, two.slug, search.slug]).toEqual(['opening-hours', 'opening-hours-2', 'search-2']);
    const taken = await call('PATCH', api(`/help/articles/${two.id}`), { token: tokens.boss, body: { expectedVersion: two.version, slug: 'opening-hours' } });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { code: string }).code).toBe('slug_taken');
    expect((await call('PATCH', api(`/help/articles/${two.id}`), { token: tokens.boss, body: { expectedVersion: two.version, slug: 'search' } })).status).toBe(400);
  });

  it('refuses a change made from an old version', async () => {
    const article = await write({ title: 'Returns' });
    expect((await call('PATCH', api(`/help/articles/${article.id}`), { token: tokens.boss, body: { expectedVersion: article.version, title: 'Returns policy' } })).status).toBe(200);
    expect((await call('PATCH', api(`/help/articles/${article.id}`), { token: tokens.boss, body: { expectedVersion: article.version, title: 'Lost' } })).status).toBe(409);
  });

  it('gives one website one address', async () => {
    await turnOn('shop');
    const taken = await call('PUT', '/api/v1/workspaces/work_b/websites/site_b/help/settings', { token: tokens.other, body: { slug: 'shop' } });
    expect(taken.status).toBe(409);
    expect((await call('PUT', api('/websites/site_a/help/settings'), { token: tokens.boss, body: { slug: 'Not OK!' } })).status).toBe(400);
  });

  it('keeps articles when their collection is deleted, and only puts them in one of the same language', async () => {
    const created = await call('POST', api('/websites/site_a/help/collections'), { token: tokens.boss, body: { language: 'en', name: 'Orders' } });
    const collection = (await created.json()) as { id: string };
    const article = await write({ title: 'Returns', collectionId: collection.id });
    expect(article.collectionId).toBe(collection.id);
    expect((await call('POST', api('/websites/site_a/help/articles'), { token: tokens.boss, body: { language: 'de', title: 'Rückgabe', collectionId: collection.id } })).status).toBe(400);
    expect((await call('DELETE', api(`/help/collections/${collection.id}`), { token: tokens.boss })).status).toBe(204);
    const after = (await (await call('GET', api(`/help/articles/${article.id}`), { token: tokens.boss })).json()) as Article;
    expect(after.collectionId).toBeNull();
  });

  it('stops at the most articles a website may have', async () => {
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000)
       INSERT INTO help_articles (id, workspace_id, website_id, translation_group_id, language, slug, title, created_at, updated_at)
       SELECT 'hart_' || i, ?1, 'site_a', 'hart_' || i, 'en', 'a-' || i, 'A', 1, 1 FROM n`,
    )
      .bind(W)
      .run();
    const full = await call('POST', api('/websites/site_a/help/articles'), { token: tokens.boss, body: { language: 'en', title: 'One more' } });
    expect(full.status).toBe(409);
  });

  it('records publishing, unpublishing, deleting and a new address in the audit log', async () => {
    await turnOn('shop');
    const article = await write({ title: 'Returns' });
    await publish(article);
    await publish(article); // No change, so nothing to record.
    await publish(article, 'draft');
    await call('DELETE', api(`/help/articles/${article.id}`), { token: tokens.boss });
    const actions = (await audit()).map((row) => row.action);
    expect(actions).toEqual(['help.address_changed', 'help.article_published', 'help.article_unpublished', 'help.article_deleted']);
    expect(JSON.parse((await audit())[0]!.metadata)).toEqual({ from: null, to: 'shop' });
  });
});

// ---------- Visitors ----------

describe('the public help centre', () => {
  it('shows nothing until it has an address, and never a draft', async () => {
    const article = await write({ title: 'Returns', bodyMarkdown: 'Within 30 days.' });
    expect((await page('/help/shop/en')).status).toBe(404);
    await turnOn('shop');
    expect((await page('/help/shop/en')).status).toBe(404);
    expect((await page(`/help/shop/en/${article.slug}`)).status).toBe(404);
    await publish(article);
    const home = await page('/help/shop/en');
    expect(home.status).toBe(200);
    expect(home.html).toContain(`href="/help/shop/en/${article.slug}"`);
    const shown = await page(`/help/shop/en/${article.slug}`);
    expect(shown.status).toBe(200);
    expect(shown.html).toContain('<p>Within 30 days.</p>');
    expect(shown.html).toContain('<link rel="canonical" href="https://chat.example.com/help/shop/en/returns">');
    await publish(article, 'draft');
    expect((await page(`/help/shop/en/${article.slug}`)).status).toBe(404);
  });

  it('serves pages with no script, a strict policy, and the website\'s colour', async () => {
    await turnOn('shop');
    await publish(await write({ title: 'Returns <b>now</b>' }));
    const home = await page('/help/shop/en');
    expect(home.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(home.headers.get('content-security-policy')).not.toContain('script-src');
    expect(home.headers.get('set-cookie')).toBeNull();
    expect(home.html).not.toContain('<script');
    expect(home.html).toContain('Returns &lt;b&gt;now&lt;/b&gt;');
    expect(home.html).toContain('--accent:#ffcc00;--on-accent:#000000');
  });

  it('shows a change at once, though pages are cached', async () => {
    await turnOn('shop');
    const article = await publish(await write({ title: 'Returns', bodyMarkdown: 'Within 30 days.' }));
    const first = await page(`/help/shop/en/${article.slug}`);
    expect(first.html).toContain('Within 30 days.');
    const etag = first.headers.get('etag')!;
    expect((await page(`/help/shop/en/${article.slug}`, { 'if-none-match': etag })).status).toBe(304);
    await call('PATCH', api(`/help/articles/${article.id}`), { token: tokens.boss, body: { expectedVersion: article.version, bodyMarkdown: 'Within 60 days.' } });
    const second = await page(`/help/shop/en/${article.slug}`, { 'if-none-match': etag });
    expect(second.status).toBe(200);
    expect(second.html).toContain('Within 60 days.');
  });

  it('takes a visitor to their language, and links an article to its translations', async () => {
    await turnOn('shop');
    const english = await publish(await write({ title: 'Returns' }));
    const german = await publish(await write({ language: 'de', title: 'Rückgabe', translationOf: english.id }));
    expect(german.translationGroupId).toBe(english.translationGroupId);
    expect((await call('POST', api('/websites/site_a/help/articles'), { token: tokens.boss, body: { language: 'de', title: 'Noch eine', translationOf: english.id } })).status).toBe(409);

    const redirect = await call('GET', '/help/shop', { headers: { 'accept-language': 'de-AT,de;q=0.9,en;q=0.5' } });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('/help/shop/de');
    expect((await call('GET', '/help/shop', { headers: { 'accept-language': 'fr' } })).headers.get('location')).toBe('/help/shop/en');

    const shown = await page(`/help/shop/en/${english.slug}`);
    expect(shown.html).toContain(`<link rel="alternate" hreflang="de" href="https://chat.example.com/help/shop/de/${german.slug}">`);
    expect((await page(`/help/shop/de/${encodeURIComponent(german.slug)}`)).html).toContain('lang="de"');
  });

  it('finds articles by words, without accents or capitals, and only published ones', async () => {
    await turnOn('shop');
    await publish(await write({ title: 'Returning an item', summary: 'Refunds in 30 days', bodyMarkdown: 'Send it back from the **Orders** page.' }));
    await publish(await write({ title: 'Café opening hours', bodyMarkdown: 'Open every day.' }));
    await write({ title: 'Secret draft about orders' });
    const titles = async (q: string) => [...(await page(`/help/shop/en/search?q=${encodeURIComponent(q)}`)).html.matchAll(/<li><a href="[^"]+">([^<]+)/g)].map((m) => m[1]);
    expect(await titles('orders')).toEqual(['Returning an item']);
    expect(await titles('CAFE')).toEqual(['Café opening hours']);
    expect(await titles('refunds')).toEqual(['Returning an item']);
    expect(await titles('open')).toEqual(['Café opening hours']);
    expect(await titles('nothing like this')).toEqual([]);
    const results = await page('/help/shop/en/search?q=orders');
    expect(results.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('finds Japanese articles, which have no spaces between words', async () => {
    await turnOn('shop');
    await publish(await write({ language: 'ja', title: '返品について', bodyMarkdown: 'ご注文から30日以内であれば、返品できます。' }));
    await publish(await write({ language: 'ja', title: '営業時間', bodyMarkdown: '平日の午前9時から午後6時まで対応しています。' }));
    const titles = async (q: string) => [...(await page(`/help/shop/ja/search?q=${encodeURIComponent(q)}`)).html.matchAll(/<li><a href="[^"]+">([^<]+)/g)].map((m) => m[1]);
    expect(await titles('返品')).toEqual(['返品について']);
    expect(await titles('返品したい')).toEqual([]);
    expect(await titles('30日以内')).toEqual(['返品について']);
    expect(await titles('営業時間は')).toEqual([]);
    expect(await titles('午前9時')).toEqual(['営業時間']);
  });

  it('serves images it was given, as images, and nothing else', async () => {
    const upload = await call('POST', api('/websites/site_a/help/assets?filename=step.png'), { token: tokens.boss, raw: PNG, headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) } });
    expect(upload.status).toBe(201);
    const asset = (await upload.json()) as { id: string; url: string };
    const served = await call('GET', asset.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);

    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect((await call('POST', api('/websites/site_a/help/assets?filename=x.png'), { token: tokens.boss, raw: html, headers: { 'content-type': 'image/png', 'content-length': String(html.length) } })).status).toBe(415);
    expect((await call('POST', api('/websites/site_a/help/assets?filename=x.svg'), { token: tokens.boss, raw: html, headers: { 'content-type': 'image/svg+xml', 'content-length': String(html.length) } })).status).toBe(415);

    const article = await write({ title: 'With a picture', bodyMarkdown: `![The orders page](${asset.url})` });
    expect(article.bodyHtml).toContain(`<img src="${asset.url}" alt="The orders page" loading="lazy">`);

    expect((await call('DELETE', api(`/help/assets/${asset.id}`), { token: tokens.boss })).status).toBe(204);
    expect((await call('GET', asset.url)).status).toBe(404);
  });

  it('lists published articles in a sitemap, unless the website asked not to be listed', async () => {
    await turnOn('shop');
    await publish(await write({ title: 'Returns' }));
    await write({ title: 'Draft' });
    const sitemap = await page('/help/shop/sitemap.xml');
    expect(sitemap.html).toContain('<loc>https://chat.example.com/help/shop/en/returns</loc>');
    expect(sitemap.html).not.toContain('draft');
    await call('PUT', api('/websites/site_a/help/settings'), { token: tokens.boss, body: { slug: 'shop', noindex: true } });
    expect((await page('/help/shop/sitemap.xml')).status).toBe(404);
    const home = await page('/help/shop/en');
    expect(home.headers.get('x-robots-tag')).toBe('noindex');
    expect(home.html).toContain('<meta name="robots" content="noindex">');
  });

  it('never shows one website\'s cached page for another that takes its address', async () => {
    await turnOn('shop');
    await publish(await write({ title: 'Shop returns' }));
    expect((await page('/help/shop/en')).html).toContain('Shop returns');
    await call('PUT', api('/websites/site_a/help/settings'), { token: tokens.boss, body: { slug: null } });
    const version = await env.DB.prepare(`SELECT help_version AS v FROM websites WHERE id = 'site_a'`).first<{ v: number }>();
    await env.DB.prepare(`UPDATE websites SET help_version = ?1 WHERE id = 'site_b'`).bind(version!.v - 2).run();
    expect((await call('PUT', '/api/v1/workspaces/work_b/websites/site_b/help/settings', { token: tokens.other, body: { slug: 'shop' } })).status).toBe(200);
    await env.DB.prepare(`INSERT INTO help_articles (id, workspace_id, website_id, translation_group_id, language, slug, title, status, published_at, created_at, updated_at) VALUES ('hart_b', 'work_b', 'site_b', 'hart_b', 'en', 'other', 'Other returns', 'published', 1, 1, 1)`).run();
    const html = (await page('/help/shop/en')).html;
    expect(html).toContain('Other returns');
    expect(html).not.toContain('Shop returns');
  });

  it('forgets the old address when it moves', async () => {
    await turnOn('shop');
    await publish(await write({ title: 'Returns' }));
    await turnOn('help');
    expect((await page('/help/shop/en')).status).toBe(404);
    expect((await page('/help/help/en')).status).toBe(200);
    await call('PUT', api('/websites/site_a/help/settings'), { token: tokens.boss, body: { slug: null } });
    expect((await page('/help/help/en')).status).toBe(404);
  });
});

describe('views and "Was this article helpful?"', () => {
  const BROWSER = { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15' };
  const stats = async (id: string) => {
    const article = (await (await call('GET', api(`/help/articles/${id}`), { token: tokens.boss })).json()) as { views: number; helpful: number; notHelpful: number };
    return { views: article.views, helpful: article.helpful, notHelpful: article.notHelpful };
  };
  const answer = (path: string, helpful: string, headers: Record<string, string> = {}) =>
    call('POST', `${path}/feedback`, { raw: new TextEncoder().encode(`helpful=${helpful}`), headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '198.51.100.7', ...headers } });

  it('counts a reader each time the article is opened, cached or not, and not a crawler or a draft', async () => {
    await turnOn();
    const article = await publish(await write({ title: 'Returns' }));
    const path = `/help/shop/en/${article.slug}`;
    expect(await stats(article.id)).toEqual({ views: 0, helpful: 0, notHelpful: 0 });
    const first = await page(path, BROWSER);
    await page(path, BROWSER);
    expect((await page(path, { ...BROWSER, 'if-none-match': first.headers.get('etag')! })).status).toBe(304);
    await page(path, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
    await page(path);
    expect((await page('/help/shop/en/nothing-here', BROWSER)).status).toBe(404);
    expect(await stats(article.id)).toEqual({ views: 3, helpful: 0, notHelpful: 0 });
    // The list carries the same numbers.
    const list = (await (await call('GET', api('/websites/site_a/help'), { token: tokens.boss })).json()) as { articles: { id: string; views: number }[] };
    expect(list.articles.find((a) => a.id === article.id)?.views).toBe(3);
    await publish(article, 'draft');
    await page(path, BROWSER);
    expect((await stats(article.id)).views).toBe(3);
  });

  it('has a form that needs no script, counts one answer per reader and article, and thanks them either way', async () => {
    await turnOn();
    const article = await publish(await write({ title: 'Returns' }));
    const path = `/help/shop/en/${article.slug}`;
    const shown = await page(path);
    expect(shown.html).toContain(`<form class="helpful" method="post" action="${path}/feedback">`);
    expect(shown.html).toContain('Was this article helpful?');
    expect(shown.html).not.toContain('<script');

    const yes = await answer(path, 'yes');
    expect(yes.status).toBe(303);
    expect(yes.headers.get('location')).toBe(`${path}/thanks`);
    // The same reader again: thanked, not counted.
    expect((await answer(path, 'no')).status).toBe(303);
    expect((await answer(path, 'no', { 'cf-connecting-ip': '198.51.100.8' })).status).toBe(303);
    expect(await stats(article.id)).toEqual({ views: 0, helpful: 1, notHelpful: 1 });

    const thanks = await page(`${path}/thanks`);
    expect(thanks.status).toBe(200);
    expect(thanks.html).toContain('Thanks for your feedback.');
    expect(thanks.html).toContain(`href="${path}"`);
    expect(thanks.headers.get('x-robots-tag')).toBe('noindex');
    expect(thanks.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses an answer from another site, a wrong answer, and one for a page that is not published', async () => {
    await turnOn();
    const article = await publish(await write({ title: 'Returns' }));
    const draft = await write({ title: 'Unfinished' });
    const path = `/help/shop/en/${article.slug}`;
    expect((await answer(path, 'yes', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await answer(path, 'maybe')).status).toBe(400);
    expect((await answer(`/help/shop/en/${draft.slug}`, 'yes')).status).toBe(404);
    expect((await answer('/help/nowhere/en/returns', 'yes')).status).toBe(404);
    // An address of its own: the limiter remembers the readers of the tests above.
    expect((await answer(path, 'yes', { origin: ORIGIN, 'cf-connecting-ip': '198.51.100.99' })).status).toBe(303);
    expect(await stats(article.id)).toEqual({ views: 0, helpful: 1, notHelpful: 0 });
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM help_article_stats`).first<{ n: number }>()).toEqual({ n: 1 });
  });

  it('forgets the counts with the article', async () => {
    await turnOn();
    const article = await publish(await write({ title: 'Returns' }));
    await page(`/help/shop/en/${article.slug}`, BROWSER);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM help_article_stats`).first<{ n: number }>()).toEqual({ n: 1 });
    expect((await call('DELETE', api(`/help/articles/${article.id}`), { token: tokens.boss })).status).toBe(204);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM help_article_stats`).first<{ n: number }>()).toEqual({ n: 0 });
  });
});

describe('choosing a language', () => {
  it('follows Accept-Language, with Chinese scripts told apart', async () => {
    const { pickHelpLanguage } = await import('@openchat/core');
    expect(pickHelpLanguage('fr-CH, fr;q=0.9, en;q=0.8', ['en', 'fr'])).toBe('fr');
    expect(pickHelpLanguage('de;q=0.1, ja', ['de', 'ja'])).toBe('ja');
    expect(pickHelpLanguage('zh-TW', ['zh-Hans', 'zh-Hant'])).toBe('zh-Hant');
    expect(pickHelpLanguage('zh-CN', ['zh-Hans', 'zh-Hant'])).toBe('zh-Hans');
    expect(pickHelpLanguage('zh-HK', ['zh-Hans'])).toBe('zh-Hans');
    expect(pickHelpLanguage(null, ['ja', 'en'])).toBe('en');
    expect(pickHelpLanguage('ko', ['ja', 'de'])).toBe('ja');
    expect(pickHelpLanguage('en', [])).toBeNull();
  });
});
