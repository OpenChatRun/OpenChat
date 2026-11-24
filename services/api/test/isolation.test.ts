/**
 * The tenant isolation harness. It reads every route from the contract and from the running app, so a new
 * route fails here until someone decides how it is isolated. See ADR-0004.
 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ALL_ROUTES } from '@openchat/api-contracts/document';
import { hashPassword } from '@openchat/auth';
import type { JobEnvelope } from '@openchat/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Env } from '../src/env';
import worker from '../src/index';

type Scoped = {
  kind: 'workspace';
  /** Sent in every request, so that a request is refused for its tenant and not for a malformed body. */
  body?: Record<string, unknown>;
  /** What the workspace's own owner gets. This proves the case reaches the real resource. */
  ownerStatus: number;
};
type Unscoped = { kind: 'public' | 'self'; reason: string };
/** Needs a visitor's token. `ownerStatus` is what the owning visitor gets. */
type VisitorScoped = { kind: 'visitor'; body?: Record<string, unknown>; ownerStatus: number };
/** For installation admins only, across workspaces. Everyone else gets 404, as if the route were not there. ADR-0015. */
type InstallationAdmin = { kind: 'installation'; body?: Record<string, unknown> };
/** For the installation's operator, with OPERATOR_TOKEN. Everyone else, signed in or not, gets 404. */
type Operator = { kind: 'operator' };
type Case = Scoped | Unscoped | VisitorScoped | InstallationAdmin | Operator;

