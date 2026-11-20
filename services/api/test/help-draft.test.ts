/**
 * Draft with AI (ADR-0023, step 2): who may start it, what it reads, that what it writes are drafts with only the
 * links its material has, that files are removed when it ends, and that repeats of its jobs write nothing twice.
 * The real Worker and D1, with fakes of Workers AI and the company's website.
 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { hashPassword } from '@openchat/auth';
import { cleanDraftedArticle, parseOutline } from '@openchat/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleQueue } from '../src/background';
import { sweepOutbox } from '../src/dispatch';
import type { Env } from '../src/env';
import worker from '../src/index';

const ORIGIN = 'https://chat.example.com';
const SITE = 'https://shop.example';
const PASSWORD = 'correct horse battery';
const W = 'work_a';

// ---------- Fakes ----------

type Turn = { role: string; content: string };
let prompts: Turn[][] = [];
/** The outline the fake model plans. Sources are 1-based, as the model is told. */
let outline: { title: string; summary: string; collection: string; sources: number[] }[] = [];
/** What it writes for an article, by title. */
let article: (title: string, user: string) => string = () => '';
let converted: string[] = [];

const ai = {
  async run(_model: string, input: { messages: Turn[] }) {
    prompts.push(input.messages);
    const system = input.messages[0]!.content;
    if (system.startsWith('You plan a help centre')) return { response: `Here is the plan:\n${JSON.stringify(outline)}` };
    const title = /^Article title: (.*)$/m.exec(input.messages[1]!.content)![1]!;
    return { response: article(title, input.messages[1]!.content) };
  },
  async toMarkdown(file: { name: string; blob: Blob }) {
    converted.push(file.name);
    return { id: '1', name: file.name, mimeType: file.blob.type, format: 'markdown', tokens: 1, data: '# Returns guide\n\nYou can return anything within 30 days. Write to returns@shop.example.' };
  },
};

type Job = { type: string; workspaceId: string; idempotencyKey: string; payload: Record<string, unknown> };
let jobs: Job[] = [];
const queue = { send: async (job: Job) => void jobs.push(job), sendBatch: async (list: { body: Job }[]) => void jobs.push(...list.map((j) => j.body)) } as unknown as Queue;
const withAi = { ...env, JOBS_QUEUE: queue, NOTIFICATIONS_QUEUE: queue, EMAIL_QUEUE: queue, AI: ai, LIMIT_HELP_DRAFT_RUNS_PER_WORKSPACE_PER_DAY: '3' } as unknown as Env;
const without = { ...env, JOBS_QUEUE: queue, NOTIFICATIONS_QUEUE: queue, EMAIL_QUEUE: queue } as unknown as Env;

let site: Record<string, [number, string, string]> = {};

