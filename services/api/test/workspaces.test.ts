import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { hashPassword } from '@openchat/auth';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';

const testEnv = env;
const ORIGIN = 'https://example.com';
const PASSWORD = 'correct horse battery';

let hash = '';
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

let counter = 0;
const ip = () => `198.51.100.${++counter % 250}-${counter}`;

const call = (method: string, path: string, token?: string, body?: unknown) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        'cf-connecting-ip': ip(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    testEnv,
    createExecutionContext(),
  );

async function signIn(email: string, password = PASSWORD): Promise<string> {
  const response = await call('POST', '/api/v1/auth/login', undefined, { email, password, clientType: 'mobile' });
  expect(response.status).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

const tokens: Record<string, string> = {};
const W1 = '/api/v1/workspaces/work_1';
const W2 = '/api/v1/workspaces/work_2';

beforeEach(async () => {
  await env.DB.batch(['audit_log', 'websites', 'workspace_members', 'auth_sessions', 'auth_tokens', 'workspaces', 'users', 'installation'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const users = ['supervisor', 'agent', 'teammate', 'outsider'];
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installation (id, name, public_base_url, created_at, updated_at) VALUES ('inst_test', 'Test', '${ORIGIN}', 1, 1)`),
    env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('work_1', 'One', 'one', 1, 1), ('work_2', 'Two', 'two', 2, 2)`),
    ...users.map((u) => env.DB.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, 1)`).bind(`user_${u}`, `${u}@example.com`, u, hash)),
    env.DB.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) VALUES
       ('mem_supervisor', 'work_1', 'user_supervisor', 'supervisor', 'active', 1, 1), ('mem_agent', 'work_1', 'user_agent', 'agent', 'active', 1, 1),
       ('mem_teammate', 'work_1', 'user_teammate', 'agent', 'active', 1, 1), ('mem_outsider', 'work_2', 'user_outsider', 'supervisor', 'active', 1, 1)`,
    ),
  ]);
  for (const u of users) tokens[u] = await signIn(`${u}@example.com`);
});

describe('access', () => {
  it('requires a token on every workspace route', async () => {
    for (const [method, path] of [['GET', W1], ['GET', `${W1}/members`], ['GET', `${W1}/websites`]] as const) {
      expect((await call(method, path)).status).toBe(401);
    }
  });

  it('answers a non-member exactly as for a workspace that does not exist', async () => {
    const other = await call('GET', W1, tokens.outsider);
    const missing = await call('GET', '/api/v1/workspaces/work_missing', tokens.outsider);
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    const strip = async (r: Response) => {
      const body = (await r.json()) as Record<string, unknown>;
      delete body.requestId;
      return body;
    };
    expect(await strip(other)).toEqual(await strip(missing));
  });

  it('stops a suspended member at once', async () => {
    expect((await call('GET', W1, tokens.agent)).status).toBe(200);
    await env.DB.prepare(`UPDATE workspace_members SET status = 'suspended' WHERE id = 'mem_agent'`).run();
    expect((await call('GET', W1, tokens.agent)).status).toBe(404);
  });
});

describe('workspaces', () => {
  it('shows a member their workspace, and has no way to change it from inside', async () => {
    expect(await (await call('GET', W1, tokens.agent)).json()).toMatchObject({ id: 'work_1', name: 'One' });
    expect((await call('PATCH', W1, tokens.supervisor, { name: 'x' })).status).toBe(404);
  });
});

describe('members', () => {
  it('lists this workspace only, with pagination', async () => {
    const first = (await (await call('GET', `${W1}/members?limit=2`, tokens.agent)).json()) as { data: { id: string }[]; nextCursor: string };
    expect(first.data).toHaveLength(2);
    const second = (await (await call('GET', `${W1}/members?limit=2&cursor=${first.nextCursor}`, tokens.agent)).json()) as { data: { id: string }[]; nextCursor: null };
    expect(second.nextCursor).toBeNull();
    const ids = [...first.data, ...second.data].map((m) => m.id).sort();
    expect(ids).toEqual(['mem_agent', 'mem_supervisor', 'mem_teammate']);
  });

  it('lets a member set themselves away, and nobody else', async () => {
    const away = async () => ((await (await call('GET', `${W1}/members`, tokens.supervisor)).json()) as { data: { id: string; away: boolean }[] }).data.filter((m) => m.away).map((m) => m.id);
    expect(await away()).toEqual([]);
    const changed = await call('PATCH', `${W1}/members/me`, tokens.agent, { away: true });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ id: 'mem_agent', away: true });
    expect(await away()).toEqual(['mem_agent']);
    await call('PATCH', `${W1}/members/me`, tokens.agent, { away: false });
    expect(await away()).toEqual([]);
    // No member ID in the address, so there is nobody else to name. Other fields are refused.
    expect((await call('PATCH', `${W1}/members/me`, tokens.agent, { away: true, role: 'owner' })).status).toBe(400);
    expect((await call('PATCH', `${W1}/members/me`, tokens.outsider, { away: true })).status).toBe(404);
    expect((await call('PATCH', `${W1}/members/me`, undefined, { away: true })).status).toBe(401);
  });
});

