/**
 * The AI assistant learning from resolved conversations (ADR-0022, step 3): what it reads, the checks for personal
 * data, approval, and that erasure and retention take what it learned. Workers AI and Vectorize are fakes;
 * everything else is the real Worker and D1.
 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { hashPassword } from '@openchat/auth';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleQueue } from '../src/background';
import { dispatchNow, sweepOutbox } from '../src/dispatch';
import type { Env } from '../src/env';
import worker from '../src/index';
import { expireConversations, openDatabase } from '@openchat/database';
import { fakeAssistant, type Turn } from './assistant-fakes';

const ORIGIN = 'https://chat.example.com';
const SITE = 'https://shop.example';
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
async function call(method: string, path: string, options: { token?: string; body?: unknown; origin?: string; env?: Env } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        'cf-connecting-ip': `198.51.100.${++counter % 250}`,
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    options.env ?? target,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

/** Runs queued jobs, as the queues would, and the outbox rows they leave. Push and email jobs are dropped. */
async function runJobs() {
  await sweepOutbox(target, Date.now() + 120_000);
  while (jobs.length > 0) {
    const batch = jobs.splice(0).filter((job) => job.type.startsWith('assistant.'));
    await handleQueue({ queue: 'oc-local-jobs', messages: batch.map((body) => ({ id: crypto.randomUUID(), body, attempts: 1, ack: () => undefined, retry: () => undefined })) } as unknown as MessageBatch, target);
    await sweepOutbox(target, Date.now() + 120_000);
  }
}

let hash = '';
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

