/**
 * Published help articles as a source for the AI assistant (ADR-0023, step 4): what it reads, that only published
 * articles answer, that a change replaces the copy, and that unpublishing and deleting remove the vectors. Workers AI
 * and Vectorize are fakes; everything else is the real Worker and D1.
 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { hashPassword } from '@openchat/auth';
import { helpArticleAssistantText } from '@openchat/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleQueue } from '../src/background';
import { sweepOutbox } from '../src/dispatch';
import type { Env } from '../src/env';
import worker from '../src/index';
import { fakeAssistant } from './assistant-fakes';

const ORIGIN = 'https://chat.example.com';
const PASSWORD = 'correct horse battery';
const W = 'work_a';

type Job = { type: string; workspaceId: string; idempotencyKey: string; payload: Record<string, unknown> };
let jobs: Job[] = [];
const queue = { send: async (job: Job) => void jobs.push(job), sendBatch: async (list: { body: Job }[]) => void jobs.push(...list.map((j) => j.body)) } as unknown as Queue;
let fake = fakeAssistant();
let target: Env;
const envWith = (extra: Record<string, unknown> = {}) =>
  ({ ...env, JOBS_QUEUE: queue, NOTIFICATIONS_QUEUE: queue, EMAIL_QUEUE: queue, ASSISTANT_QUEUE: queue, AI: fake.ai, VECTORIZE: fake.vectorize, ...extra }) as unknown as Env;

let counter = 0;
async function call(method: string, path: string, options: { token?: string; body?: unknown } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        'cf-connecting-ip': `198.51.100.${++counter % 250}`,
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    target,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

/** Runs the outbox and the queued jobs, as the queues would, until nothing is left. */
async function runJobs() {
  await sweepOutbox(target, Date.now() + 120_000);
  while (jobs.length > 0) {
    const batch = jobs.splice(0).filter((job) => job.type.startsWith('help.') || job.type.startsWith('assistant.'));
    await handleQueue({ queue: 'oc-local-jobs', messages: batch.map((body) => ({ id: crypto.randomUUID(), body, attempts: 1, ack: () => undefined, retry: () => undefined })) } as unknown as MessageBatch, target);
    await sweepOutbox(target, Date.now() + 120_000);
  }
}

let hash = '';
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

