import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { hashPassword } from '@openchat/auth';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';

const ORIGIN = 'https://chat.example.com';
const PASSWORD = 'correct horse battery';
const W = '/api/v1/workspaces/work_1';
const testEnv = env as unknown as Env;
const C = `${W}/contacts/cont_1`;
const CONV = `${W}/conversations/conv_1`;

let counter = 0;
async function call(method: string, path: string, token: string | null, body?: unknown) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { 'cf-connecting-ip': `203.0.113.${++counter}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}
const json = async <T = Record<string, unknown>>(response: Response) => (await response.json()) as T;

let hash = '';
let owner = '';
let agent = '';
const login = async (email: string) => (await json<{ accessToken: string }>(await call('POST', '/api/v1/auth/login', null, { email, password: PASSWORD, clientType: 'mobile' }))).accessToken;
const createTag = async (name: string) => json<{ id: string; name: string }>(await call('POST', `${W}/tags`, agent, { name }));
const conversation = async () => json<{ version: number; updatedAt: string; tags: { id: string; name: string }[]; contactName: string | null; contactEmail: string | null }>(await call('GET', CONV, agent));

beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await env.DB.batch(['outbox', 'conversation_events', 'conversation_tags', 'tags', 'messages', 'conversations', 'contacts', 'websites', 'workspace_members', 'auth_sessions', 'workspaces', 'users', 'installation'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installation (id, name, public_base_url, created_at, updated_at) VALUES ('inst_test', 'Test', '${ORIGIN}', 1, 1)`),
    env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('work_1', 'One', 'one', 1, 1), ('work_2', 'Two', 'two', 1, 1)`),
    env.DB.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('user_o', 'owner@example.com', 'Owner', ?1, 1, 1), ('user_a', 'agent@example.com', 'Agent', ?1, 1, 1)`).bind(hash),
    env.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) VALUES ('mem_o', 'work_1', 'user_o', 'supervisor', 'active', 1, 1), ('mem_a', 'work_1', 'user_a', 'agent', 'active', 1, 1)`),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, created_at, updated_at) VALUES ('site_1', 'work_1', 'Shop', 'key_1', 1, 1)`),
    env.DB.prepare(`INSERT INTO contacts (id, workspace_id, name, email, phone, first_seen_at, last_seen_at, created_at, updated_at) VALUES ('cont_1', 'work_1', 'Ann', 'ann@example.com', '123', 1000, 2000, 1, 1)`),
    env.DB.prepare(`INSERT INTO conversations (id, workspace_id, website_id, contact_id, last_message_at, created_at, updated_at) VALUES ('conv_1', 'work_1', 'site_1', 'cont_1', 1, 1, 1)`),
    env.DB.prepare(`INSERT INTO tags (id, workspace_id, name, created_at) VALUES ('tag_foreign', 'work_2', 'theirs', 1)`),
  ]);
  owner = await login('owner@example.com');
  agent = await login('agent@example.com');
});

describe('contacts', () => {
  it('reads, with times as dates, and shows on the conversation', async () => {
    expect(await json(await call('GET', C, agent))).toEqual({ id: 'cont_1', name: 'Ann', email: 'ann@example.com', phone: '123', firstSeenAt: new Date(1000).toISOString(), lastSeenAt: new Date(2000).toISOString() });
    expect(await conversation()).toMatchObject({ contactName: 'Ann', contactEmail: 'ann@example.com', tags: [] });
  });

  it('changes only what is named, and null clears', async () => {
    expect(await json(await call('PATCH', C, agent, { name: 'Anna' }))).toMatchObject({ name: 'Anna', email: 'ann@example.com', phone: '123' });
    expect(await json(await call('PATCH', C, agent, { email: null, phone: '456' }))).toMatchObject({ name: 'Anna', email: null, phone: '456' });
    expect((await conversation()).contactName).toBe('Anna');
  });

  it('refuses nothing to change, a bad email, and control characters', async () => {
    expect((await call('PATCH', C, agent, {})).status).toBe(400);
    expect((await call('PATCH', C, agent, { email: 'not an email' })).status).toBe(400);
    expect((await call('PATCH', C, agent, { name: 'a\u0000b' })).status).toBe(400);
    expect((await call('PATCH', C, agent, { phone: 'a\nb' })).status).toBe(400);
  });

  it('answers 404 for an unknown contact', async () => {
    expect((await call('GET', `${W}/contacts/cont_none`, agent)).status).toBe(404);
    expect((await call('PATCH', `${W}/contacts/cont_none`, agent, { name: 'x' })).status).toBe(404);
  });
});