/** Stands for a file in the cases below: the harness sends these bytes as the body. */
const UPLOAD = { __file: true };
/** A text file, for Draft with AI, which takes documents rather than images. */
const UPLOAD_TEXT = { __file: 'text' };
const TEXT = new TextEncoder().encode('Opening hours are nine to five.');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Keyed by operationId. Adding a route without an entry here fails the first test below. */
const CASES: Record<string, Case> = {
  getHealth: { kind: 'public', reason: 'Status only' },
  getDiscovery: { kind: 'public', reason: 'Describes the installation. No workspace data' },
  getSecurityTxt: { kind: 'public', reason: "The operator's contact for security reports. No workspace data" },
  getDatabaseHealth: { kind: 'operator' },
  getQueueHealth: { kind: 'operator' },
  getRealtimeHealth: { kind: 'operator' },
  getNotificationHealth: { kind: 'operator' },
  getSetup: { kind: 'public', reason: 'Says only whether an installation exists yet' },
  completeSetup: { kind: 'public', reason: 'Works only while there is no installation, and only with the setup code' },
  login: { kind: 'public', reason: 'Acts only on the submitted credentials' },
  refreshSession: { kind: 'public', reason: 'Acts only on the session of the presented token' },
  requestPasswordReset: { kind: 'public', reason: 'Answers the same for every address' },
  confirmPasswordReset: { kind: 'public', reason: 'Acts only on the user of the presented token' },
  confirmEmailVerification: { kind: 'public', reason: 'Acts only on the user of the presented token' },
  logout: { kind: 'self', reason: 'Revokes the caller’s own session' },
  getMe: { kind: 'self', reason: 'Filtered to the caller’s own memberships. Covered in auth.test.ts' },
  updateMe: { kind: 'self', reason: 'Changes only the caller’s own language. Covered in languages.test.ts' },
  listPeople: { kind: 'installation' },
  createPerson: { kind: 'installation', body: { name: 'New', email: 'created@example.com' } },
  updatePerson: { kind: 'installation', body: { isInstallationAdmin: true } },
  deactivatePerson: { kind: 'installation' },
  reactivatePerson: { kind: 'installation' },
  assignPerson: { kind: 'installation', body: { role: 'agent' } },
  unassignPerson: { kind: 'installation' },
  listAdminWorkspaces: { kind: 'installation' },
  createWorkspace: { kind: 'installation', body: { name: 'Taken over' } },
  updateWorkspace: { kind: 'installation', body: { name: 'Taken over' } },
  listAdminWebsites: { kind: 'installation' },
  createWebsite: { kind: 'installation', body: { name: 'Taken over', allowedOrigins: [] } },
  updateWebsite: { kind: 'installation', body: { name: 'Taken over' } },
  getRelayStatus: { kind: 'installation' },
  disconnectRelay: { kind: 'installation' },
  reconnectRelay: { kind: 'installation' },
  listFailedJobs: { kind: 'installation' },
  replayFailedJob: { kind: 'installation' },
  dismissFailedJob: { kind: 'installation' },
  getRetention: { kind: 'installation' },
  setRetention: { kind: 'installation', body: { retentionDays: 30 } },
  listAuditLog: { kind: 'installation' },
  getWorkspace: { kind: 'workspace', ownerStatus: 200 },
  listMembers: { kind: 'workspace', ownerStatus: 200 },
  updateMyMembership: { kind: 'workspace', body: { away: true }, ownerStatus: 200 },
  getInboxSummary: { kind: 'workspace', ownerStatus: 200 },
  listWebsites: { kind: 'workspace', ownerStatus: 200 },
  widgetBootstrap: { kind: 'public', reason: 'Public configuration. Only ever the named website' },
  createVisitorSession: { kind: 'public', reason: 'Creates a new anonymous visitor, or resumes the one holding the token' },
  widgetHelp: { kind: 'public', reason: 'Published help articles of the named website only. Covered in widget-help.test.ts' },
  widgetHelpArticle: { kind: 'public', reason: 'A published article of the named website only. Covered in widget-help.test.ts' },
  updateVisitorProfile: { kind: 'visitor', body: { name: 'Taken over' }, ownerStatus: 204 },
  listVisitorConversations: { kind: 'visitor', ownerStatus: 200 },
  createVisitorConversation: { kind: 'visitor', body: { clientMessageId: 'isolation-2', content: 'New' }, ownerStatus: 201 },
  listVisitorMessages: { kind: 'visitor', ownerStatus: 200 },
  sendVisitorMessage: { kind: 'visitor', body: { clientMessageId: 'isolation-3', content: 'Taken over' }, ownerStatus: 201 },
  markVisitorConversationRead: { kind: 'visitor', body: { deliveredSeq: 0, readSeq: 0 }, ownerStatus: 204 },
  // 409, not 404: it is their own conversation, and it is not resolved.
  rateVisitorConversation: { kind: 'visitor', body: { rating: 'good' }, ownerStatus: 409 },
  setVisitorPage: { kind: 'visitor', body: { url: 'https://site-a.example/pricing' }, ownerStatus: 204 },
  getAnalytics: { kind: 'workspace', ownerStatus: 200 },
  listContacts: { kind: 'workspace', ownerStatus: 200 },
  getContact: { kind: 'workspace', ownerStatus: 200 },
  updateContact: { kind: 'workspace', body: { name: 'Taken over' }, ownerStatus: 200 },
  // The owner here is a supervisor, not an installation admin. contact-privacy.test.ts covers an admin.
  exportContact: { kind: 'workspace', ownerStatus: 403 },
  eraseContact: { kind: 'workspace', ownerStatus: 403 },
  listTags: { kind: 'workspace', ownerStatus: 200 },
  createTag: { kind: 'workspace', body: { name: 'taken-over' }, ownerStatus: 201 },
  deleteTag: { kind: 'workspace', ownerStatus: 204 },
  setConversationTags: { kind: 'workspace', body: { tagIds: [] }, ownerStatus: 204 },
  connectRealtime: { kind: 'public', reason: 'Takes a signed ticket, which names exactly what it may reach. Covered in realtime.test.ts' },
  createAgentTicket: { kind: 'workspace', ownerStatus: 201 },
  createPushGrant: { kind: 'workspace', ownerStatus: 409 },
  listMyPushSubscriptions: { kind: 'workspace', ownerStatus: 200 },
  recordPushSubscription: { kind: 'workspace', body: { relaySubscriptionId: 'sub_taken', previewKey: 'A'.repeat(43) }, ownerStatus: 409 },
  removePushSubscription: { kind: 'workspace', ownerStatus: 204 },
  getNotificationPreferences: { kind: 'workspace', ownerStatus: 200 },
  showUnsubscribe: { kind: 'public', reason: 'Acts only on the address of the presented token' },
  confirmUnsubscribe: { kind: 'public', reason: 'Acts only on the address of the presented token' },
  listEmailSuppressions: { kind: 'workspace', ownerStatus: 200 },
  listFollowUpRules: { kind: 'workspace', ownerStatus: 200 },
  createFollowUpRule: { kind: 'workspace', body: { name: 'Taken over', inactiveMinutes: 30 }, ownerStatus: 201 },
  updateFollowUpRule: { kind: 'workspace', body: { name: 'Taken over' }, ownerStatus: 200 },
  deleteFollowUpRule: { kind: 'workspace', ownerStatus: 204 },
  listSavedReplies: { kind: 'workspace', ownerStatus: 200 },
  createSavedReply: { kind: 'workspace', body: { title: 'Taken over', content: 'Hello' }, ownerStatus: 201 },
  updateSavedReply: { kind: 'workspace', body: { title: 'Taken over' }, ownerStatus: 200 },
  deleteSavedReply: { kind: 'workspace', ownerStatus: 204 },
  addEmailSuppression: { kind: 'workspace', body: { email: 'blocked@example.com' }, ownerStatus: 204 },
  removeEmailSuppression: { kind: 'workspace', body: { email: 'blocked@example.com' }, ownerStatus: 204 },
  setNotificationPreferences: { kind: 'workspace', body: { preferences: [] }, ownerStatus: 204 },
  createVisitorTicket: { kind: 'visitor', ownerStatus: 201 },
  listConversations: { kind: 'workspace', ownerStatus: 200 },
  getConversation: { kind: 'workspace', ownerStatus: 200 },
  updateConversation: { kind: 'workspace', body: { expectedVersion: 1, priority: 'urgent' }, ownerStatus: 200 },
  listMessages: { kind: 'workspace', ownerStatus: 200 },
  getTranslationSettings: { kind: 'workspace', ownerStatus: 200 },
  updateTranslationSettings: { kind: 'workspace', body: { enabled: true, model: '@cf/meta/m2m100-1.2b' }, ownerStatus: 409 },
  translateMessage: { kind: 'workspace', body: { language: 'en' }, ownerStatus: 409 },
  sendMessage: { kind: 'workspace', body: { clientMessageId: 'isolation-1', type: 'text', content: 'Taken over' }, ownerStatus: 201 },
  markConversationRead: { kind: 'workspace', body: { deliveredSeq: 0, readSeq: 0 }, ownerStatus: 204 },
  uploadAttachment: { kind: 'workspace', body: UPLOAD, ownerStatus: 201 },
  downloadAttachment: { kind: 'workspace', ownerStatus: 200 },
  uploadVisitorAttachment: { kind: 'visitor', body: UPLOAD, ownerStatus: 201 },
  downloadVisitorAttachment: { kind: 'visitor', ownerStatus: 200 },
  getAssistant: { kind: 'workspace', ownerStatus: 200 },
  saveAssistantSettings: { kind: 'workspace', body: { name: 'Taken over', model: null }, ownerStatus: 200 },
  addAssistantSource: { kind: 'workspace', body: { kind: 'text', title: 'Taken over', content: 'Taken over' }, ownerStatus: 201 },
  updateAssistantSource: { kind: 'workspace', body: { title: 'Taken over' }, ownerStatus: 200 },
  deleteAssistantSource: { kind: 'workspace', ownerStatus: 204 },
  testAssistant: { kind: 'workspace', body: { question: 'Taken over?' }, ownerStatus: 200 },
  listLearnedAnswers: { kind: 'workspace', ownerStatus: 200 },
  decideLearnedAnswer: { kind: 'workspace', body: { status: 'rejected' }, ownerStatus: 200 },
  deleteLearnedAnswer: { kind: 'workspace', ownerStatus: 204 },
  listUnansweredQuestions: { kind: 'workspace', ownerStatus: 200 },
  // The conversation already has a learned answer, so the owner is refused; anyone else never gets that far.
  answerUnansweredQuestion: { kind: 'workspace', body: { question: 'Q?', answer: 'A.' }, ownerStatus: 409 },
  dismissUnansweredQuestion: { kind: 'workspace', ownerStatus: 204 },
  setLearnedAutoApprove: { kind: 'workspace', body: { autoApprove: true }, ownerStatus: 200 },
  getHelpCentre: { kind: 'workspace', ownerStatus: 200 },
  saveHelpSettings: { kind: 'workspace', body: { slug: 'taken-over' }, ownerStatus: 200 },
  createHelpCollection: { kind: 'workspace', body: { language: 'en', name: 'Taken over' }, ownerStatus: 201 },
  updateHelpCollection: { kind: 'workspace', body: { name: 'Taken over' }, ownerStatus: 200 },
  deleteHelpCollection: { kind: 'workspace', ownerStatus: 204 },
  createHelpArticle: { kind: 'workspace', body: { language: 'en', title: 'Taken over' }, ownerStatus: 201 },
  getHelpArticle: { kind: 'workspace', ownerStatus: 200 },
  updateHelpArticle: { kind: 'workspace', body: { expectedVersion: 1, title: 'Taken over' }, ownerStatus: 200 },
  setHelpArticleStatus: { kind: 'workspace', body: { status: 'published' }, ownerStatus: 200 },
  deleteHelpArticle: { kind: 'workspace', ownerStatus: 204 },
  uploadHelpAsset: { kind: 'workspace', body: UPLOAD, ownerStatus: 201 },
  deleteHelpAsset: { kind: 'workspace', ownerStatus: 204 },
  createHelpDraftRun: { kind: 'workspace', body: { language: 'en' }, ownerStatus: 201 },
  uploadHelpDraftFile: { kind: 'workspace', body: UPLOAD_TEXT, ownerStatus: 201 },
  startHelpDraftRun: { kind: 'workspace', ownerStatus: 200 },
};

