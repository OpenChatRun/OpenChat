/**
 * The widget's Help tab (ADR-0023, step 3): published articles only, of the named website only, from an allowed page
 * only; links and images made absolute; and the article a visitor came from recorded on the conversation they start.
 * The real Worker and D1.
 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { hashPassword } from '@openchat/auth';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';

const ORIGIN = 'https://chat.example.com';
const SITE = 'https://shop.example';
const PASSWORD = 'correct horse battery';
const W = 'work_a';
const ASSET = 'hast_01ARZ3NDEKTSV4RRFFQ69G5FAV';

let counter = 0;
async function call(method: string, path: string, options: { token?: string; body?: unknown; origin?: string | null | undefined; headers?: Record<string, string> } = {}) {
  const ctx = createExecutionContext();
  const origin = options.origin === undefined ? SITE : options.origin;
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        'cf-connecting-ip': `203.0.113.${++counter % 250}`,
        ...(origin ? { origin } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    env as unknown as Env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}
const json = async <T = Record<string, unknown>>(response: Response) => (await response.json()) as T;

let hash = '';
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

/** The bootstrap is cached for 30 seconds by website key, so each test has keys of its own. */
let key = '';
let otherKey = '';
let boss = '';
beforeEach(async () => {
  key = `key_help_${++counter}_${Date.now()}`;
  otherKey = `key_other_${counter}_${Date.now()}`;
  const tables = ['outbox', 'conversation_read_cursors', 'conversation_events', 'messages', 'conversations', 'visitors', 'contacts', 'help_articles', 'help_collections', 'audit_log', 'websites', 'workspace_members', 'auth_sessions', 'workspaces', 'users', 'installation'];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installation (id, name, public_base_url, created_at, updated_at) VALUES ('inst_test', 'Test', ?1, 1, 1)`).bind(ORIGIN),
    env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('work_a', 'Acme', 'acme', 1, 1), ('work_b', 'Other', 'other', 1, 1)`),
    env.DB.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('user_boss', 'boss@example.com', 'Boss', ?1, 1, 1)`).bind(hash),
    env.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) VALUES ('mem_boss', ?1, 'user_boss', 'supervisor', 'active', 1, 1)`).bind(W),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, allowed_origins_json, created_at, updated_at) VALUES ('site_a', ?1, 'Shop', ?2, ?3, 1, 1)`).bind(W, key, JSON.stringify([SITE])),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, allowed_origins_json, created_at, updated_at) VALUES ('site_b', 'work_b', 'Other', ?1, ?2, 1, 1)`).bind(otherKey, JSON.stringify(['https://other.example'])),
    env.DB.prepare(`INSERT INTO help_articles (id, workspace_id, website_id, translation_group_id, language, slug, title, status, published_at, created_at, updated_at) VALUES ('hart_b', 'work_b', 'site_b', 'hart_b', 'en', 'other', 'Other returns', 'published', 1, 1, 1)`),
  ]);
  const login = await call('POST', '/api/v1/auth/login', { body: { email: 'boss@example.com', password: PASSWORD, clientType: 'dashboard' }, origin: null });
  boss = (await json<{ accessToken: string }>(login)).accessToken;
});

const api = (path: string) => `/api/v1/workspaces/${W}${path}`;

async function article(input: Record<string, unknown>, status: 'published' | 'draft' = 'published'): Promise<{ id: string }> {
  const created = await call('POST', api('/websites/site_a/help/articles'), { token: boss, body: { language: 'en', ...input }, origin: null });
  expect(created.status).toBe(201);
  const { id } = await json<{ id: string }>(created);
  if (status === 'published') expect((await call('PUT', api(`/help/articles/${id}/status`), { token: boss, body: { status }, origin: null })).status).toBe(200);
  return { id };
}

const help = (query: string, origin?: string | null) => call('GET', `/api/v1/widget/help?websiteKey=${key}${query}`, { origin });