describe('the contact list', () => {
  type Listed = { id: string; name: string | null; conversationCount: number; lastConversationId: string; lastActivityAt: string };
  const list = async (query = '', token = agent) => json<{ data: Listed[]; nextCursor: string | null }>(await call('GET', `${W}/contacts${query}`, token));
  const add = (id: string, name: string | null, email: string | null, conversations: [string, number][], workspace = 'work_1') => [
    env.DB.prepare(`INSERT INTO contacts (id, workspace_id, name, email, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, 1, 1, 1)`).bind(id, workspace, name, email),
    ...conversations.map(([conv, at]) => env.DB.prepare(`INSERT INTO conversations (id, workspace_id, website_id, contact_id, last_message_at, created_at, updated_at) VALUES (?1, ?2, 'site_1', ?3, ?4, 1, ?4)`).bind(conv, workspace, id, at)),
  ];

  it('lists who has a conversation, the most recently active first, with their latest conversation', async () => {
    await env.DB.batch([...add('cont_2', 'Bob', 'bob@example.com', [['conv_2a', 5000], ['conv_2b', 9000], ['conv_2c', 7000]]), ...add('cont_3', null, null, [['conv_3', 8000]]), ...add('cont_ghost', 'Ghost', null, [])]);
    const { data, nextCursor } = await list();
    expect(nextCursor).toBeNull();
    expect(data.map((c) => [c.id, c.conversationCount, c.lastConversationId])).toEqual([['cont_2', 3, 'conv_2b'], ['cont_3', 1, 'conv_3'], ['cont_1', 1, 'conv_1']]);
    expect(data[0]!.lastActivityAt).toBe(new Date(9000).toISOString());
  });

  it('pages without repeating or missing anyone', async () => {
    await env.DB.batch(Array.from({ length: 5 }, (_, n) => add(`cont_p${n}`, `P${n}`, null, [[`conv_p${n}`, 5000], [`conv_q${n}`, 4000]])).flat());
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: Listed[]; nextCursor: string | null } = await list(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.data.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['cont_p4', 'cont_p3', 'cont_p2', 'cont_p1', 'cont_p0', 'cont_1']);
  });

  it('searches names and addresses, whatever the capitals, and treats % as a character', async () => {
    await env.DB.batch([...add('cont_2', 'Bob Stone', 'bob@example.com', [['conv_2', 5000]]), ...add('cont_3', '100% Carl', 'carl@shop.example', [['conv_3', 6000]])]);
    expect((await list('?q=BOB')).data.map((c) => c.id)).toEqual(['cont_2']);
    expect((await list('?q=shop.example')).data.map((c) => c.id)).toEqual(['cont_3']);
    expect((await list('?q=%25')).data.map((c) => c.id)).toEqual(['cont_3']);
    expect((await list('?q=nobody')).data).toEqual([]);
    // A cursor belongs to its search.
    const { nextCursor } = await list('?limit=1');
    expect((await call('GET', `${W}/contacts?q=bob&cursor=${nextCursor}`, agent)).status).toBe(400);
  });

  it('keeps to its workspace', async () => {
    await env.DB.batch([env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, created_at, updated_at) VALUES ('site_2', 'work_2', 'Other', 'key_2', 1, 1)`), env.DB.prepare(`INSERT INTO contacts (id, workspace_id, name, first_seen_at, last_seen_at, created_at, updated_at) VALUES ('cont_far', 'work_2', 'Far', 1, 1, 1, 1)`), env.DB.prepare(`INSERT INTO conversations (id, workspace_id, website_id, contact_id, last_message_at, created_at, updated_at) VALUES ('conv_far', 'work_2', 'site_2', 'cont_far', 9, 1, 9)`)]);
    expect((await list()).data.map((c) => c.id)).toEqual(['cont_1']);
    expect((await call('GET', '/api/v1/workspaces/work_2/contacts', agent)).status).toBe(404);
  });
});

describe('analytics', () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  type Analytics = { truncated: boolean; started: number; replied: number; resolved: number; medianFirstReplySeconds: number | null; assistantAnswered: number; assistantOnly: number; days: { date: string; started: number }[]; members: { memberId: string; replies: number; conversations: number }[] };
  const get = async (query = '', token = owner) => json<Analytics>(await call('GET', `${W}/analytics${query}`, token));
  let seq = 0;
  const conversation = (id: string, at: number, status = 'open') =>
    env.DB.prepare(`INSERT INTO conversations (id, workspace_id, website_id, contact_id, status, last_message_at, created_at, updated_at) VALUES (?1, 'work_1', 'site_1', 'cont_1', ?2, ?3, ?3, ?3)`).bind(id, status, at);
  const message = (conv: string, at: number, sender: 'visitor' | 'member' | 'assistant' | 'note', member = 'mem_a') => {
    seq += 1;
    const note = sender === 'note';
    return env.DB.prepare(
      `INSERT INTO messages (id, workspace_id, conversation_id, seq, public_seq, sender_type, sender_id, message_type, visibility, content, assistant_id, created_at)
       VALUES (?1, 'work_1', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'x', ?9, ?10)`,
    ).bind(`msg_an${seq}`, conv, seq, note ? null : seq, sender === 'visitor' ? 'visitor' : sender === 'assistant' ? 'system' : 'member', sender === 'member' || note ? member : null, note ? 'internal_note' : 'text', note ? 'internal' : 'public', sender === 'assistant' ? 'asst_1' : null, at);
  };

  it('counts the conversations started in the period, and what became of them', async () => {
    const now = Date.now();
    await env.DB.prepare(`DELETE FROM messages`).run();
    await env.DB.batch([
      // Answered by a person after 60 s and again later, and resolved.
      conversation('conv_a1', now - 2 * HOUR, 'resolved'), message('conv_a1', now - 2 * HOUR, 'visitor'), message('conv_a1', now - 2 * HOUR + 60_000, 'member'), message('conv_a1', now - HOUR, 'member'),
      // A note is not an answer. Then the owner answers after 180 s.
      conversation('conv_a2', now - 3 * HOUR), message('conv_a2', now - 3 * HOUR + 1000, 'note'), message('conv_a2', now - 3 * HOUR + 180_000, 'member', 'mem_o'),
      // Only the assistant answered.
      conversation('conv_a3', now - 4 * HOUR, 'archived'), message('conv_a3', now - 4 * HOUR + 2000, 'assistant'),
      // The assistant, then a person after 300 s.
      conversation('conv_a4', now - 5 * HOUR), message('conv_a4', now - 5 * HOUR + 2000, 'assistant'), message('conv_a4', now - 5 * HOUR + 300_000, 'member'),
      // Before the period.
      conversation('conv_old', now - 40 * DAY, 'resolved'), message('conv_old', now - 40 * DAY + 5000, 'member'),
    ]);
    // 30 days, so that the hours above cannot fall before the first day. conv_1, from the setup, is from 1970.
    const result = await get('?days=30');
    expect(result).toMatchObject({ truncated: false, started: 4, replied: 3, resolved: 2, medianFirstReplySeconds: 180, assistantAnswered: 2, assistantOnly: 1 });
    expect(result.members).toEqual([{ memberId: 'mem_a', replies: 3, conversations: 2 }, { memberId: 'mem_o', replies: 1, conversations: 1 }]);
    expect(result.days).toHaveLength(30);
    expect(result.days.reduce((sum, day) => sum + day.started, 0)).toBe(4);
    expect((await get('?days=90')).started).toBe(5);
  });

  it("puts a conversation on the viewer's day, not UTC's", async () => {
    // 23:30 UTC yesterday is today for someone two hours ahead.
    const midnight = Math.floor(Date.now() / DAY) * DAY;
    await conversation('conv_late', midnight - HOUR / 2).run();
    const utc = await get('?days=2');
    expect(utc.days.map((day) => day.started)).toEqual([1, 0]);
    expect(utc.days[1]!.date).toBe(new Date(midnight).toISOString().slice(0, 10));
    const ahead = await get('?days=1&utcOffsetMinutes=120');
    // Unless it is before 02:00 UTC, when their today began after it.
    if (Date.now() - midnight >= 2 * HOUR) expect(ahead.days.map((day) => day.started)).toEqual([1]);
    expect((await get('?days=1')).started).toBe(0);
  });

  it('answers with nothing for an empty period, and is for supervisors', async () => {
    expect(await get('?days=7')).toMatchObject({ started: 0, replied: 0, medianFirstReplySeconds: null, members: [] });
    expect((await call('GET', `${W}/analytics`, agent)).status).toBe(403);
    expect((await call('GET', `${W}/analytics?days=91`, owner)).status).toBe(400);
    expect((await call('GET', `${W}/analytics?utcOffsetMinutes=900`, owner)).status).toBe(400);
  });
});

describe('tags', () => {
  it('creates once, whatever the capitals, and lists by name', async () => {
    const first = await call('POST', `${W}/tags`, agent, { name: 'Refund' });
    expect(first.status).toBe(201);
    const { id } = await json<{ id: string }>(first);
    const again = await call('POST', `${W}/tags`, agent, { name: 'REFUND' });
    expect(again.status).toBe(200);
    expect(await json(again)).toEqual({ id, name: 'Refund' });
    await createTag('Billing');
    expect((await json<{ data: { name: string }[] }>(await call('GET', `${W}/tags`, agent))).data.map((t) => t.name)).toEqual(['Billing', 'Refund']);
  });

  it('stops at the limit, while the existing name still works', async () => {
    await env.DB.batch(Array.from({ length: 500 }, (_, n) => env.DB.prepare(`INSERT INTO tags (id, workspace_id, name, created_at) VALUES (?1, 'work_1', ?2, 1)`).bind(`tag_${n}`, `t${n}`)));
    const refused = await call('POST', `${W}/tags`, agent, { name: 'one too many' });
    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({ code: 'tag_limit' });
    expect((await call('POST', `${W}/tags`, agent, { name: 't1' })).status).toBe(200);
  });

  it('only managers delete, which takes it off conversations', async () => {
    const tag = await createTag('Refund');
    await call('PUT', `${CONV}/tags`, agent, { tagIds: [tag.id] });
    expect((await call('DELETE', `${W}/tags/${tag.id}`, agent)).status).toBe(403);
    expect((await conversation()).tags).toHaveLength(1);
    expect((await call('DELETE', `${W}/tags/${tag.id}`, owner)).status).toBe(204);
    expect((await conversation()).tags).toEqual([]);
    expect((await call('DELETE', `${W}/tags/${tag.id}`, owner)).status).toBe(404);
  });
});

describe('tags on a conversation', () => {
  it('replaces the set, repeats nothing, and does not move the version', async () => {
    const [a, b] = [await createTag('A'), await createTag('B')];
    const { version } = await conversation();
    expect((await call('PUT', `${CONV}/tags`, agent, { tagIds: [a.id, a.id] })).status).toBe(204);
    expect((await conversation()).tags).toEqual([a]);
    expect((await call('PUT', `${CONV}/tags`, agent, { tagIds: [b.id] })).status).toBe(204);
    const after = await conversation();
    expect(after.tags).toEqual([b]);
    expect(after.version).toBe(version);
    expect((await call('PUT', `${CONV}/tags`, agent, { tagIds: [] })).status).toBe(204);
    expect((await conversation()).tags).toEqual([]);
  });

  it('moves the update time, so that catching up finds it', async () => {
    const before = await conversation();
    await call('PUT', `${CONV}/tags`, agent, { tagIds: [] });
    expect((await conversation()).updatedAt > before.updatedAt).toBe(true);
  });

  it("refuses a tag from another workspace, and leaves everything as it was", async () => {
    const mine = await createTag('Mine');
    await call('PUT', `${CONV}/tags`, agent, { tagIds: [mine.id] });
    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM outbox`).first<{ n: number }>();
    const refused = await call('PUT', `${CONV}/tags`, agent, { tagIds: ['tag_foreign', mine.id] });
    expect(refused.status).toBe(400);
    expect(await json(refused)).toMatchObject({ code: 'unknown_tag' });
    expect((await conversation()).tags).toEqual([mine]);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM outbox`).first<{ n: number }>()).toEqual(before);
    expect(await env.DB.prepare(`SELECT tag_id FROM conversation_tags WHERE tag_id = 'tag_foreign'`).first()).toBeNull();
  });

  it('answers 404 for an unknown conversation, even with no tags', async () => {
    expect((await call('PUT', `${W}/conversations/conv_none/tags`, agent, { tagIds: [] })).status).toBe(404);
  });

  it('records who changed them, and announces it', async () => {
    const tag = await createTag('Refund');
    await call('PUT', `${CONV}/tags`, agent, { tagIds: [tag.id] });
    const event = await env.DB.prepare(`SELECT actor_id AS actor, metadata_json AS meta FROM conversation_events WHERE event_type = 'tags_changed'`).first<{ actor: string; meta: string }>();
    expect(event?.actor).toBe('mem_a');
    expect(JSON.parse(event!.meta)).toEqual({ tagIds: [tag.id] });
    // Dispatched by then, because this test waits for work after the response.
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE topic = 'conversation.updated' AND dispatched_at IS NOT NULL`).first()).toEqual({ n: 1 });
  });
});