const tokens: Record<string, string> = {};
beforeEach(async () => {
  jobs = [];
  fake = fakeAssistant();
  target = envWith();
  const tables = ['assistant_learned', 'assistant_chunks', 'assistant_sources', 'assistant_settings', 'assistant_usage', 'outbox', 'audit_log', 'conversation_events', 'messages', 'conversation_read_cursors', 'conversations', 'visitors', 'contacts', 'websites', 'workspace_members', 'auth_tokens', 'auth_sessions', 'workspaces', 'users', 'installation', 'job_receipts'];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installation (id, name, public_base_url, created_at, updated_at) VALUES ('inst_test', 'Test', ?1, 1, 1)`).bind(ORIGIN),
    env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?1, 'Acme', 'acme', 1, 1)`).bind(W),
    ...[['boss', 'supervisor'], ['agent', 'agent']].flatMap(([name, role]) => [
      env.DB.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, 1)`).bind(`user_${name}`, `${name}@example.com`, name, hash),
      env.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'active', 1, 1)`).bind(`mem_${name}`, W, `user_${name}`, role),
    ]),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, allowed_origins_json, created_at, updated_at) VALUES ('site_a', ?1, 'Shop', 'key_a', json_array(?2), 1, 1)`).bind(W, SITE),
    // Erasure is for an installation admin.
    env.DB.prepare(`UPDATE users SET is_installation_admin = 1 WHERE id = 'user_boss'`),
  ]);
  for (const name of ['boss', 'agent']) {
    const login = await call('POST', '/api/v1/auth/login', { body: { email: `${name}@example.com`, password: PASSWORD, clientType: 'dashboard' } });
    tokens[name] = ((await login.json()) as { accessToken: string }).accessToken;
  }
});

// ---------- Helpers ----------

const assistantPath = `/api/v1/workspaces/${W}/websites/site_a/assistant`;
const settings = (body: Record<string, unknown>, as = 'boss') => call('PUT', `${assistantPath}/settings`, { token: tokens[as]!, body: { name: 'Sam', model: null, ...body } });

const LEARNED = 'QUESTION: How long do I have to return an item?\nANSWER: You can return any item for a full refund within 30 days.';
/** What the model writes when asked to learn; anything else is answered as by default. */
let learnedReply: (messages: Turn[]) => string = () => LEARNED;
const learningPrompts = () => fake.state.prompts.filter((p) => p.messages[0]!.content.includes('help-centre'));

interface Resolved { conversationId: string; contactId: string; token: string }

/** A visitor asks, a member answers, and the conversation is resolved: the learning job runs. */
async function resolvedConversation(question: string, reply: string | null = 'You have 30 days to return it for a full refund.'): Promise<Resolved> {
  const session = await call('POST', '/api/v1/widget/sessions', { origin: SITE, body: { websiteKey: 'key_a' } });
  const token = ((await session.json()) as { accessToken: string }).accessToken;
  const created = await call('POST', '/api/v1/widget/conversations', { origin: SITE, token, body: { clientMessageId: crypto.randomUUID(), content: question } });
  const conversationId = ((await created.json()) as { id: string }).id;
  if (reply !== null) await memberSays(conversationId, reply);
  await resolve(conversationId);
  const c = (await (await call('GET', `/api/v1/workspaces/${W}/conversations/${conversationId}`, { token: tokens.agent! })).json()) as { contactId: string };
  return { conversationId, contactId: c.contactId, token };
}

async function memberSays(conversationId: string, content: string, type = 'text') {
  expect((await call('POST', `/api/v1/workspaces/${W}/conversations/${conversationId}/messages`, { token: tokens.agent!, body: { clientMessageId: crypto.randomUUID(), type, content } })).status).toBe(201);
}

async function setStatus(conversationId: string, status: string) {
  const path = `/api/v1/workspaces/${W}/conversations/${conversationId}`;
  const { version } = (await (await call('GET', path, { token: tokens.agent! })).json()) as { version: number };
  expect((await call('PATCH', path, { token: tokens.agent!, body: { expectedVersion: version, status } })).status).toBe(200);
  await runJobs();
}
const resolve = (conversationId: string) => setStatus(conversationId, 'resolved');

type Learned = { id: string; conversationId: string; question: string; answer: string; status: string; inUse: boolean };
const learned = async (status = 'pending', as = 'boss') => {
  const response = await call('GET', `${assistantPath}/learned?status=${status}`, { token: tokens[as]! });
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: Learned[] }).data;
};
const decide = (id: string, body: Record<string, unknown>, as = 'boss') => call('PATCH', `/api/v1/workspaces/${W}/assistant/learned/${id}`, { token: tokens[as]!, body });
const vectorIds = () => [...fake.state.vectors.keys()];
const rows = async () => (await env.DB.prepare(`SELECT status, discard_reason AS reason, learned_seq AS seq FROM assistant_learned ORDER BY created_at`).all<{ status: string; reason: string | null; seq: number }>()).results;

beforeEach(() => {
  learnedReply = () => LEARNED;
  const answer = fake.state.reply;
  fake.state.reply = (messages) => (messages[0]!.content.includes('help-centre') ? learnedReply(messages) : answer(messages));
});

// ---------- Tests ----------

describe('learning', () => {
  it('is off until a supervisor turns it on', async () => {
    await settings({});
    await resolvedConversation('How long do I have to return something?');
    expect(learningPrompts()).toEqual([]);
    expect(await rows()).toEqual([]);
    expect((await settings({ learn: true }, 'agent')).status).toBe(403);
    expect(await (await settings({ learn: true })).json()).toEqual({ name: 'Sam', model: null, enabled: false, learn: true, instructions: null, handoverMessage: null });
  });

  it('reads only what the visitor and the team wrote in public, and waits for approval', async () => {
    await settings({ learn: true });
    const c = await resolvedConversation('How long do I have to return something?', null);
    // Nothing was learned on resolving: there was no reply. Reopened, answered, noted, and resolved again, it is.
    expect(await rows()).toMatchObject([{ status: 'discarded', reason: 'no_reply' }]);
    expect(learningPrompts()).toEqual([]);
    await setStatus(c.conversationId, 'open');
    await memberSays(c.conversationId, 'You have 30 days to return it for a full refund.');
    await memberSays(c.conversationId, 'secret note about this customer', 'internal_note');
    await resolve(c.conversationId);

    const [prompt] = learningPrompts();
    const text = prompt!.messages.map((m) => m.content).join('\n');
    expect(prompt!.messages.map((m) => m.role)).toEqual(['system', 'user', 'system']);
    expect(prompt!.messages[1]!.content).toBe('<chat>\nVisitor: How long do I have to return something?\nTeam: You have 30 days to return it for a full refund.\n</chat>');
    expect(text).not.toContain('secret note');
    expect(prompt!.messages[0]!.content).toContain('"Shop"');

    const [item] = await learned();
    expect(item).toMatchObject({ conversationId: c.conversationId, question: 'How long do I have to return an item?', answer: 'You can return any item for a full refund within 30 days.', status: 'pending', inUse: false });
    // Not used until approved.
    expect(vectorIds().filter((id) => id.startsWith('alrn_'))).toEqual([]);
    // Agents cannot see or decide.
    expect((await call('GET', `${assistantPath}/learned`, { token: tokens.agent! })).status).toBe(403);
    expect((await decide(item!.id, { status: 'approved' }, 'agent')).status).toBe(403);
  });

  it('learns once, however often the conversation changes while resolved', async () => {
    await settings({ learn: true });
    const c = await resolvedConversation('How long do I have to return something?');
    const path = `/api/v1/workspaces/${W}/conversations/${c.conversationId}`;
    const { version } = (await (await call('GET', path, { token: tokens.agent! })).json()) as { version: number };
    expect((await call('PATCH', path, { token: tokens.agent!, body: { expectedVersion: version, priority: 'high' } })).status).toBe(200);
    await runJobs();
    expect(learningPrompts()).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it('keeps nothing that names someone or holds contact details, and does not ask again', async () => {
    await settings({ learn: true });
    for (const [reply, reason] of [
      ['QUESTION: Where is my order?\nANSWER: Email boss@example.com and we will look.', 'email'],
      ['QUESTION: Can I call?\nANSWER: Call +44 20 7946 0958 any day.', 'phone'],
      ['QUESTION: Where is order 48213?\nANSWER: It ships tomorrow.', 'long_number'],
      ['QUESTION: Can I return it?\nANSWER: Yes, agent will sort it out for you.', 'name'],
      ['QUESTION: Where do I track it?\nANSWER: At https://shop.example/track?order=1.', 'url_query'],
      ['NONE', 'nothing'],
    ] as const) {
      learnedReply = () => reply;
      await resolvedConversation(`A question about ${reason}?`);
      expect((await rows()).at(-1)).toMatchObject({ status: 'discarded', reason });
    }
    expect(await learned()).toEqual([]);
    // A discarded conversation is not read again without new messages.
    const asked = learningPrompts().length;
    const [first] = (await env.DB.prepare(`SELECT conversation_id AS id FROM assistant_learned LIMIT 1`).all<{ id: string }>()).results;
    await setStatus(first!.id, 'open');
    await resolve(first!.id);
    expect(learningPrompts()).toHaveLength(asked);
  });

  it("does not name the visitor, even when the model does", async () => {
    await settings({ learn: true });
    const c = await resolvedConversation('Hi, can I return my shoes?');
    await env.DB.prepare(`UPDATE contacts SET name = 'Olivia Bennett' WHERE id = ?1`).bind(c.contactId).run();
    await setStatus(c.conversationId, 'open');
    await memberSays(c.conversationId, 'Yes, within 30 days.');
    learnedReply = () => 'QUESTION: Can Olivia return shoes?\nANSWER: Yes, within 30 days.';
    await resolve(c.conversationId);
    expect(await rows()).toMatchObject([{ status: 'discarded', reason: 'name' }]);
  });

  it('counts against the daily limit, and stops there', async () => {
    await settings({ learn: true });
    await env.DB.prepare(`INSERT INTO assistant_usage (workspace_id, day, answers) VALUES (?1, ?2, 1000000)`).bind(W, new Date().toISOString().slice(0, 10)).run();
    await resolvedConversation('How long do I have to return something?');
    expect(learningPrompts()).toEqual([]);
    expect(await rows()).toEqual([]);
  });
});

describe('approval', () => {
  beforeEach(async () => {
    await settings({ learn: true });
    expect((await call('POST', `${assistantPath}/sources`, { token: tokens.boss!, body: { kind: 'text', title: 'Hours', content: 'We are open from 9 to 5.' } })).status).toBe(201);
    await runJobs();
  });

  it('puts an approved answer to use, with the words a supervisor changed', async () => {
    await resolvedConversation('How long do I have to return something?');
    const [item] = await learned();
    const approved = await decide(item!.id, { status: 'approved', answer: 'Return any item within 30 days for a full refund.' });
    expect(approved.status).toBe(200);
    await runJobs();
    const [now] = await learned('approved');
    expect(now).toMatchObject({ answer: 'Return any item within 30 days for a full refund.', inUse: true });
    expect(vectorIds()).toContain(`${item!.id}.2.0`);
    // The test panel finds it, as a visitor's question would.
    const answer = (await (await call('POST', `${assistantPath}/test`, { token: tokens.boss!, body: { question: 'How long do I have to return an item for a refund?' } })).json()) as { sources: { title: string }[] };
    expect(answer.sources[0]!.title).toBe('How long do I have to return an item?');
  });

  it('stops using one that is rejected or deleted', async () => {
    await resolvedConversation('How long do I have to return something?');
    await resolvedConversation('How long can I return things for?');
    const [one, two] = await learned();
    for (const item of [one!, two!]) expect((await decide(item.id, { status: 'approved' })).status).toBe(200);
    await runJobs();
    expect(vectorIds().filter((id) => id.startsWith('alrn_'))).toHaveLength(2);
    expect((await decide(one!.id, { status: 'rejected' })).status).toBe(200);
    expect((await call('DELETE', `/api/v1/workspaces/${W}/assistant/learned/${two!.id}`, { token: tokens.boss! })).status).toBe(204);
    await runJobs();
    expect(vectorIds().filter((id) => id.startsWith('alrn_'))).toEqual([]);
    expect(await learned('rejected')).toHaveLength(1);
    expect(await learned('approved')).toEqual([]);
    // A decision stands: resolving again does not replace it.
    const asked = learningPrompts().length;
    await setStatus(one!.conversationId, 'open');
    await memberSays(one!.conversationId, 'Anything else?');
    await resolve(one!.conversationId);
    expect(learningPrompts()).toHaveLength(asked);
    expect(await learned('rejected')).toHaveLength(1);
  });

  it('relearns one still waiting, when the conversation has more to say', async () => {
    const c = await resolvedConversation('How long do I have to return something?');
    await setStatus(c.conversationId, 'open');
    await memberSays(c.conversationId, 'And shipping back is free.');
    learnedReply = () => 'QUESTION: Is returning free?\nANSWER: Yes, within 30 days, and shipping back is free.';
    await resolve(c.conversationId);
    expect(await learned()).toMatchObject([{ question: 'Is returning free?' }]);
  });

  it('can skip approval for the whole workspace, recorded in the audit log', async () => {
    const path = `/api/v1/workspaces/${W}/assistant/learning`;
    expect((await call('PUT', path, { token: tokens.agent!, body: { autoApprove: true } })).status).toBe(403);
    expect(await (await call('PUT', path, { token: tokens.boss!, body: { autoApprove: true } })).json()).toEqual({ autoApprove: true });
    expect(await (await call('PUT', path, { token: tokens.boss!, body: { autoApprove: true } })).json()).toEqual({ autoApprove: true });
    const audit = await env.DB.prepare(`SELECT action, actor_id AS actor, metadata_json AS meta FROM audit_log WHERE action = 'assistant.auto_approve_changed'`).all();
    expect(audit.results).toEqual([{ action: 'assistant.auto_approve_changed', actor: 'user_boss', meta: '{"autoApprove":1}' }]);
    await resolvedConversation('How long do I have to return something?');
    const [item] = await learned('approved');
    expect(item).toMatchObject({ inUse: true });
    const shown = (await (await call('GET', assistantPath, { token: tokens.boss! })).json()) as { learning: unknown };
    expect(shown.learning).toEqual({ autoApprove: true, pending: 0, approved: 1, rejected: 0 });
  });
});

describe('erasure and retention', () => {
  beforeEach(async () => {
    await settings({ learn: true });
    await call('PUT', `/api/v1/workspaces/${W}/assistant/learning`, { token: tokens.boss!, body: { autoApprove: true } });
  });

  it('erasing the contact deletes what was learned from them, and its vector', async () => {
    const c = await resolvedConversation('How long do I have to return something?');
    const other = await resolvedConversation('How long can I return things for?');
    expect(vectorIds().filter((id) => id.startsWith('alrn_'))).toHaveLength(2);
    expect((await call('DELETE', `/api/v1/workspaces/${W}/contacts/${c.contactId}`, { token: tokens.boss! })).status).toBe(204);
    await runJobs();
    const left = (await env.DB.prepare(`SELECT id, conversation_id AS conversationId FROM assistant_learned`).all<{ id: string; conversationId: string }>()).results;
    expect(left.map((r) => r.conversationId)).toEqual([other.conversationId]);
    expect(vectorIds().filter((id) => id.startsWith('alrn_'))).toEqual([`${left[0]!.id}.1.0`]);
  });

  it('retention deletes it with the conversation', async () => {
    await resolvedConversation('How long do I have to return something?');
    expect(vectorIds().filter((id) => id.startsWith('alrn_'))).toHaveLength(1);
    await env.DB.batch([env.DB.prepare(`UPDATE workspaces SET retention_days = 30`), env.DB.prepare(`UPDATE conversations SET last_message_at = 1`)]);
    expect(await expireConversations(openDatabase(env.DB), { id: W, retentionDays: 30 }, 50)).toBe(1);
    // As the next sweep would: the rows are the workspace's.
    await dispatchNow(target, W, [W]);
    expect(await rows()).toEqual([]);
    expect(vectorIds().filter((id) => id.startsWith('alrn_'))).toEqual([]);
  });
});
