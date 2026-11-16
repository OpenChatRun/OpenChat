import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';

const ORIGIN = 'https://chat.example.com';
const CODE = 'river-stone-42';
const PASSWORD = 'correct horse battery';

// Durable Object storage outlives each test, so each test has its own IP address.
let run = 0;
let ip = '';

beforeEach(async () => {
  ip = `198.51.100.${++run}`;
  await env.DB.batch(['audit_log', 'workspace_members', 'workspaces', 'auth_tokens', 'auth_sessions', 'users', 'installation'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

const call = (method: string, path: string, body: unknown, environment: Partial<Env>) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { 'cf-connecting-ip': ip, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { ...env, ...environment } as unknown as Env,
    createExecutionContext(),
  );

const status = async (environment: Partial<Env>) => ((await (await call('GET', '/api/v1/setup', undefined, environment)).json()) as { status: string }).status;
const answers = { name: 'Acme', ownerName: 'Ada Owner', email: 'ada@example.com', password: PASSWORD };
const setUp = (setupCode: string, environment: Partial<Env> = { SETUP_CODE: CODE }, extra: Record<string, unknown> = {}) =>
  call('POST', '/api/v1/setup', { setupCode, ...answers, ...extra }, environment);
const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe('first-time setup', () => {
  it('says what state the installation is in', async () => {
    expect(await status({})).toBe('unconfigured');
    expect(await status({ SETUP_CODE: '  ' })).toBe('unconfigured');
    expect(await status({ SETUP_CODE: CODE })).toBe('needed');
    expect((await setUp(CODE)).status).toBe(204);
    expect(await status({ SETUP_CODE: CODE })).toBe('ready');
    expect(await status({})).toBe('ready');
  });

  it('does not exist without a setup code', async () => {
    expect((await setUp(CODE, {})).status).toBe(404);
    expect((await setUp('', { SETUP_CODE: '' })).status).toBe(400);
    expect((await setUp(' ', { SETUP_CODE: ' ' })).status).toBe(404);
    expect(await count('installation')).toBe(0);
  });

  it('turns away a wrong code and creates nothing', async () => {
    const response = await setUp('river-stone-43');
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('wrong_setup_code');
    expect(await count('installation')).toBe(0);
    expect(await count('users')).toBe(0);
  });

  it('creates the installation, its admin and their workspace, and the admin can sign in', async () => {
    expect((await setUp(CODE)).status).toBe(204);
    const installation = await env.DB.prepare(`SELECT name, public_base_url AS url FROM installation`).first<{ name: string; url: string }>();
    expect(installation).toEqual({ name: 'Acme', url: ORIGIN });
    const user = await env.DB.prepare(`SELECT id, email, name, is_installation_admin AS admin FROM users`).first<{ id: string; email: string; name: string; admin: number }>();
    expect(user).toMatchObject({ email: 'ada@example.com', name: 'Ada Owner', admin: 1 });
    const member = await env.DB.prepare(`SELECT m.role, m.status, w.name FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?1`).bind(user!.id).first();
    expect(member).toEqual({ role: 'supervisor', status: 'active', name: 'Acme' });
    expect(await env.DB.prepare(`SELECT action, actor_id AS actor FROM audit_log`).first()).toEqual({ action: 'installation.created', actor: user!.id });

    const login = await call('POST', '/api/v1/auth/login', { email: 'ada@example.com', password: PASSWORD, clientType: 'mobile' }, {});
    expect(login.status).toBe(200);
    const discovery = await call('GET', '/.well-known/openchat.json', undefined, {});
    expect(((await discovery.json()) as { name: string }).name).toBe('Acme');
  });

  it('works once: afterwards it is gone, even with the right code', async () => {
    expect((await setUp(CODE)).status).toBe(204);
    expect((await setUp(CODE, { SETUP_CODE: CODE }, { email: 'eve@example.com' })).status).toBe(404);
    expect(await count('users')).toBe(1);
  });

  it('lets one of two at the same moment win', async () => {
    const results = await Promise.all([setUp(CODE), setUp(CODE, { SETUP_CODE: CODE }, { email: 'bob@example.com' })]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
    expect(await count('installation')).toBe(1);
    expect(await count('users')).toBe(1);
    expect(await count('workspaces')).toBe(1);
  });

  it('refuses a short password and unknown fields', async () => {
    expect((await setUp(CODE, { SETUP_CODE: CODE }, { password: 'short' })).status).toBe(400);
    expect((await setUp(CODE, { SETUP_CODE: CODE }, { isInstallationAdmin: true })).status).toBe(400);
    expect(await count('installation')).toBe(0);
  });

  it('limits guesses from one address', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) statuses.push((await setUp(`guess-${attempt}`)).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(403));
    expect(statuses[10]).toBe(429);
    expect((await setUp(CODE)).status).toBe(429);
  });
});