describe('websites', () => {
  it('lists them to any member, and to nobody else', async () => {
    await env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, allowed_origins_json, created_at, updated_at) VALUES ('site_1', 'work_1', 'Main', 'key_1', '["https://example.org"]', 1, 1)`).run();
    const list = (await (await call('GET', `${W1}/websites`, tokens.agent)).json()) as { data: { id: string; allowedOrigins: string[] }[] };
    expect(list.data).toEqual([expect.objectContaining({ id: 'site_1', allowedOrigins: ['https://example.org'] })]);
    expect((await call('GET', `${W1}/websites`, tokens.outsider)).status).toBe(404);
    expect(((await (await call('GET', `${W2}/websites`, tokens.outsider)).json()) as { data: unknown[] }).data).toEqual([]);
  });
});

describe('saved replies', () => {
  const path = `${W1}/saved-replies`;
  type Saved = { id: string; title: string; content: string };
  const list = async (token = tokens.agent) => ((await (await call('GET', path, token)).json()) as { data: Saved[] }).data;

  it('are read by every member and written by supervisors', async () => {
    expect((await call('POST', path, tokens.agent, { title: 'Hello', content: 'Hi' })).status).toBe(403);
    const created = await call('POST', path, tokens.supervisor, { title: 'Shipping', content: '  We ship in two days.  ' });
    expect(created.status).toBe(201);
    const saved = (await created.json()) as Saved;
    expect(saved).toMatchObject({ title: 'Shipping', content: 'We ship in two days.' });
    expect(await list()).toMatchObject([{ id: saved.id, title: 'Shipping' }]);
    expect((await call('PATCH', `${path}/${saved.id}`, tokens.agent, { content: 'x' })).status).toBe(403);
    expect((await call('DELETE', `${path}/${saved.id}`, tokens.agent)).status).toBe(403);
    expect(await (await call('PATCH', `${path}/${saved.id}`, tokens.supervisor, { content: 'We ship tomorrow.' })).json()).toMatchObject({ title: 'Shipping', content: 'We ship tomorrow.' });
    expect((await call('DELETE', `${path}/${saved.id}`, tokens.supervisor)).status).toBe(204);
    expect((await call('DELETE', `${path}/${saved.id}`, tokens.supervisor)).status).toBe(404);
    expect(await list()).toEqual([]);
  });

  it('keep titles apart whatever their case, in order, and refuse an empty one', async () => {
    for (const title of ['Refund', 'Address']) expect((await call('POST', path, tokens.supervisor, { title, content: 'x' })).status).toBe(201);
    const again = await call('POST', path, tokens.supervisor, { title: 'refund', content: 'y' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe('saved_reply_exists');
    const rows = await list();
    expect(rows.map((r) => r.title)).toEqual(['Address', 'Refund']);
    expect((await call('PATCH', `${path}/${rows[0]!.id}`, tokens.supervisor, { title: 'REFUND' })).status).toBe(409);
    expect((await call('POST', path, tokens.supervisor, { title: 'Empty', content: '   ' })).status).toBe(400);
    expect((await call('PATCH', `${path}/${rows[0]!.id}`, tokens.supervisor, {})).status).toBe(400);
  });

  it('stop at 200 for a workspace', async () => {
    await env.DB.batch(Array.from({ length: 200 }, (_, i) => env.DB.prepare(`INSERT INTO saved_replies (id, workspace_id, title, content, created_at, updated_at) VALUES (?1, 'work_1', ?2, 'x', 1, 1)`).bind(`srep_${i}`, `Title ${i}`)));
    const full = await call('POST', path, tokens.supervisor, { title: 'One more', content: 'x' });
    expect(full.status).toBe(409);
    expect(((await full.json()) as { code: string }).code).toBe('too_many_saved_replies');
  });
});