let counter = 0;
async function call(method: string, path: string, options: { token?: string; body?: unknown; raw?: Uint8Array; env?: Env } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        'cf-connecting-ip': `203.0.113.${++counter % 250}`,
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.raw ? { 'content-length': String(options.raw.length), 'content-type': 'application/octet-stream' } : {}),
      },
      ...(options.raw ? { body: options.raw } : options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    options.env ?? withAi,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

/** Runs queued jobs, as the jobs queue would, until none are left. */
async function runJobs(target: Env = withAi, list?: Job[]) {
  await sweepOutbox(target, Date.now() + 120_000);
  while (jobs.length > 0 || list) {
    const batch = list ?? jobs.splice(0);
    list = undefined;
    await handleQueue({ queue: 'oc-local-jobs', messages: batch.map((body) => ({ id: crypto.randomUUID(), body, attempts: 1, ack: () => undefined, retry: () => undefined })) } as unknown as MessageBatch, target);
    await sweepOutbox(target, Date.now() + 120_000);
  }
}

// ---------- Setup ----------

let hash = '';
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

const tokens: Record<string, string> = {};
beforeEach(async () => {
  prompts = [];
  jobs = [];
  converted = [];
  outline = [
    { title: 'How do I return an item?', summary: 'Returns are free for 30 days.', collection: 'Orders', sources: [1, 2] },
    { title: 'How long does shipping take?', summary: 'Delivery times.', collection: 'Orders', sources: [3] },
    { title: 'Do you sell gift cards?', summary: 'Gift cards.', collection: 'Payments', sources: [3] },
  ];
  article = (title) =>
    title.startsWith('Do you sell')
      ? 'NO_ANSWER'
      : `# ${title}\n\nYou can do this in **Orders**. See [our rates](${SITE}/help/shipping) or [this page](https://evil.example/phish), or https://evil.example/x.\n\n![tracker](https://evil.example/pixel.png)\n\n- Write to [us](mailto:returns@shop.example)\n- Or [them](mailto:someone@evil.example)`;
  site = {
    '/robots.txt': [404, 'text/plain', ''],
    '/': [200, 'text/html', `<html><head><title>Shop</title></head><body><p>Welcome to the shop. Free delivery over £50.</p><a href="/help/shipping">Shipping</a></body></html>`],
    '/help/shipping': [200, 'text/html', `<html><head><title>Shipping</title></head><body><p>Shipping takes 3 to 5 working days. See ${SITE}/help/shipping for rates.</p></body></html>`],
  };
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.origin === SITE) {
      const page = site[url.pathname];
      if (!page) return new Response('Not found', { status: 404 });
      const response = new Response(page[2], { status: page[0], headers: { 'content-type': page[1] } });
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    }
    if (url.hostname === 'evil.example') throw new Error('Must not be fetched');
    return real(input, init);
  });

  const tables = ['help_articles', 'help_collections', 'help_draft_runs', 'help_assets', 'outbox', 'audit_log', 'websites', 'workspace_members', 'auth_tokens', 'auth_sessions', 'workspaces', 'users', 'installation'];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installation (id, name, public_base_url, created_at, updated_at) VALUES ('inst_test', 'Test', ?1, 1, 1)`).bind(ORIGIN),
    env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?1, 'Acme', 'acme', 1, 1), ('work_b', 'Other', 'other', 1, 1)`).bind(W),
    ...[['boss', 'supervisor', W], ['agent', 'agent', W], ['stranger', 'supervisor', 'work_b']].flatMap(([name, role, workspace]) => [
      env.DB.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, 1)`).bind(`user_${name}`, `${name}@example.com`, name, hash),
      env.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'active', 1, 1)`).bind(`mem_${name}`, workspace, `user_${name}`, role),
    ]),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, allowed_origins_json, created_at, updated_at) VALUES ('site_a', ?1, 'Shop', 'key_a', json_array(?2), 1, 1)`).bind(W, SITE),
    env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, allowed_origins_json, created_at, updated_at) VALUES ('site_c', ?1, 'Blog', 'key_c', json_array('https://blog.example'), 1, 1)`).bind(W),
  ]);
  for (const name of ['boss', 'agent', 'stranger']) {
    const login = await call('POST', '/api/v1/auth/login', { body: { email: `${name}@example.com`, password: PASSWORD, clientType: 'dashboard' } });
    tokens[name] = ((await login.json()) as { accessToken: string }).accessToken;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- Helpers ----------

type Run = { id: string; status: string; errorCode: string | null; planned: number; written: number; failed: number; files: { name: string }[] };
type Summary = { id: string; title: string; status: string; aiDrafted: boolean; language: string; collectionId: string | null; version: number };
type Article = Summary & { bodyMarkdown: string; bodyHtml: string; aiSources: { title: string; url: string | null }[] };
const api = (path: string) => `/api/v1/workspaces/${W}${path}`;
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

async function begin(input: Record<string, unknown>, token = tokens.boss!, target?: Env) {
  return call('POST', api('/websites/site_a/help/drafts'), { token, body: { language: 'en', ...input }, ...(target ? { env: target } : {}) });
}
async function upload(runId: string, name: string, bytes: Uint8Array) {
  return call('POST', api(`/help/drafts/${runId}/files?filename=${encodeURIComponent(name)}`), { token: tokens.boss!, raw: bytes });
}
const centre = async (target?: Env) => (await (await call('GET', api('/websites/site_a/help'), { token: tokens.boss!, ...(target ? { env: target } : {}) })).json()) as { articles: Summary[]; drafting: { available: boolean; runs: Run[] }; collections: { id: string; name: string; language: string }[] };
const stored = async (runId: string) => (await env.ATTACHMENTS.list({ prefix: `help-draft/${runId}/` })).objects.length;

// ---------- Tests ----------

describe('starting a draft', () => {
  it('is offered only with Workers AI, and only to supervisors', async () => {
    expect((await centre(without)).drafting.available).toBe(false);
    expect((await (await begin({ readWebsite: true }, tokens.boss!, without)).json()) as { code: string }).toMatchObject({ code: 'drafting_unavailable' });
    expect((await centre()).drafting.available).toBe(true);
    expect((await begin({ readWebsite: true }, tokens.agent!)).status).toBe(403);
    expect((await begin({ readWebsite: true }, tokens.stranger!)).status).toBe(404);
  });

  it("reads only links on the website's own origins", async () => {
    const response = await begin({ links: ['https://evil.example/copy-this'] });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('source_url_not_allowed');
    expect((await begin({ links: ['http://shop.example/help/shipping'] })).status).toBe(400);
  });

  it('runs one draft at a time per website, and a few a day per workspace', async () => {
    const first = (await (await begin({ readWebsite: true })).json()) as Run;
    expect(((await (await begin({ readWebsite: true })).json()) as { code: string }).code).toBe('draft_running');
    // Two more may start today, on other websites or once this one ends. Then the workspace has used its three.
    await env.DB.prepare(`UPDATE help_draft_runs SET status = 'done' WHERE id = ?1`).bind(first.id).run();
    expect((await begin({ readWebsite: true })).status).toBe(201);
    await env.DB.prepare(`UPDATE help_draft_runs SET status = 'done'`).run();
    expect((await call('POST', api('/websites/site_c/help/drafts'), { token: tokens.boss!, body: { language: 'en', readWebsite: true } })).status).toBe(201);
    await env.DB.prepare(`UPDATE help_draft_runs SET status = 'done'`).run();
    const limited = await begin({ readWebsite: true });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe('draft_limit_reached');
  });

  it('takes files that are what their names say, until it starts', async () => {
    const run = (await (await begin({})).json()) as Run;
    expect((await call('POST', api(`/help/drafts/${run.id}/start`), { token: tokens.boss! })).status).toBe(400);
    expect((await upload(run.id, 'guide.pdf', new TextEncoder().encode('not a pdf at all'))).status).toBe(415);
    expect((await upload(run.id, 'tool.exe', PDF)).status).toBe(415);
    expect((await upload(run.id, 'sheet.xlsx', new Uint8Array([0x50, 0x4b, 3, 4]))).status).toBe(415);
    expect((await upload(run.id, 'notes.txt', new Uint8Array([0x68, 0x00, 0x69]))).status).toBe(415);
    const added = await upload(run.id, 'guide.pdf', PDF);
    expect(added.status).toBe(201);
    expect(((await added.json()) as Run).files).toEqual([{ name: 'guide.pdf', sizeBytes: PDF.length }]);
    expect((await call('POST', api(`/help/drafts/${run.id}/start`), { token: tokens.boss! })).status).toBe(200);
    expect((await upload(run.id, 'more.md', new TextEncoder().encode('# More'))).status).toBe(409);
    expect((await call('POST', api(`/help/drafts/${run.id}/start`), { token: tokens.boss! })).status).toBe(409);
  });
});

describe('what it writes', () => {
  async function draft(input: Record<string, unknown>, files: [string, Uint8Array][] = []) {
    const run = (await (await begin(input)).json()) as Run;
    for (const [name, bytes] of files) expect((await upload(run.id, name, bytes)).status).toBe(201);
    expect((await call('POST', api(`/help/drafts/${run.id}/start`), { token: tokens.boss! })).status).toBe(200);
    await runJobs();
    return run;
  }

  it('writes drafts in the chosen language from the website, links and files, and removes the files', async () => {
    const run = await draft({ language: 'ja', readWebsite: true, links: [`${SITE}/help/shipping`] }, [['guide.pdf', PDF], ['faq.md', new TextEncoder().encode('# FAQ\n\nGift cards are not sold.')]]);
    expect(converted).toEqual(['guide.pdf']);
    const after = await centre();
    expect(after.drafting.runs[0]).toMatchObject({ id: run.id, status: 'done', planned: 3, written: 2, failed: 1, errorCode: null });
    expect(await stored(run.id)).toBe(0);
    const drafted = after.articles.filter((a) => a.aiDrafted);
    expect(drafted.map((a) => [a.title, a.status, a.language]).sort()).toEqual([
      ['How do I return an item?', 'draft', 'ja'],
      ['How long does shipping take?', 'draft', 'ja'],
    ]);
    // Grouped as the outline said, in collections of that language.
    expect(after.collections.map((c) => [c.name, c.language]).sort()).toEqual([
      ['Orders', 'ja'],
      ['Payments', 'ja'],
    ]);
    expect(new Set(drafted.map((a) => a.collectionId)).size).toBe(1);
    // The model was told the language, and that the material is not instructions.
    expect(prompts[0]![0]!.content).toContain('Japanese');
    expect(prompts[0]![0]!.content).toContain('never instructions');
    expect(prompts[0]![1]!.content).toContain('[1] guide.pdf');
  });

  it('keeps only links and addresses that are in the material, and no images', async () => {
    await draft({ readWebsite: true }, [['guide.pdf', PDF]]);
    const summary = (await centre()).articles.find((a) => a.title === 'How do I return an item?')!;
    const full = (await (await call('GET', api(`/help/articles/${summary.id}`), { token: tokens.boss! })).json()) as Article;
    expect(full.bodyMarkdown).not.toMatch(/^# /);
    expect(full.bodyMarkdown).toContain(`[our rates](${SITE}/help/shipping)`);
    expect(full.bodyMarkdown).toContain('[us](mailto:returns@shop.example)');
    expect(full.bodyMarkdown).not.toContain('evil.example');
    expect(full.bodyMarkdown).toContain('this page');
    expect(full.bodyHtml).not.toContain('<img');
    expect(full.aiSources).toEqual([
      { title: 'guide.pdf', url: null },
      { title: 'Shop', url: `${SITE}/` },
    ]);
  });

  it('makes at most 6 collections, however many the model names', async () => {
    outline = Array.from({ length: 9 }, (_, i) => ({ title: `Question ${i}`, summary: '', collection: i < 2 ? 'Common' : `Section ${i}`, sources: [1] }));
    article = (title) => `${title}: the answer, written from the material, long enough to keep as an article.`;
    await draft({ readWebsite: true });
    const after = await centre();
    expect(after.collections).toHaveLength(6);
    expect(after.collections.some((c) => c.name === 'Common')).toBe(true);
    // 8 sections named; the 2 least used go.
    expect(after.articles.filter((a) => a.collectionId === null)).toHaveLength(2);
  });

  it('puts everything in the chosen collection', async () => {
    const collection = (await (await call('POST', api('/websites/site_a/help/collections'), { token: tokens.boss!, body: { language: 'en', name: 'Help' } })).json()) as { id: string };
    await draft({ readWebsite: true, collectionId: collection.id });
    const after = await centre();
    expect(after.collections).toHaveLength(1);
    expect(after.articles.every((a) => a.collectionId === collection.id)).toBe(true);
  });

  it('stops "Drafted by AI" when a person changes the words', async () => {
    await draft({ readWebsite: true });
    const summary = (await centre()).articles[0]!;
    const moved = await call('PATCH', api(`/help/articles/${summary.id}`), { token: tokens.boss!, body: { expectedVersion: summary.version, position: 5 } });
    expect(((await moved.json()) as Article).aiDrafted).toBe(true);
    const edited = await call('PATCH', api(`/help/articles/${summary.id}`), { token: tokens.boss!, body: { expectedVersion: summary.version + 1, summary: 'Checked by a person.' } });
    expect(((await edited.json()) as Article).aiDrafted).toBe(false);
  });

  it('splits a long document into parts, so the outline sees all of it, and names it once as a source', async () => {
    const long = Array.from({ length: 12 }, (_, i) => `## Section ${i + 1}\n\n${`Section ${i + 1} explains one thing about returns in detail. `.repeat(20)}`).join('\n\n');
    outline = [{ title: 'What does section 12 say?', summary: 'The last part.', collection: '', sources: [1, 2, 3] }];
    article = () => 'Section twelve explains one thing about returns in detail, and here it is.';
    await draft({}, [['long.md', new TextEncoder().encode(long)]]);
    const user = prompts[0]![1]!.content;
    // Every part is numbered, and the outline sees how each one starts, the last included.
    const parts = Number(/long\.md \(1\/(\d+)\)/.exec(user)![1]);
    expect(parts).toBeGreaterThan(2);
    expect(user).toContain(`[${parts}] long.md (${parts}/${parts})`);
    const summary = (await centre()).articles[0]!;
    const full = (await (await call('GET', api(`/help/articles/${summary.id}`), { token: tokens.boss! })).json()) as Article;
    expect(full.aiSources).toEqual([{ title: 'long.md', url: null }]);
  });

  it('fails a run with nothing to read, and removes its files', async () => {
    site['/'] = [500, 'text/html', 'down'];
    site['/robots.txt'] = [500, 'text/plain', ''];
    const run = await draft({ readWebsite: true });
    expect((await centre()).drafting.runs[0]).toMatchObject({ id: run.id, status: 'failed', errorCode: 'no_material' });
  });

  it('fails a run when the model gives no outline it can use', async () => {
    outline = [{ title: 'Made up', summary: '', collection: '', sources: [42] }];
    const run = await draft({ readWebsite: true });
    expect((await centre()).drafting.runs[0]).toMatchObject({ id: run.id, status: 'failed', errorCode: 'no_outline' });
    expect((await centre()).articles).toHaveLength(0);
  });

  it('writes nothing twice when its jobs are repeated', async () => {
    outline = outline.map((item, i) => ({ ...item, sources: [i === 0 ? 1 : 2] }));
    const run = (await (await begin({ readWebsite: true })).json()) as Run;
    await call('POST', api(`/help/drafts/${run.id}/start`), { token: tokens.boss! });
    await sweepOutbox(withAi, Date.now() + 120_000);
    const outlineJob = jobs.splice(0);
    await runJobs(withAi, outlineJob);
    await runJobs(withAi, outlineJob);
    const articleJobs = (await env.DB.prepare(`SELECT draft_index FROM help_articles WHERE draft_run_id = ?1`).bind(run.id).all()).results;
    expect(articleJobs).toHaveLength(2);
    // An article job delivered again after the run ended.
    await runJobs(withAi, [{ type: 'help.draft_article', workspaceId: W, idempotencyKey: 'again', payload: { runId: run.id, index: 0 } }]);
    expect((await centre()).articles).toHaveLength(2);
    expect((await centre()).drafting.runs[0]).toMatchObject({ status: 'done', written: 2, failed: 1 });
  });

  it('stops a run that stopped moving, and removes its files', async () => {
    const run = (await (await begin({})).json()) as Run;
    await upload(run.id, 'guide.pdf', PDF);
    expect(await stored(run.id)).toBe(1);
    await env.DB.prepare(`UPDATE help_draft_runs SET updated_at = 1 WHERE id = ?1`).bind(run.id).run();
    await sweepOutbox(withAi, Date.UTC(2026, 10, 20, 12, 0));
    expect(await stored(run.id)).toBe(0);
    expect((await centre()).drafting.runs[0]).toMatchObject({ status: 'failed', errorCode: 'timed_out' });
  });
});

describe('reading what the model says', () => {
  it('takes an outline wrapped in other text, and drops items with no real source or a repeated title', () => {
    const items = parseOutline(
      'Sure!\n[{"title":"A","summary":"s","collection":"C","sources":[1,2,9]},{"title":"a","sources":[1]},{"title":"B","sources":[]},{"title":"C","sources":[2]}]',
      2,
    );
    expect(items).toEqual([
      { title: 'A', summary: 's', collection: 'C', sources: [0, 1] },
      { title: 'C', summary: '', collection: '', sources: [1] },
    ]);
    expect(parseOutline('no json here', 2)).toEqual([]);
  });

  it('refuses an article the model says the material does not cover, or too short to be one', () => {
    expect(cleanDraftedArticle('NO_ANSWER', 'T', [])).toBeNull();
    expect(cleanDraftedArticle('Too short.', 'T', [])).toBeNull();
    expect(cleanDraftedArticle('```markdown\nThis is a full paragraph about returns, long enough to keep.\n```', 'T', [])).toBe('This is a full paragraph about returns, long enough to keep.');
  });
});