describe('the Help tab', () => {
  it('is offered by the bootstrap only once there is a published article', async () => {
    await article({ title: 'Draft only' }, 'draft');
    expect((await json(await call('GET', `/api/v1/widget/bootstrap?websiteKey=${key}`))).helpLanguages).toEqual([]);
    key = `${key}_again`; // A fresh key, past the bootstrap cache.
    await env.DB.prepare(`UPDATE websites SET website_key = ?1 WHERE id = 'site_a'`).bind(key).run();
    await article({ title: 'Returns' });
    await article({ title: 'Rücksendungen', language: 'de' });
    await article({ title: 'Versand', language: 'de' });
    expect((await json(await call('GET', `/api/v1/widget/bootstrap?websiteKey=${key}`))).helpLanguages).toEqual(['de', 'en']);
  });

  it('lists and searches published articles of this website, in the language asked for or else English', async () => {
    const shown = await article({ title: 'Returns', summary: 'Send it back', bodyMarkdown: 'Within 30 days.' });
    await article({ title: 'Secret plans' }, 'draft');
    const list = await json<{ language: string; articles: { id: string; title: string; summary: string }[] }>(await help('&language=en'));
    expect(list.language).toBe('en');
    expect(list.articles).toEqual([{ id: shown.id, title: 'Returns', summary: 'Send it back', collectionId: null }]);
    // No Japanese articles: English.
    expect((await json(await help('&language=ja'))).language).toBe('en');
    const found = await json<{ articles: { title: string }[] }>(await help('&language=en&q=return'));
    expect(found.articles.map((a) => a.title)).toEqual(['Returns']);
    expect((await json<{ articles: unknown[] }>(await help('&language=en&q=secret'))).articles).toEqual([]);
    expect((await json<{ articles: unknown[] }>(await help('&language=en&q=other'))).articles).toEqual([]);
  });

  it('opens an article with images and help links on the installation, and no other website\'s article', async () => {
    expect((await call('PUT', api('/websites/site_a/help/settings'), { token: boss, body: { slug: 'shop' }, origin: null })).status).toBe(200);
    const { id } = await article({ title: 'Returns', bodyMarkdown: `See [shipping](/help/shop/en/shipping).\n\n![Box](/help-assets/${ASSET})` });
    const response = await call('GET', `/api/v1/widget/help/articles/${id}?websiteKey=${key}`);
    expect(response.status).toBe(200);
    const body = await json<{ bodyHtml: string; url: string }>(response);
    expect(body.bodyHtml).toContain(`<a target="_blank" rel="noopener" href="${ORIGIN}/help/shop/en/shipping">`);
    expect(body.bodyHtml).toContain(`src="${ORIGIN}/help-assets/${ASSET}"`);
    expect(body.url).toBe(`${ORIGIN}/help/shop/en/returns`);
    expect((await call('GET', `/api/v1/widget/help/articles/hart_b?websiteKey=${key}`)).status).toBe(404);
    const draft = await article({ title: 'Unfinished' }, 'draft');
    expect((await call('GET', `/api/v1/widget/help/articles/${draft.id}?websiteKey=${key}`)).status).toBe(404);
  });

  it('answers only pages the website allows', async () => {
    expect((await help('', 'https://evil.example')).status).toBe(403);
    expect((await call('GET', `/api/v1/widget/help?websiteKey=${otherKey}`)).status).toBe(403);
    expect((await call('GET', `/api/v1/widget/help?websiteKey=key_none`)).status).toBe(404);
  });
});

describe('views and "Was this helpful?" in the widget', () => {
  const BROWSER = { 'user-agent': 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile Safari/604.1' };
  const stats = async (id: string) =>
    env.DB.prepare(`SELECT views, helpful, not_helpful AS notHelpful FROM help_article_stats WHERE article_id = ?1`).bind(id).first<{ views: number; helpful: number; notHelpful: number }>();
  const answer = (id: string, helpful: unknown, options: { ip?: string; origin?: string; websiteKey?: string } = {}) =>
    call('POST', `/api/v1/widget/help/articles/${id}/feedback`, { body: { websiteKey: options.websiteKey ?? key, helpful }, origin: options.origin, headers: { 'cf-connecting-ip': options.ip ?? '203.0.113.7' } });

  it('counts each time a reader opens an article, though the article is cached', async () => {
    const { id } = await article({ title: 'Returns' });
    for (let i = 0; i < 2; i += 1) expect((await call('GET', `/api/v1/widget/help/articles/${id}?websiteKey=${key}`, { headers: BROWSER })).status).toBe(200);
    await call('GET', `/api/v1/widget/help/articles/${id}?websiteKey=${key}`);
    expect(await stats(id)).toEqual({ views: 2, helpful: 0, notHelpful: 0 });
  });

  it('counts one answer per reader and article, of this website only, from an allowed page only', async () => {
    const { id } = await article({ title: 'Returns' });
    const draft = await article({ title: 'Unfinished' }, 'draft');
    expect((await answer(id, true)).status).toBe(204);
    expect((await answer(id, false)).status).toBe(204);
    expect((await answer(id, false, { ip: '203.0.113.8' })).status).toBe(204);
    expect(await stats(id)).toEqual({ views: 0, helpful: 1, notHelpful: 1 });

    expect((await answer(id, 'yes', { ip: '203.0.113.9' })).status).toBe(400);
    expect((await answer(id, true, { ip: '203.0.113.9', origin: 'https://evil.example' })).status).toBe(403);
    expect((await answer(draft.id, true, { ip: '203.0.113.9' })).status).toBe(404);
    // Another website's article, named with this website's key.
    expect((await answer('hart_b', true, { ip: '203.0.113.9' })).status).toBe(404);
    expect(await stats(draft.id)).toBeNull();
    expect(await stats('hart_b')).toBeNull();
    expect(await stats(id)).toEqual({ views: 0, helpful: 1, notHelpful: 1 });
  });
});

describe('Still need help?', () => {
  const visitor = async () => {
    const response = await call('POST', '/api/v1/widget/sessions', { body: { websiteKey: key } });
    expect(response.status).toBe(200);
    return (await json<{ accessToken: string }>(response)).accessToken;
  };
  const start = async (token: string, clientMessageId: string, helpArticleId: string) => {
    const response = await call('POST', '/api/v1/widget/conversations', { token, body: { clientMessageId, content: 'Hello', helpArticleId } });
    expect(response.status).toBe(201);
    return (await json<{ id: string }>(response)).id;
  };
  const shown = async (conversationId: string) => (await json<{ helpArticleId: string | null }>(await call('GET', api(`/conversations/${conversationId}`), { token: boss, origin: null }))).helpArticleId;

  it('records the article on the conversation, and the team sees it', async () => {
    const { id } = await article({ title: 'Returns' });
    expect(await shown(await start(await visitor(), 'from-help', id))).toBe(id);
  });

  it('records nothing for a draft, or another website\'s article', async () => {
    const token = await visitor();
    const draft = await article({ title: 'Unfinished' }, 'draft');
    expect(await shown(await start(token, 'from-draft', draft.id))).toBeNull();
    expect(await shown(await start(token, 'from-other', 'hart_b'))).toBeNull();
  });
});
