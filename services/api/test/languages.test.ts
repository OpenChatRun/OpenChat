/**
 * Languages for automatic translation (ADR-0024, step 1): the visitor's on the conversation, the first one sent kept,
 * a supervisor's correction; and the language a member reads, on the server. The real Worker and D1.
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

let counter = 0;
async function call(method: string, path: string, options: { token?: string; body?: unknown; site?: boolean } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        'cf-connecting-ip': `192.0.2.${++counter % 250}`,
        ...(options.site ? { origin: SITE } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
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

const login = async (email: string) => (await json<{ accessToken: string }>(await call('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, clientType: 'dashboard' } }))).accessToken;

let key = '';
let boss = '';
let agent = '';
beforeEach(async () => {
  key = `key_lang_${++counter}_${Date.now()}`;
  const tables = ['outbox', 'conversation_read_cursors', 'conversation_events', 'messages', 'conversations', 'visitors', 'contacts', 'audit_log', 'websites', 'workspace_members', 'auth_sessions', 'workspaces', 'users', 'installation'];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installation (id, name, public_base_url, created_at, updated_at) VALUES ('inst_test', 'Test', ?1, 1, 1)`).bind(ORIGIN),
    env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?1, 'Acme', 'acme', 1, 1)`).bind(W),
    env.DB.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('user_boss', 'boss@example.com', 'Boss', ?1, 1, 1), ('user_agent', 'agent@example.com', 'Agent', ?1, 1, 1)`).bind(hash),
    env.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) VALUES ('mem_boss', ?1, 'user_boss', 'supervisor', 'active', 1, 1), ('mem_agent', ?1, 'user_agent', 'agent', 'active', 1, 1)`).bind(W),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, allowed_origins_json, created_at, updated_at) VALUES ('site_a', ?1, 'Shop', ?2, ?3, 1, 1)`).bind(W, key, JSON.stringify([SITE])),
  ]);
  [boss, agent] = await Promise.all([login('boss@example.com'), login('agent@example.com')]);
});

const visitor = async () => (await json<{ accessToken: string }>(await call('POST', '/api/v1/widget/sessions', { body: { websiteKey: key }, site: true }))).accessToken;
const start = async (token: string, body: Record<string, unknown>) => {
  const response = await call('POST', '/api/v1/widget/conversations', { token, body: { clientMessageId: `starting-${++counter}`, content: 'Hallo', ...body }, site: true });
  expect(response.status).toBe(201);
  return (await json<{ id: string }>(response)).id;
};
const write = async (token: string, id: string, body: Record<string, unknown>) =>
  expect((await call('POST', `/api/v1/widget/conversations/${id}/messages`, { token, body: { clientMessageId: `message-${++counter}`, content: 'Noch da?', ...body }, site: true })).status).toBe(201);
const conversation = async (id: string, token = boss) => json<{ visitorLanguage: string | null; version: number }>(await call('GET', `/api/v1/workspaces/${W}/conversations/${id}`, { token }));

describe("the visitor's language", () => {
  it('is kept from the first message that names one, in its usual spelling', async () => {
    const token = await visitor();
    const id = await start(token, { language: 'pt-br' });
    expect((await conversation(id)).visitorLanguage).toBe('pt-BR');
    // A later message in another language does not change it.
    await write(token, id, { language: 'de' });
    expect((await conversation(id)).visitorLanguage).toBe('pt-BR');
  });

  it('is filled in by a later message when the conversation began without one', async () => {
    const token = await visitor();
    const id = await start(token, {});
    expect((await conversation(id)).visitorLanguage).toBeNull();
    await write(token, id, { language: 'ru-RU' });
    expect((await conversation(id)).visitorLanguage).toBe('ru-RU');
  });

  it('refuses what is not a language tag', async () => {
    const token = await visitor();
    const response = await call('POST', '/api/v1/widget/conversations', { token, body: { clientMessageId: 'start-bad-tag', content: 'Hi', language: 'not a tag' }, site: true });
    expect(response.status).toBe(400);
  });

  it('can be corrected by a supervisor, and not by an agent', async () => {
    const id = await start(await visitor(), { language: 'en' });
    const { version } = await conversation(id);
    const denied = await call('PATCH', `/api/v1/workspaces/${W}/conversations/${id}`, { token: agent, body: { expectedVersion: version, visitorLanguage: 'de' } });
    expect(denied.status).toBe(403);
    const changed = await call('PATCH', `/api/v1/workspaces/${W}/conversations/${id}`, { token: boss, body: { expectedVersion: version, visitorLanguage: 'zh-hant' } });
    expect(changed.status).toBe(200);
    expect((await json<{ visitorLanguage: string }>(changed)).visitorLanguage).toBe('zh-Hant');
    const events = await env.DB.prepare(`SELECT event_type AS type, metadata_json AS metadata FROM conversation_events WHERE conversation_id = ?1`).bind(id).all();
    expect(events.results).toEqual([{ type: 'language_changed', metadata: '{"visitorLanguage":"zh-Hant"}' }]);
  });
});

describe("a member's language", () => {
  it('is kept on the server, the same in every workspace, and only one of OpenChat\'s own', async () => {
    expect((await json(await call('GET', '/api/v1/me', { token: boss }))).language).toBeNull();
    const changed = await call('PATCH', '/api/v1/me', { token: boss, body: { language: 'ja' } });
    expect(changed.status).toBe(200);
    expect((await json(changed)).language).toBe('ja');
    expect((await json(await call('GET', '/api/v1/me', { token: boss }))).language).toBe('ja');
    // Another person's is their own.
    expect((await json(await call('GET', '/api/v1/me', { token: agent }))).language).toBeNull();
    expect((await call('PATCH', '/api/v1/me', { token: boss, body: { language: 'ru' } })).status).toBe(400);
    expect((await call('PATCH', '/api/v1/me', { body: { language: 'de' } })).status).toBe(401);
  });
});