/** Served by the app, but not part of the versioned contract. */
/** The help centre's public pages are HTML for people, not API (ADR-0023). They read only published articles. */
const APP_ROUTES_OUTSIDE_THE_CONTRACT = [
  'GET /api/v1/openapi.json',
  'GET /help/{slug}',
  'GET /help/{slug}/sitemap.xml',
  'GET /help/{slug}/{lang}',
  'GET /help/{slug}/{lang}/search',
  'GET /help/{slug}/{lang}/{article}',
  'GET /help-assets/{id}',
];

/** The first test applies this to the real routes, and the second proves that it can fail. */
function uncovered(routes: readonly { operationId?: string | undefined }[], cases: Record<string, unknown>): string[] {
  return routes.map((r) => r.operationId ?? '(no operationId)').filter((id) => !(id in cases));
}

const contractRoutes = ALL_ROUTES.map((route) => ({
  id: route.operationId,
  method: route.method.toUpperCase(),
  path: route.path,
  isPublic: Array.isArray(route.security) && route.security.length === 0,
}));
const scopedRoutes = contractRoutes.filter((r) => CASES[r.id]?.kind === 'workspace');

// Hono writes parameters as :name and the contract as {name}.
const servedRoutes = () =>
  createApp()
    .routes.filter((r) => r.method !== 'ALL')
    .map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, '{$1}')}`);

describe('every route is accounted for', () => {
  it('has a case for each route in the contract', () => {
    expect(uncovered(ALL_ROUTES, CASES)).toEqual([]);
  });

  it('notices a route with no case', () => {
    expect(uncovered([...ALL_ROUTES, { operationId: 'brandNewRoute' }], CASES)).toEqual(['brandNewRoute']);
  });

  it('has no case for a route that no longer exists', () => {
    const ids = new Set(contractRoutes.map((r) => r.id));
    expect(Object.keys(CASES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('serves nothing that is missing from the contract, so nothing can avoid the cases', () => {
    const contract = new Set(contractRoutes.map((r) => `${r.method} ${r.path}`));
    const extra = servedRoutes().filter((route) => !contract.has(route) && !APP_ROUTES_OUTSIDE_THE_CONTRACT.includes(route));
    expect(extra).toEqual([]);
  });

  it('serves everything in the contract', () => {
    const served = new Set(servedRoutes());
    expect(contractRoutes.map((r) => `${r.method} ${r.path}`).filter((route) => !served.has(route))).toEqual([]);
  });

  it('agrees with the contract about which routes are public', () => {
    for (const route of contractRoutes) expect([route.id, route.isPublic]).toEqual([route.id, CASES[route.id]?.kind === 'public']);
  });

  it('treats every route with a workspace in its path as scoped', () => {
    for (const route of contractRoutes.filter((r) => CASES[r.id]?.kind !== 'installation')) expect([route.id, route.path.includes('{workspaceId}')]).toEqual([route.id, CASES[route.id]?.kind === 'workspace']);
  });
});

// ---------- Against the running app ----------

const ORIGIN = 'https://example.com';
const PASSWORD = 'correct horse battery';
/** Workers AI and Vectorize that know nothing, so that assistant routes reach their resources. */
const ai = { run: async (_model: string, input: { text?: string[] }) => (input.text ? { data: input.text.map(() => [1, 0]) } : { response: 'NO_ANSWER' }) };
const vectorize = { upsert: async () => ({}), query: async () => ({ matches: [], count: 0 }), deleteByIds: async () => ({}) };
const testEnv = { ...env, EMAIL_QUEUE: { send: async (_job: JobEnvelope) => undefined }, AI: ai, VECTORIZE: vectorize } as unknown as Env;

/** Resources in each workspace, by the name of the path parameter that holds them. */
const RESOURCES: Record<'a' | 'b', Record<string, string>> = {
  a: { userId: 'user_a_agent', workspaceId: 'work_a', memberId: 'mem_a_agent', websiteId: 'site_a', conversationId: 'conv_a', contactId: 'cont_a', tagId: 'tag_a', attachmentId: 'att_a', subscriptionId: 'psub_a', ruleId: 'rule_a', savedReplyId: 'srep_a', failedJobId: 'fjob_a', sourceId: 'asrc_a', learnedId: 'alrn_a', questionId: 'msgh_a', collectionId: 'hcol_a', articleId: 'hart_a', assetId: 'hast_a', runId: 'hdrf_a', messageId: 'msg_a' },
  b: { userId: 'user_b_agent', workspaceId: 'work_b', memberId: 'mem_b_agent', websiteId: 'site_b', conversationId: 'conv_b', contactId: 'cont_b', tagId: 'tag_b', attachmentId: 'att_b', subscriptionId: 'psub_b', ruleId: 'rule_b', savedReplyId: 'srep_b', failedJobId: 'fjob_b', sourceId: 'asrc_b', learnedId: 'alrn_b', questionId: 'msgh_b', collectionId: 'hcol_b', articleId: 'hart_b', assetId: 'hast_b', runId: 'hdrf_b', messageId: 'msg_b' },
};

function urlFor(path: string, ...sources: Record<string, string>[]): string {
  return path.replace(/\{(\w+)\}/g, (_, name: string) => {
    for (const source of sources) if (source[name]) return source[name];
    throw new Error(`The isolation harness has no fixture for {${name}}. Add one to RESOURCES.`);
  });
}

let requests = 0;
/** Waits for dispatch after the response, which writes to the outbox and would otherwise disturb a later snapshot. */
const request = async (method: string, path: string, token: string | null, body?: Record<string, unknown>) => {
  const ctx = createExecutionContext();
  const upload = body === UPLOAD || body === UPLOAD_TEXT;
  const text = body === UPLOAD_TEXT;
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}${upload ? (text ? '?filename=a.txt' : '?filename=a.png') : ''}`, {
      method,
      headers: {
        // Its own address each time, so that sign-in limits never decide a result here.
        'cf-connecting-ip': `192.0.2.${++requests}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(upload ? { 'content-type': text ? 'text/plain' : 'image/png', 'content-length': String((text ? TEXT : PNG).length) } : body ? { 'content-type': 'application/json' } : {}),
      },
      ...(upload ? { body: text ? TEXT : PNG } : body ? { body: JSON.stringify(body) } : {}),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
};

const TABLES = ['automation_rules', 'saved_replies', 'workspaces', 'workspace_members', 'websites', 'invitations', 'audit_log', 'outbox', 'conversation_read_cursors', 'conversation_events', 'messages', 'conversations', 'tags', 'conversation_tags', 'contacts', 'visitors', 'attachments', 'push_subscriptions', 'notification_preferences', 'failed_jobs', 'assistant_settings', 'assistant_sources', 'assistant_chunks', 'assistant_usage', 'assistant_learned', 'help_collections', 'help_articles', 'help_assets', 'help_draft_runs'];

/** Every row belonging to workspace A. A refused request must leave this exactly as it was. */
async function snapshotOfA(): Promise<string> {
  const rows = await Promise.all(
    TABLES.map((table) => env.DB.prepare(`SELECT * FROM ${table} WHERE ${table === 'workspaces' ? 'id' : 'workspace_id'} = 'work_a' ORDER BY 1`).all()),
  );
  return JSON.stringify(rows.map((r) => r.results));
}

let passwordHash = '';
const tokens = { ownerA: '', ownerB: '' };

async function seed() {
  await env.DB.batch([...TABLES.filter((t) => t !== 'workspaces').reverse(), 'auth_sessions', 'workspaces', 'users', 'installation'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installation (id, name, public_base_url, created_at, updated_at) VALUES ('inst_test', 'Test', '${ORIGIN}', 1, 1)`),
    ...(['a', 'b'] as const).flatMap((w) => [
      env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?1, ?2, ?2, 1, 1)`).bind(`work_${w}`, `workspace-${w}`),
      env.DB.prepare(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?1, ?2, 'Owner', ?3, 1, 1), (?4, ?5, 'Agent', '!', 1, 1)`)
        .bind(`user_${w}_owner`, `owner-${w}@example.com`, passwordHash, `user_${w}_agent`, `agent-${w}@example.com`),
      env.DB.prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) VALUES
         (?1, ?2, ?3, 'supervisor', 'active', 1, 1), (?4, ?2, ?5, 'agent', 'active', 1, 1)`,
      ).bind(`mem_${w}_owner`, `work_${w}`, `user_${w}_owner`, `mem_${w}_agent`, `user_${w}_agent`),
      env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, created_at, updated_at) VALUES (?1, ?2, 'Site', ?3, 1, 1)`).bind(`site_${w}`, `work_${w}`, `key_${w}`),
      // A second website, whose open Draft with AI run would otherwise stop the owner starting one on the first.
      env.DB.prepare(`INSERT INTO websites (id, workspace_id, name, website_key, created_at, updated_at) VALUES (?1, ?2, 'Docs', ?3, 1, 1)`).bind(`site_${w}_docs`, `work_${w}`, `key_${w}_docs`),
      env.DB.prepare(`INSERT INTO push_subscriptions (id, workspace_id, member_id, relay_id, relay_subscription_id, platform, created_at, updated_at) VALUES (?1, ?2, ?3, 'managed', ?4, 'ios', 1, 1)`).bind(`psub_${w}`, `work_${w}`, `mem_${w}_owner`, `sub_${w}`),
      env.DB.prepare(`INSERT INTO tags (id, workspace_id, name, created_at) VALUES (?1, ?2, 'existing', 1)`).bind(`tag_${w}`, `work_${w}`),
      env.DB.prepare(`INSERT INTO automation_rules (id, workspace_id, name, trigger_type, conditions_json, actions_json, created_at, updated_at) VALUES (?1, ?2, 'Rule', 'conversation_inactive', '{"inactiveMinutes":30}', '[]', 1, 1)`).bind(`rule_${w}`, `work_${w}`),
      env.DB.prepare(`INSERT INTO saved_replies (id, workspace_id, title, content, created_at, updated_at) VALUES (?1, ?2, 'Greeting', 'Hi there', 1, 1)`).bind(`srep_${w}`, `work_${w}`),
      env.DB.prepare(`INSERT INTO failed_jobs (id, workspace_id, queue, job_type, idempotency_key, attempts, envelope_json, failed_at) VALUES (?1, ?2, 'oc-local-jobs', 'automation.evaluate', ?1, 5, ?3, 1)`)
        .bind(`fjob_${w}`, `work_${w}`, JSON.stringify({ v: 1, type: 'automation.evaluate', id: `job_${w}`, idempotencyKey: `fjob_${w}`, workspaceId: `work_${w}`, occurredAt: '2026-01-01T00:00:00.000Z', payload: { conversationId: `conv_${w}` } })),
      env.DB.prepare(`INSERT INTO assistant_sources (id, workspace_id, website_id, kind, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, 'text', 'Hours', 'Open 9 to 5', 1, 1)`).bind(`asrc_${w}`, `work_${w}`, `site_${w}`),
      env.DB.prepare(`INSERT INTO contacts (id, workspace_id, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?1, ?2, 1, 1, 1, 1)`).bind(`cont_${w}`, `work_${w}`),
      env.DB.prepare(`INSERT INTO conversations (id, workspace_id, website_id, contact_id, last_message_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, 1, 1)`).bind(`conv_${w}`, `work_${w}`, `site_${w}`, `cont_${w}`),
      // Far ahead in sequence, so that messages sent by the cases take their own numbers.
      env.DB.prepare(`INSERT INTO messages (id, workspace_id, conversation_id, seq, public_seq, sender_type, message_type, visibility, content, created_at) VALUES (?1, ?2, ?3, 1000, 1000, 'visitor', 'text', 'public', 'Hallo', 1)`).bind(`msg_${w}`, `work_${w}`, `conv_${w}`),
      env.DB.prepare(`INSERT INTO messages (id, workspace_id, conversation_id, seq, public_seq, client_message_id, sender_type, message_type, visibility, content, assistant_id, metadata_json, created_at) VALUES (?1, ?2, ?3, 1001, 1001, ?4, 'system', 'text', 'public', 'Someone will reply', 'asst', '{"assistant":"handover","reason":"no_sources"}', 2)`).bind(`msgh_${w}`, `work_${w}`, `conv_${w}`, `assistant:msg_${w}`),
      env.DB.prepare(`INSERT INTO assistant_learned (id, workspace_id, website_id, conversation_id, question, answer, status, learned_seq, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'Q?', 'A.', 'pending', 0, 1, 1)`).bind(`alrn_${w}`, `work_${w}`, `site_${w}`, `conv_${w}`),
      env.DB.prepare(`INSERT INTO help_collections (id, workspace_id, website_id, language, name, slug, created_at, updated_at) VALUES (?1, ?2, ?3, 'en', 'Basics', 'basics', 1, 1)`).bind(`hcol_${w}`, `work_${w}`, `site_${w}`),
      env.DB.prepare(`INSERT INTO help_articles (id, workspace_id, website_id, collection_id, translation_group_id, language, slug, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?1, 'en', 'hours', 'Hours', 1, 1)`).bind(`hart_${w}`, `work_${w}`, `site_${w}`, `hcol_${w}`),
      env.DB.prepare(`INSERT INTO help_assets (id, workspace_id, website_id, content_type, size_bytes, filename, created_at) VALUES (?1, ?2, ?3, 'image/png', 11, 'a.png', 1)`).bind(`hast_${w}`, `work_${w}`, `site_${w}`),
      env.DB.prepare(`INSERT INTO help_draft_runs (id, workspace_id, website_id, language, links_json, created_at, updated_at) VALUES (?1, ?2, ?3, 'en', '["https://example.com/hours"]', ?4, ?4)`).bind(`hdrf_${w}`, `work_${w}`, `site_${w}_docs`, Date.now()),
      env.DB.prepare(`INSERT INTO attachments (id, workspace_id, conversation_id, storage_key, filename, content_type, size, status, uploaded_by_type, uploaded_by_id, created_at) VALUES (?1, ?2, ?3, ?4, 'a.png', 'image/png', 11, 'ready', 'member', ?5, 1)`).bind(`att_${w}`, `work_${w}`, `conv_${w}`, `w/work_${w}/c/conv_${w}/att_${w}`, `mem_${w}_agent`),
    ]),
  ]);
}