let boss = '';
beforeEach(async () => {
  jobs = [];
  fake = fakeAssistant();
  target = envWith();
  const tables = ['help_article_chunks', 'help_articles', 'help_collections', 'assistant_chunks', 'assistant_sources', 'assistant_settings', 'assistant_usage', 'outbox', 'audit_log', 'websites', 'workspace_members', 'auth_tokens', 'auth_sessions', 'workspaces', 'users', 'installation', 'job_receipts'];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installation (id, name, public_base_url, created_at, updated_at) VALUES ('inst_test', 'Test', ?1, 1, 1)`).bind(ORIGIN),
    env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?1, 'Acme', 'acme', 1, 1)`).bind(W),
    env.DB.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('user_boss', 'boss@example.com', 'Boss', ?1, 1, 1)`).bind(hash),
    env.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) VALUES ('mem_boss', ?1, 'user_boss', 'supervisor', 'active', 1, 1)`).bind(W),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, allowed_origins_json, help_slug, created_at, updated_at) VALUES ('site_a', ?1, 'Shop', 'key_a', '["https://shop.example"]', 'shop', 1, 1)`).bind(W),
  ]);
  const login = await call('POST', '/api/v1/auth/login', { body: { email: 'boss@example.com', password: PASSWORD, clientType: 'dashboard' } });
  boss = ((await login.json()) as { accessToken: string }).accessToken;
});

// ---------- Helpers ----------

const assistantPath = `/api/v1/workspaces/${W}/websites/site_a/assistant`;
const saveSettings = async () => {
  expect((await call('PUT', `${assistantPath}/settings`, { token: boss, body: { name: 'Sam', model: null } })).status).toBe(200);
  await runJobs();
};

type Article = { id: string; version: number };
async function article(input: Record<string, unknown>, publish = true): Promise<Article> {
  const created = await call('POST', `/api/v1/workspaces/${W}/websites/site_a/help/articles`, { token: boss, body: { language: 'en', ...input } });
  expect(created.status).toBe(201);
  let row = (await created.json()) as Article;
  if (publish) row = await status(row, 'published');
  return row;
}
async function status(row: Article, value: 'published' | 'draft'): Promise<Article> {
  const response = await call('PUT', `/api/v1/workspaces/${W}/help/articles/${row.id}/status`, { token: boss, body: { status: value } });
  expect(response.status).toBe(200);
  await runJobs();
  return (await response.json()) as Article;
}
async function edit(row: Article, change: Record<string, unknown>): Promise<Article> {
  const response = await call('PATCH', `/api/v1/workspaces/${W}/help/articles/${row.id}`, { token: boss, body: { expectedVersion: row.version, ...change } });
  expect(response.status).toBe(200);
  await runJobs();
  return (await response.json()) as Article;
}

type Answer = { outcome: string; answer: string | null; sources: { title: string; url: string | null }[] };
const ask = async (question: string) => {
  const response = await call('POST', `${assistantPath}/test`, { token: boss, body: { question } });
  expect(response.status).toBe(200);
  return (await response.json()) as Answer;
};
const vectorIds = () => [...fake.state.vectors.keys()].sort();
const counts = async () => ((await (await call('GET', assistantPath, { token: boss })).json()) as { helpArticles: { published: number; inUse: number } }).helpArticles;

const RETURNS = { title: 'How returns work', summary: 'Send it back within 30 days', bodyMarkdown: 'Pack the parcel and print the return label from [your orders](https://shop.example/orders).' };

// ---------- Tests ----------

describe('what the assistant reads', () => {
  it('keeps link addresses after their words, makes help links absolute, and drops other links and images', () => {
    const text = helpArticleAssistantText(
      { title: 'Returns', summary: 'In short', bodyMarkdown: '# Steps\n\nSee [orders](https://shop.example/orders), [shipping](/help/shop/en/shipping), [mail us](mailto:help@shop.example) and [old](http://insecure.example).\n\n![Box](/help-assets/hast_x)' },
      'https://chat.example.com/',
    );
    expect(text).toBe('Returns\n\nIn short\n\nSteps\nSee orders (https://shop.example/orders), shipping (https://chat.example.com/help/shop/en/shipping), mail us (help@shop.example) and old.\nBox');
  });
});

describe('published articles as a source', () => {
  it('answers from a published article, with a link to its page, once the assistant is set up', async () => {
    await article(RETURNS);
    // No assistant yet: nothing is read.
    expect(vectorIds()).toEqual([]);
    await saveSettings();
    expect(await counts()).toEqual({ published: 1, inUse: 1 });
    const result = await ask('How do I pack the parcel and print the return label from your orders?');
    expect(result.outcome).toBe('answered');
    expect(result.sources[0]).toMatchObject({ title: 'How returns work', url: `${ORIGIN}/help/shop/en/how-returns-work` });
    // Its address was in the article, so the answer may give it.
    fake.state.reply = () => 'Print it from https://shop.example/orders and https://evil.example/x';
    expect((await ask('How do I pack the parcel and print the return label from your orders?')).answer).toBe('Print it from https://shop.example/orders and');
  });

  it('never reads a draft', async () => {
    await saveSettings();
    await article({ title: 'Secret plans', bodyMarkdown: 'A new store opens in Paris next spring.' }, false);
    await runJobs();
    expect(vectorIds()).toEqual([]);
    expect((await ask('Is a new store opening in Paris?')).outcome).toBe('no_sources');
  });

  it('replaces its copy when a published article changes, and removes the old vectors', async () => {
    await saveSettings();
    const first = await article(RETURNS);
    const before = vectorIds();
    expect(before.every((id) => id.startsWith(`${first.id}.${first.version}.`))).toBe(true);
    const changed = await edit(first, { bodyMarkdown: 'Returns are free for 60 days. Use the prepaid label in the box.' });
    expect(vectorIds().every((id) => id.startsWith(`${changed.id}.${changed.version}.`))).toBe(true);
    expect(vectorIds()).not.toEqual(before);
    expect((await ask('How many days do I have for free returns with the prepaid label?')).outcome).toBe('answered');
    expect(fake.state.prompts.at(-1)!.messages[0]!.content).toContain('60 days');
    expect(fake.state.prompts.at(-1)!.messages[0]!.content).not.toContain('Pack the parcel');
  });

  it('takes an article out when it is unpublished or deleted', async () => {
    await saveSettings();
    const one = await article(RETURNS);
    const two = await article({ title: 'Shipping times', bodyMarkdown: 'Parcels arrive in three to five days.' });
    expect(await counts()).toEqual({ published: 2, inUse: 2 });
    await status(one, 'draft');
    expect(vectorIds().some((id) => id.startsWith(one.id))).toBe(false);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM help_article_chunks WHERE article_id = ?1`).bind(one.id).first<{ n: number }>())!.n).toBe(0);
    expect((await ask('How do I pack the parcel and print the return label from your orders?')).sources.map((s) => s.title)).not.toContain('How returns work');
    expect((await call('DELETE', `/api/v1/workspaces/${W}/help/articles/${two.id}`, { token: boss })).status).toBe(204);
    await runJobs();
    expect(vectorIds()).toEqual([]);
    expect(await counts()).toEqual({ published: 0, inUse: 0 });
  });

  it('gives no link when the website has no help centre address', async () => {
    await env.DB.prepare(`UPDATE websites SET help_slug = NULL`).run();
    await saveSettings();
    await article(RETURNS);
    expect((await ask('How do I pack the parcel and print the return label from your orders?')).sources[0]).toMatchObject({ title: 'How returns work', url: null });
  });

  it('a copy finished after the article changed is thrown away', async () => {
    await saveSettings();
    const row = await article(RETURNS, false);
    // Published, but the job runs only after a later edit has moved the article on.
    const published = await call('PUT', `/api/v1/workspaces/${W}/help/articles/${row.id}/status`, { token: boss, body: { status: 'published' } });
    const { version } = (await published.json()) as Article;
    await sweepOutbox(target, Date.now() + 120_000);
    const queued = jobs.splice(0);
    await edit({ id: row.id, version }, { title: 'How returns work now' });
    jobs.push(...queued);
    await runJobs();
    expect(vectorIds().every((id) => id.startsWith(`${row.id}.${version + 1}.`))).toBe(true);
  });

  it('without Workers AI, saves and publishes as before and reads nothing', async () => {
    target = envWith({ AI: undefined, VECTORIZE: undefined });
    await saveSettings();
    await article(RETURNS);
    expect(vectorIds()).toEqual([]);
    expect(await counts()).toEqual({ published: 1, inUse: 0 });
  });
});