const seedFiles = () => Promise.all(['a', 'b'].map((w) => testEnv.ATTACHMENTS.put(`w/work_${w}/c/conv_${w}/att_${w}`, PNG)));

async function signIn(email: string) {
  const response = await request('POST', '/api/v1/auth/login', null, { email, password: PASSWORD, clientType: 'mobile' });
  expect(response.status).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

const bodyOf = (id: string) => (CASES[id] as Scoped | VisitorScoped).body;

describe('between visitors', () => {
  const visitorRoutes = contractRoutes.filter((r) => CASES[r.id]?.kind === 'visitor');
  const SITE = 'https://site-a.example';

  async function visitorToken(websiteId: string, origin: string) {
    const site = await env.DB.prepare(`SELECT website_key AS k FROM websites WHERE id = ?1`).bind(websiteId).first<{ k: string }>();
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/widget/sessions`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': `192.0.2.${++requests}` },
        body: JSON.stringify({ websiteKey: site!.k }),
      }),
      testEnv,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { accessToken: string }).accessToken;
  }

  let owner = '';
  let conversationId = '';
  let attachmentId = '';
  const paths = (path: string) => path.replace('{conversationId}', conversationId).replace('{attachmentId}', attachmentId);

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(async () => {
    await seed();
    await env.DB.prepare(`UPDATE websites SET allowed_origins_json = json_array('https://site-' || substr(id, 6) || '.example')`).run();
    owner = await visitorToken('site_a', SITE);
    const created = await request('POST', '/api/v1/widget/conversations', owner, { clientMessageId: 'isolation-0', content: 'Mine' });
    conversationId = ((await created.json()) as { id: string }).id;
    const stored = await request('POST', `/api/v1/widget/conversations/${conversationId}/attachments`, owner, UPLOAD);
    attachmentId = ((await stored.json()) as { id: string }).id;
    const claimed = await request('POST', `/api/v1/widget/conversations/${conversationId}/messages`, owner, { clientMessageId: 'isolation-file', content: '', attachmentIds: [attachmentId] });
    expect(claimed.status).toBe(201);
  });

  it.each(visitorRoutes)('$id works for the visitor who owns it', async ({ method, path, id }) => {
    const c = CASES[id] as VisitorScoped;
    expect((await request(method, paths(path), owner, c.body)).status).toBe(c.ownerStatus);
  });

  it.each(visitorRoutes)('$id refuses an agent token', async ({ method, path, id }) => {
    const agent = await signIn('owner-a@example.com');
    const before = await snapshotOfA();
    expect((await request(method, paths(path), agent, bodyOf(id))).status).toBe(401);
    expect(await snapshotOfA()).toBe(before);
  });

  const conversationRoutes = visitorRoutes.filter((r) => r.path.includes('{conversationId}') || r.path.includes('{attachmentId}'));

  it.each(conversationRoutes)('$id answers 404 to another visitor of the same website', async ({ method, path, id }) => {
    const other = await visitorToken('site_a', SITE);
    const before = await snapshotOfA();
    expect((await request(method, paths(path), other, bodyOf(id))).status).toBe(404);
    expect(await snapshotOfA()).toBe(before);
  });

  it.each(conversationRoutes)('$id answers 404 to a visitor of another workspace', async ({ method, path, id }) => {
    const other = await visitorToken('site_b', 'https://site-b.example');
    const before = await snapshotOfA();
    expect((await request(method, paths(path), other, bodyOf(id))).status).toBe(404);
    expect(await snapshotOfA()).toBe(before);
  });

  it('refuses a visitor token on every agent route', async () => {
    const before = await snapshotOfA();
    for (const { method, path, id } of contractRoutes.filter((r) => ['workspace', 'self', 'installation'].includes(CASES[r.id]?.kind ?? ''))) {
      const c = CASES[id];
      const body = c?.kind === 'workspace' || c?.kind === 'installation' ? c.body : undefined;
      expect([id, (await request(method, urlFor(path, RESOURCES.a), owner, body)).status]).toEqual([id, 401]);
    }
    expect(await snapshotOfA()).toBe(before);
  });
});

describe('across tenants', () => {
  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(async () => {
    await seed();
    await seedFiles();
    tokens.ownerA = await signIn('owner-a@example.com');
    tokens.ownerB = await signIn('owner-b@example.com');
  });

  it.each(contractRoutes.filter((r) => !r.isPublic))('$id refuses a request with no token', async ({ method, path, id }) => {
    const before = await snapshotOfA();
    const response = await request(method, urlFor(path, RESOURCES.a), null, CASES[id]?.kind === 'self' ? undefined : bodyOf(id));
    expect(response.status).toBe(CASES[id]?.kind === 'operator' ? 404 : 401);
    expect(await snapshotOfA()).toBe(before);
  });

  it.each(contractRoutes.filter((r) => CASES[r.id]?.kind === 'operator'))('$id is not there for a signed-in member', async ({ method, path }) => {
    expect((await request(method, path, tokens.ownerB, undefined)).status).toBe(404);
  });

  it.each(scopedRoutes)('$id answers 404 to the owner of another workspace', async ({ method, path, id }) => {
    const before = await snapshotOfA();
    const response = await request(method, urlFor(path, RESOURCES.a), tokens.ownerB, bodyOf(id));
    expect(response.status).toBe(404);
    expect(await snapshotOfA()).toBe(before);
  });

  it.each(scopedRoutes.filter((r) => [...r.path.matchAll(/\{(\w+)\}/g)].length > 1))(
    '$id answers 404 when another workspace’s resource is named under your own',
    async ({ method, path, id }) => {
      const before = await snapshotOfA();
      const { workspaceId } = RESOURCES.b;
      const response = await request(method, urlFor(path, { workspaceId: workspaceId! }, RESOURCES.a), tokens.ownerB, bodyOf(id));
      expect(response.status).toBe(404);
      expect(await snapshotOfA()).toBe(before);
    },
  );

  it.each(scopedRoutes)('$id answers 404 for a workspace that does not exist, the same as for someone else’s', async ({ method, path, id }) => {
    const strip = async (response: Response) => {
      const body = (await response.json()) as Record<string, unknown>;
      delete body.requestId;
      return [response.status, body];
    };
    const foreign = await request(method, urlFor(path, RESOURCES.a), tokens.ownerB, bodyOf(id));
    const missing = await request(method, urlFor(path, { workspaceId: 'work_missing' }, RESOURCES.a), tokens.ownerB, bodyOf(id));
    expect(await strip(foreign)).toEqual(await strip(missing));
  });

  // Without this, a route that always answered 404 would pass everything above.
  it.each(scopedRoutes)('$id does work for the workspace’s own owner', async ({ method, path, id }) => {
    const response = await request(method, urlFor(path, RESOURCES.a), tokens.ownerA, bodyOf(id));
    expect(response.status).toBe((CASES[id] as Scoped).ownerStatus);
  });
});

describe('installation admin routes', () => {
  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(async () => {
    await seed();
    await seedFiles();
    tokens.ownerB = await signIn('owner-b@example.com');
  });

  const adminRoutes = contractRoutes.filter((r) => CASES[r.id]?.kind === 'installation');

  it.each(adminRoutes)('$id answers a supervisor as if it were not there, and changes nothing', async ({ method, path, id }) => {
    const before = await snapshotOfA();
    expect((await request(method, urlFor(path, RESOURCES.a), tokens.ownerB, (CASES[id] as InstallationAdmin).body)).status).toBe(404);
    expect(await snapshotOfA()).toBe(before);
  });

  // ADR-0016: an admin manages settings without joining, but the workspace's contents still need a membership.
  it.each(scopedRoutes)('$id answers an installation admin who has not joined with 404', async ({ method, path, id }) => {
    await env.DB.prepare(`UPDATE users SET is_installation_admin = 1 WHERE id = 'user_b_owner'`).run();
    const before = await snapshotOfA();
    expect((await request(method, urlFor(path, RESOURCES.a), tokens.ownerB, bodyOf(id))).status).toBe(404);
    expect(await snapshotOfA()).toBe(before);
  });

  it('finds a website only under its own workspace, even for an admin', async () => {
    await env.DB.prepare(`UPDATE users SET is_installation_admin = 1 WHERE id = 'user_b_owner'`).run();
    const before = await snapshotOfA();
    const response = await request('PATCH', `/api/v1/admin/workspaces/work_b/websites/site_a`, tokens.ownerB, { name: 'Taken over' });
    expect(response.status).toBe(404);
    expect(await snapshotOfA()).toBe(before);
  });
});
