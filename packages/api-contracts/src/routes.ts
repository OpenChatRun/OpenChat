import { createRoute, z } from '@hono/zod-openapi';
import { NOTIFICATION_EVENTS } from '@openchat/notification-protocol';
import { page, PaginationQuery, problemResponse } from './common';
import { AssistantMessageSchema, AssistantStateSchema, ConversationPrioritySchema, ConversationStatusSchema, OriginalSchema, VisitorWireMessageSchema } from './realtime';

export const HealthSchema = z.object({ status: z.literal('ok') }).openapi('Health');

export const getHealthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['discovery'],
  security: [], // Deliberately public.
  operationId: 'getHealth',
  summary: 'Liveness only. Exposes no configuration.',
  responses: {
    200: { description: 'Healthy', content: { 'application/json': { schema: HealthSchema } } },
    default: problemResponse,
  },
});

export const DiscoverySchema = z
  .object({
    installationId: z.string(),
    name: z.string(),
    api: z.object({ versions: z.array(z.string()), minor: z.number().int() }),
    realtime: z.object({ protocolVersions: z.array(z.number().int()) }),
    relay: z
      .object({
        id: z.string(),
        url: z.string(),
        bundleIds: z.array(z.string()),
        publicKeys: z.array(z.object({ id: z.string(), alg: z.literal('Ed25519'), key: z.string() })),
      })
      .nullable()
      .openapi({ description: 'Compared by the app with its build-time allowlist, and read by the relay to prove domain control.' }),
    auth: z.object({ signup: z.enum(['invite_only', 'open']) }),
    software: z
      .object({
        name: z.literal('OpenChat'),
        version: z.string().nullable().openapi({ description: 'The release deployed with oc deploy. Null if unknown.' }),
        license: z.literal('AGPL-3.0-or-later'),
        source: z.string().openapi({ description: "Where users can get this installation's source code, as the AGPL asks. The operator's own, or the project's at this release." }),
      })
      .optional()
      .openapi({ description: 'What this installation runs, and where its source is. Absent from installations older than 0.3.0. See docs/operations/licensing.md.' }),
  })
  .openapi('Discovery');

export const getDiscoveryRoute = createRoute({
  method: 'get',
  path: '/.well-known/openchat.json',
  tags: ['discovery'],
  security: [], // Deliberately public.
  operationId: 'getDiscovery',
  summary: 'Describe this installation and its compatibility',
  responses: {
    200: { description: 'Discovery document', content: { 'application/json': { schema: DiscoverySchema } } },
    default: problemResponse,
  },
});

export const getSecurityTxtRoute = createRoute({
  method: 'get',
  path: '/.well-known/security.txt',
  tags: ['discovery'],
  security: [], // Deliberately public.
  operationId: 'getSecurityTxt',
  summary: "The operator's contact for security reports, per RFC 9116. 404 until the operator sets one",
  responses: {
    200: { description: 'security.txt', content: { 'text/plain': { schema: z.string() } } },
    404: { description: 'The operator has not set a security contact' },
  },
});

/**
 * Raised when the API gains something a client must know is there before using it. An unknown query parameter is
 * ignored, so a client cannot tell from the answer alone.
 *
 * - 1: `q` on listConversations, and `lastMessage` and `visitorReadSeq` on a conversation.
 * - 2: `away` on a member with updateMyMembership, and getInboxSummary.
 */
export const API_MINOR_VERSION = 2;

// ---------- Authentication ----------

export const SafeName = z.string().trim().min(1).max(100).regex(/^\P{Cc}*$/u, 'Must not contain control characters');
const Email = z.string().trim().max(320).pipe(z.email());
const bearer = [{ bearerAuth: [] }];
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

export const TokenPairSchema = z
  .object({
    accessToken: z.string(),
    accessTokenExpiresAt: z.string(),
    refreshToken: z.string().optional().openapi({ description: 'Mobile only. Dashboard clients receive an HttpOnly cookie instead.' }),
  })
  .openapi('TokenPair');

export const RoleSchema = z.enum(['supervisor', 'agent']).openapi('Role');

export const WorkspaceSchema = z.object({ id: z.string(), name: z.string(), slug: z.string(), createdAt: z.string() }).openapi('Workspace');

/** The languages OpenChat itself speaks: the dashboard's, the apps' and the widget's. */
export const AppLanguageSchema = z.enum(['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh-Hans', 'zh-Hant']).openapi('AppLanguage');
/** A BCP 47 language tag, such as `de`, `pt-BR` or `zh-Hant`. */
export const LanguageTagSchema = z
  .string()
  .max(35)
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}$/, 'A language tag, such as de or pt-BR')
  .openapi('LanguageTag', { example: 'pt-BR' });

export const MeSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    language: AppLanguageSchema.nullable().openapi({ description: 'The language they read (ADR-0024), the same in every workspace. Null until a client sets it.' }),
    isInstallationAdmin: z.boolean(),
    memberships: z.array(z.object({ memberId: z.string(), role: RoleSchema, workspace: WorkspaceSchema })),
  })
  .openapi('Me');

export const loginRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/login',
  tags: ['auth'],
  operationId: 'login',
  summary: 'Sign in with email and password',
  security: [],
  request: {
    body: {
      required: true,
      ...json(
        z.strictObject({
          email: Email,
          password: z.string().min(1).max(1024),
          clientType: z.enum(['dashboard', 'mobile']),
          clientLabel: z.string().max(100).optional(),
        }),
      ),
    },
  },
  responses: { 200: { description: 'Session created', ...json(TokenPairSchema) }, default: problemResponse },
});

export const refreshRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/refresh',
  tags: ['auth'],
  operationId: 'refreshSession',
  summary: 'Rotate a refresh token. Reuse of an old token revokes the session.',
  security: [],
  request: {
    body: { required: false, ...json(z.strictObject({ refreshToken: z.string().max(256).optional() })) },
  },
  responses: { 200: { description: 'New tokens', ...json(TokenPairSchema) }, default: problemResponse },
});

export const logoutRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags: ['auth'],
  operationId: 'logout',
  summary: 'Revoke the current session',
  security: bearer,
  responses: { 204: { description: 'Revoked' }, default: problemResponse },
});

export const requestPasswordResetRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/password-reset/request',
  tags: ['auth'],
  operationId: 'requestPasswordReset',
  summary: 'Always returns 202, whether or not the account exists',
  security: [],
  request: { body: { required: true, ...json(z.strictObject({ email: Email })) } },
  responses: { 202: { description: 'Accepted' }, default: problemResponse },
});

export const confirmPasswordResetRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/password-reset/confirm',
  tags: ['auth'],
  operationId: 'confirmPasswordReset',
  summary: 'Set a new password. Revokes all sessions for the user.',
  security: [],
  request: { body: { required: true, ...json(z.strictObject({ token: z.string().max(256), password: z.string().min(10).max(1024) })) } },
  responses: { 204: { description: 'Password changed' }, default: problemResponse },
});

// ---------- First-time setup (ADR-0020) ----------

export const SetupStatusSchema = z
  .object({
    status: z.enum(['ready', 'needed', 'unconfigured']).openapi({
      description: '`ready` once the installation exists. `needed` while it waits for its first admin. `unconfigured` when it has no installation and no SETUP_CODE secret, so only `oc deploy` can set it up.',
    }),
  })
  .openapi('SetupStatus');

export const getSetupRoute = createRoute({
  method: 'get',
  path: '/api/v1/setup',
  tags: ['setup'],
  security: [], // Deliberately public.
  operationId: 'getSetup',
  summary: 'Whether this installation still needs its first admin',
  responses: { 200: { description: 'Setup status', ...json(SetupStatusSchema) }, default: problemResponse },
});

export const completeSetupRoute = createRoute({
  method: 'post',
  path: '/api/v1/setup',
  tags: ['setup'],
  security: [], // Deliberately public. Guarded by the setup code, and gone once it has been used.
  operationId: 'completeSetup',
  summary: 'Create the installation and its first admin, once, with the setup code chosen at deploy. 404 afterwards',
  request: {
    body: {
      required: true,
      ...json(
        z.strictObject({
          setupCode: z.string().min(1).max(256),
          name: SafeName.openapi({ description: 'The company. Names the installation and its first workspace.' }),
          ownerName: SafeName,
          email: Email,
          password: z.string().min(10).max(1024),
        }),
      ),
    },
  },
  responses: { 204: { description: 'Set up. Sign in with the email and password' }, default: problemResponse },
});

export const confirmEmailVerificationRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/email-verification/confirm',
  tags: ['auth'],
  operationId: 'confirmEmailVerification',
  summary: 'Confirm an email address',
  security: [],
  request: { body: { required: true, ...json(z.strictObject({ token: z.string().max(256) })) } },
  responses: { 204: { description: 'Verified' }, default: problemResponse },
});

export const getMeRoute = createRoute({
  method: 'get',
  path: '/api/v1/me',
  tags: ['auth'],
  operationId: 'getMe',
  summary: 'The current user and their workspace memberships',
  security: bearer,
  responses: { 200: { description: 'Current user', ...json(MeSchema) }, default: problemResponse },
});

export const updateMeRoute = createRoute({
  method: 'patch',
  path: '/api/v1/me',
  tags: ['auth'],
  operationId: 'updateMe',
  summary: 'Change the language the current user reads',
  description: 'Clients write it when the user chooses a language, and use it as the default on a new device. Translation is into this language (ADR-0024).',
  security: bearer,
  request: { body: { required: true, ...json(z.strictObject({ language: AppLanguageSchema })) } },
  responses: { 200: { description: 'Current user', ...json(MeSchema) }, default: problemResponse },
});

// ---------- Workspaces ----------

const workspaceParams = z.object({ workspaceId: z.string() });
const websiteParams = workspaceParams.extend({ websiteId: z.string() });

export const MemberStatusSchema = z.enum(['active', 'suspended', 'removed']);
export const MemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: RoleSchema,
    status: MemberStatusSchema,
    away: z.boolean().openapi({ description: 'Their own choice. An away member does not make the widget say the team is online, even with the dashboard or app open. Notifications still arrive.' }),
  })
  .openapi('Member');

export const getWorkspaceRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}',
  tags: ['workspaces'],
  operationId: 'getWorkspace',
  summary: 'Get a workspace',
  security: bearer,
  request: { params: workspaceParams },
  responses: { 200: { description: 'Workspace', ...json(WorkspaceSchema) }, default: problemResponse },
});

export const listMembersRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/members',
  tags: ['workspaces'],
  operationId: 'listMembers',
  summary: 'List members. People are changed by an installation admin, under /api/v1/admin.',
  security: bearer,
  request: { params: workspaceParams, query: PaginationQuery },
  responses: { 200: { description: 'Members', ...json(page(MemberSchema)) }, default: problemResponse },
});

export const updateMyMembershipRoute = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{workspaceId}/members/me',
  tags: ['workspaces'],
  operationId: 'updateMyMembership',
  summary: 'Set yourself away, or back. A member changes only their own.',
  security: bearer,
  request: { params: workspaceParams, body: { required: true, ...json(z.strictObject({ away: z.boolean() })) } },
  responses: { 200: { description: 'The member, as changed', ...json(MemberSchema) }, default: problemResponse },
});

export const InboxSummarySchema = z
  .object({
    open: z.number().int().openapi({ description: 'Open conversations.' }),
    unassigned: z.number().int().openapi({ description: 'Open conversations with no assignee.' }),
    mine: z.number().int().openapi({ description: 'Open conversations assigned to the caller.' }),
    pending: z.number().int().openapi({ description: 'Pending conversations.' }),
    unread: z.number().int().openapi({ description: 'Open conversations with a message the caller has not read.' }),
  })
  .openapi('InboxSummary');

export const getInboxSummaryRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/inbox-summary',
  tags: ['conversations'],
  operationId: 'getInboxSummary',
  summary: "Counts for the caller's view of the inbox",
  security: bearer,
  request: { params: workspaceParams },
  responses: { 200: { description: 'Counts', ...json(InboxSummarySchema) }, default: problemResponse },
});

// ---------- Websites ----------

/** An exact origin. No wildcards, paths, or plain HTTP, except on the local machine. */
const isOrigin = (value: string) => {
  if (!URL.canParse(value) || value.includes('*')) return false;
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return url.origin === value && (url.protocol === 'https:' || (url.protocol === 'http:' && local));
};
const Origin = z.string().max(300).refine(isOrigin, 'Must be an exact origin, such as https://example.com');

export const WidgetSettingsSchema = z
  .strictObject({
    welcomeMessage: z.string().max(500).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    availabilityMode: z.enum(['auto', 'online', 'offline']).optional(),
    collectEmail: z.enum(['never', 'optional', 'required']).optional(),
    requireTurnstile: z.boolean().optional(),
    showAgentNames: z.boolean().optional(),
    language: z
      .enum(['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh-Hans', 'zh-Hant'])
      .optional()
      .openapi({ description: "The widget's language. auto, the default, follows the page and then the visitor's browser. A page can still ask for another with data-locale." }),
  })
  .openapi('WidgetSettings');

const websiteFields = { allowedOrigins: z.array(Origin).max(50), settings: WidgetSettingsSchema.optional() };

export const WebsiteSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    websiteKey: z.string().openapi({ description: 'Public identifier embedded in page source. Not a credential.' }),
    allowedOrigins: z.array(z.string()),
    settings: WidgetSettingsSchema,
  })
  .openapi('Website');

export const listWebsitesRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/websites',
  tags: ['websites'],
  operationId: 'listWebsites',
  summary: 'List websites. They are changed by an installation admin, under /api/v1/admin.',
  security: bearer,
  request: { params: workspaceParams },
  responses: { 200: { description: 'Websites', ...json(z.object({ data: z.array(WebsiteSchema) })) }, default: problemResponse },
});

// ---------- Push ----------

export const PushSubscriptionSchema = z
  .object({ id: z.string(), relaySubscriptionId: z.string(), platform: z.enum(['ios', 'android']), deviceLabel: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
  .openapi('PushSubscription');

/** Only `push`. Members are not emailed about conversations (amendment A15). Adding a value is an additive change. */
export const NotificationPreferencesSchema = z
  .object({ preferences: z.array(z.object({ eventType: z.enum(NOTIFICATION_EVENTS), channel: z.enum(['push']), enabled: z.boolean() })).max(NOTIFICATION_EVENTS.length) })
  .openapi('NotificationPreferences');

export const createPushGrantRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/push/grants',
  tags: ['push'],
  operationId: 'createPushGrant',
  summary: 'Issue a short-lived, single-use grant for the device to present to the relay',
  security: bearer,
  request: { params: workspaceParams },
  responses: { 201: { description: 'Grant', ...json(z.object({ grant: z.string(), relayUrl: z.string(), expiresAt: z.iso.datetime() })) }, default: problemResponse },
});

export const listPushSubscriptionsRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/push/subscriptions',
  tags: ['push'],
  operationId: 'listMyPushSubscriptions',
  summary: "The caller's registered devices",
  security: bearer,
  request: { params: workspaceParams },
  responses: { 200: { description: 'Subscriptions', ...json(z.object({ data: z.array(PushSubscriptionSchema) })) }, default: problemResponse },
});

export const recordPushSubscriptionRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/push/subscriptions',
  tags: ['push'],
  operationId: 'recordPushSubscription',
  summary: 'Store the opaque handle returned by the relay, and the public key this phone made for it. No device token is sent here.',
  security: bearer,
  request: {
    params: workspaceParams,
    body: {
      required: true,
      ...json(
        z.object({
          relaySubscriptionId: z.string().regex(/^sub_[A-Za-z0-9_-]{1,64}$/),
          // X25519, 32 bytes, base64url. Each notification is encrypted to it, so the relay cannot read it (ADR-0017).
          previewKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          // Which kind of phone. Shown to the member only; it changes nothing about delivery (ADR-0021).
          platform: z.enum(['ios', 'android']).default('ios'),
          deviceLabel: z.string().max(100).optional(),
        }),
      ),
    },
  },
  responses: { 201: { description: 'Recorded', ...json(PushSubscriptionSchema) }, default: problemResponse },
});

export const removePushSubscriptionRoute = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{workspaceId}/push/subscriptions/{subscriptionId}',
  tags: ['push'],
  operationId: 'removePushSubscription',
  summary: 'Remove a device, and unregister it at the relay',
  security: bearer,
  request: { params: workspaceParams.extend({ subscriptionId: z.string() }) },
  responses: { 204: { description: 'Removed' }, default: problemResponse },
});

export const getNotificationPreferencesRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/notification-preferences',
  tags: ['push'],
  operationId: 'getNotificationPreferences',
  summary: "The caller's preferences. An event with no choice made is on.",
  security: bearer,
  request: { params: workspaceParams },
  responses: { 200: { description: 'Preferences', ...json(NotificationPreferencesSchema) }, default: problemResponse },
});

export const setNotificationPreferencesRoute = createRoute({
  method: 'put',
  path: '/api/v1/workspaces/{workspaceId}/notification-preferences',
  tags: ['push'],
  operationId: 'setNotificationPreferences',
  summary: "Replace the caller's preferences",
  security: bearer,
  request: { params: workspaceParams, body: { required: true, ...json(NotificationPreferencesSchema) } },
  responses: { 204: { description: 'Updated' }, default: problemResponse },
});

// ---------- Email consent ----------

const UnsubscribeQuery = z.object({ token: z.string().max(200).optional() });
const unsubscribePage = { content: { 'text/html': { schema: z.string() } } };

export const showUnsubscribeRoute = createRoute({
  method: 'get',
  path: '/api/v1/unsubscribe',
  tags: ['email'],
  security: [],
  operationId: 'showUnsubscribe',
  summary: 'A page that asks to confirm',
  description: 'Changes nothing, because mail scanners open links on their own. No sign-in. The token in the link is the only authority.',
  request: { query: UnsubscribeQuery },
  responses: { 200: { description: 'Page', ...unsubscribePage }, 404: { description: 'No such link', ...unsubscribePage }, default: problemResponse },
});

export const confirmUnsubscribeRoute = createRoute({
  method: 'post',
  path: '/api/v1/unsubscribe',
  tags: ['email'],
  security: [],
  operationId: 'confirmUnsubscribe',
  summary: 'Unsubscribe, from the page or by one click in a mail app (RFC 8058)',
  description: 'Adds the address to the workspace suppression list and clears its consent. Repeating it changes nothing more.',
  request: { query: UnsubscribeQuery },
  responses: { 200: { description: 'Page', ...unsubscribePage }, 404: { description: 'No such link', ...unsubscribePage }, default: problemResponse },
});

export const FollowUpRuleSchema = z
  .object({ id: z.string(), name: z.string(), enabled: z.boolean(), inactiveMinutes: z.number().int(), createdAt: z.number(), updatedAt: z.number() })
  .openapi('FollowUpRule');

/** Long enough that it is not a reply to someone still typing, and within what a conversation still means after a while. */
const InactiveMinutes = z.number().int().min(5).max(43_200);
const followUpRuleParams = workspaceParams.extend({ ruleId: z.string() });

export const listFollowUpRulesRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/follow-up-rules',
  tags: ['email'],
  operationId: 'listFollowUpRules',
  summary: 'Rules for following up on quiet conversations. For supervisors.',
  security: bearer,
  request: { params: workspaceParams },
  responses: { 200: { description: 'Rules', ...json(z.object({ data: z.array(FollowUpRuleSchema) })) }, default: problemResponse },
});

export const createFollowUpRuleRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/follow-up-rules',
  tags: ['email'],
  operationId: 'createFollowUpRule',
  summary: 'Add a rule. For supervisors.',
  description: 'A rule only ever emails an open conversation whose visitor gave an address and consent. It first applies after the next public message in a conversation.',
  security: bearer,
  request: { params: workspaceParams, body: { required: true, ...json(z.strictObject({ name: SafeName, enabled: z.boolean().default(true), inactiveMinutes: InactiveMinutes })) } },
  responses: { 201: { description: 'Rule', ...json(FollowUpRuleSchema) }, default: problemResponse },
});

export const updateFollowUpRuleRoute = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{workspaceId}/follow-up-rules/{ruleId}',
  tags: ['email'],
  operationId: 'updateFollowUpRule',
  summary: 'Change a rule. For supervisors.',
  security: bearer,
  request: {
    params: followUpRuleParams,
    body: {
      required: true,
      ...json(
        z
          .strictObject({ name: SafeName.optional(), enabled: z.boolean().optional(), inactiveMinutes: InactiveMinutes.optional() })
          .refine((b) => b.name !== undefined || b.enabled !== undefined || b.inactiveMinutes !== undefined, 'Nothing to change'),
      ),
    },
  },
  responses: { 200: { description: 'Rule', ...json(FollowUpRuleSchema) }, default: problemResponse },
});

export const deleteFollowUpRuleRoute = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{workspaceId}/follow-up-rules/{ruleId}',
  tags: ['email'],
  operationId: 'deleteFollowUpRule',
  summary: 'Delete a rule. For supervisors.',
  security: bearer,
  request: { params: followUpRuleParams },
  responses: { 204: { description: 'Deleted' }, default: problemResponse },
});

export const EmailSuppressionSchema = z
  .object({ email: z.string(), reason: z.enum(['unsubscribe', 'bounce', 'complaint', 'manual']), createdAt: z.number() })
  .openapi('EmailSuppression');

const SuppressionBody = z.strictObject({ email: z.email().max(254) });

export const listEmailSuppressionsRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/email-suppressions',
  tags: ['email'],
  operationId: 'listEmailSuppressions',
  summary: 'Addresses this workspace must not email. For supervisors.',
  security: bearer,
  request: { params: workspaceParams, query: PaginationQuery },
  responses: { 200: { description: 'Addresses', ...json(page(EmailSuppressionSchema)) }, default: problemResponse },
});

export const addEmailSuppressionRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/email-suppressions',
  tags: ['email'],
  operationId: 'addEmailSuppression',
  summary: 'Add an address by hand. For supervisors.',
  security: bearer,
  request: { params: workspaceParams, body: { required: true, ...json(SuppressionBody) } },
  responses: { 204: { description: 'Listed' }, default: problemResponse },
});

/** A POST with a body, because a path would put the address in request logs. */
export const removeEmailSuppressionRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/email-suppressions/remove',
  tags: ['email'],
  operationId: 'removeEmailSuppression',
  summary: 'Remove an address added by hand. For supervisors.',
  description: 'Refuses with 409 for anyone who unsubscribed, whose bounce or complaint is on record.',
  security: bearer,
  request: { params: workspaceParams, body: { required: true, ...json(SuppressionBody) } },
  responses: { 204: { description: 'Removed' }, default: problemResponse },
});


// ---------- Conversations and messages, for agents ----------

const conversationParams = workspaceParams.extend({ conversationId: z.string() });


export const TagSchema = z.object({ id: z.string(), name: z.string() }).openapi('Tag');

const VisitorPageSchema = z.object({ url: z.string(), at: z.string().openapi({ description: 'When the widget reported it.' }) });

export const ConversationSchema = z
  .object({
    id: z.string(),
    websiteId: z.string(),
    contactId: z.string(),
    contactName: z.string().nullable(),
    contactEmail: z.string().nullable().openapi({ description: 'Given by the visitor or an agent. Never verified.' }),
    tags: z.array(TagSchema),
    assignedMemberId: z.string().nullable(),
    status: ConversationStatusSchema,
    priority: ConversationPrioritySchema,
    subject: z.string().nullable(),
    version: z.number().int(),
    lastMessageSeq: z.number().int(),
    lastMessageAt: z.string().nullable(),
    lastReadSeq: z.number().int().openapi({ description: "The caller's read position, for unread counts." }),
    createdAt: z.string(),
    updatedAt: z.string(),
    assistantState: AssistantStateSchema.nullable().openapi({ description: 'The AI assistant here: `answering`, `handed_over` to the team, `stopped` because a member stepped in, or null if it never took part.' }),
    helpArticleId: z.string().nullable().openapi({ description: 'The help article the visitor was reading when they started it, from "Still need help?" in the widget. It may since have been deleted.' }),
    visitorLanguage: LanguageTagSchema.nullable().openapi({ description: "The visitor's language, as their widget or browser gave it. Null for conversations started before it was recorded, until the visitor writes again." }),
    lastMessage: z
      .object({
        text: z.string().openapi({ description: 'The start of the message, at most 140 characters. Empty for a message that is only files.' }),
        senderType: z.enum(['visitor', 'member', 'assistant', 'system']),
        senderId: z.string().nullable().openapi({ description: 'The member who wrote it, or null for anyone else.' }),
        type: z.enum(['text', 'image', 'file', 'system', 'internal_note']),
      })
      .nullable()
      .openapi({ description: 'The newest message, cut short, for a line in the inbox. It may be an internal note. Null when that message has been removed, as retention does.' }),
    visitorPage: VisitorPageSchema.nullable().openapi({ description: "The page the visitor's widget last reported, without its query or fragment. Only the current one is kept. Null when none was reported, or the installation has it turned off." }),
    visitorReadSeq: z.number().int().openapi({ description: 'How far the visitor has read, as a public sequence number: compare it with a message\'s `publicSeq`. 0 when they have read nothing.' }),
  })
  .openapi('Conversation');

export const AttachmentSchema = z
  .object({ id: z.string(), filename: z.string(), contentType: z.string(), size: z.number().int(), status: z.enum(['pending', 'ready', 'rejected']), url: z.string() })
  .openapi('Attachment');

export const MessageTranslationSchema = z.object({ language: z.string(), content: z.string() }).openapi('MessageTranslation');

export const MessageSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    seq: z.number().int(),
    publicSeq: z.number().int().nullable().openapi({ description: 'Null for internal notes.' }),
    clientMessageId: z.string().nullable(),
    sender: z.object({ type: z.enum(['visitor', 'member', 'system']), id: z.string().nullable(), displayName: z.string().nullable(), removed: z.boolean().optional() }),
    type: z.enum(['text', 'image', 'file', 'system', 'internal_note']),
    visibility: z.enum(['public', 'internal']),
    content: z.string(),
    attachments: z.array(AttachmentSchema),
    createdAt: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    assistant: AssistantMessageSchema.optional().openapi({ description: 'Present when the AI assistant wrote it, as a system message. `sender.displayName` is its name.' }),
    translations: z.array(MessageTranslationSchema).optional().openapi({ description: "Machine translations of a visitor's message for the team (ADR-0024), one per language. Absent when there are none." }),
    original: OriginalSchema.optional().openapi({ description: 'A reply sent translated (ADR-0024): `content` is what the visitor received, and this is what the member wrote, in their language.' }),
  })
  .openapi('Message');

const SeqQuery = z.coerce.number().int().min(0);

export const listConversationsRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/conversations',
  tags: ['conversations'],
  operationId: 'listConversations',
  summary: 'An inbox view, most recent first',
  security: bearer,
  request: {
    params: workspaceParams,
    query: PaginationQuery.extend({
      status: ConversationStatusSchema.default('open'),
      assignee: z.string().max(64).optional().openapi({ description: 'A member ID, `me`, or `none`.' }),
      q: z.string().trim().min(1).max(254).optional().openapi({ description: "Only conversations whose contact's name or email contains this, ignoring case for the letters A to Z. A search looks in every status and for every assignee: `status` and `assignee` are ignored." }),
      updatedAfter: z.string().max(512).optional().openapi({ description: 'A `syncCursor` from an earlier response. Returns everything changed since, in any status, oldest change first. Other filters are ignored.' }),
    }),
  },
  responses: { 200: { description: 'Conversations', ...json(page(ConversationSchema).extend({ syncCursor: z.string().openapi({ description: 'Pass as `updatedAfter` to catch up later.' }) })) }, default: problemResponse },
});

export const getConversationRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/conversations/{conversationId}',
  tags: ['conversations'],
  operationId: 'getConversation',
  summary: 'Get a conversation',
  security: bearer,
  request: { params: conversationParams },
  responses: { 200: { description: 'Conversation', ...json(ConversationSchema) }, default: problemResponse },
});

export const updateConversationRoute = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{workspaceId}/conversations/{conversationId}',
  tags: ['conversations'],
  operationId: 'updateConversation',
  summary: 'Assign, transfer, resolve, reopen, archive, or reprioritise',
  description: 'Compare-and-set on `expectedVersion`. A stale version answers 409 with the current version.',
  security: bearer,
  request: {
    params: conversationParams,
    body: {
      required: true,
      ...json(
        z
          .strictObject({
            expectedVersion: z.number().int().min(1),
            assignedMemberId: z.string().max(64).nullable().optional(),
            status: ConversationStatusSchema.optional(),
            priority: ConversationPrioritySchema.optional(),
            visitorLanguage: LanguageTagSchema.optional().openapi({ description: "Corrects the visitor's language. Supervisors only." }),
          })
          .refine((b) => b.assignedMemberId !== undefined || b.status !== undefined || b.priority !== undefined || b.visitorLanguage !== undefined, 'Nothing to change'),
      ),
    },
  },
  responses: { 200: { description: 'Updated', ...json(ConversationSchema) }, default: problemResponse },
});

export const listMessagesRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages',
  tags: ['conversations'],
  operationId: 'listMessages',
  summary: 'Messages, including internal notes, oldest first',
  security: bearer,
  request: {
    params: conversationParams,
    query: z.object({
      afterSeq: SeqQuery.optional().openapi({ description: 'Forward from this sequence number, for catch-up.' }),
      beforeSeq: SeqQuery.optional().openapi({ description: 'Backward from this sequence number, for history.' }),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: { 200: { description: 'Messages', ...json(z.object({ data: z.array(MessageSchema) })) }, default: problemResponse },
});

// ---------- Automatic translation (ADR-0024) ----------

export const TranslationSettingsSchema = z
  .object({
    available: z.boolean().openapi({ description: 'False when the installation has no Workers AI or no assistant queue. Nothing is translated then.' }),
    enabled: z.boolean(),
    model: z.string().openapi({ description: "The model for visitors' messages." }),
    models: z.array(z.object({ id: z.string(), label: z.string() })),
    usage: z.object({ day: z.string(), characters: z.number().int(), limit: z.number().int() }).openapi({ description: 'Characters translated today (UTC), and the daily limit.' }),
  })
  .openapi('TranslationSettings');

export const getTranslationSettingsRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/translation',
  tags: ['conversations'],
  operationId: 'getTranslationSettings',
  summary: "Whether visitors' messages are translated for the team, and with which model",
  security: bearer,
  request: { params: workspaceParams },
  responses: { 200: { description: 'Settings', ...json(TranslationSettingsSchema) }, default: problemResponse },
});

export const updateTranslationSettingsRoute = createRoute({
  method: 'put',
  path: '/api/v1/workspaces/{workspaceId}/translation',
  tags: ['conversations'],
  operationId: 'updateTranslationSettings',
  summary: 'Turn translation on or off, or choose its model. For supervisors.',
  description: 'Audited. Refused with 409 `translation_unavailable` on an installation without Workers AI.',
  security: bearer,
  request: { params: workspaceParams, body: { required: true, ...json(z.strictObject({ enabled: z.boolean(), model: z.string().max(128) })) } },
  responses: { 200: { description: 'Settings', ...json(TranslationSettingsSchema) }, default: problemResponse },
});

export const translateMessageRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}/translation',
  tags: ['conversations'],
  operationId: 'translateMessage',
  summary: "Translate a visitor's message into the caller's language, or another of OpenChat's",
  description: 'Returns the stored translation if there is one. Counts against the daily limit; 429 `translation_limit` past it, 502 `translation_failed` if the model fails.',
  security: bearer,
  request: { params: conversationParams.extend({ messageId: z.string() }), body: { required: true, ...json(z.strictObject({ language: AppLanguageSchema.optional() })) } },
  responses: { 200: { description: 'Translation', ...json(MessageTranslationSchema) }, default: problemResponse },
});

export const sendMessageRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages',
  tags: ['conversations'],
  operationId: 'sendMessage',
  summary: 'Send a reply or an internal note',
  security: bearer,
  request: {
    params: conversationParams,
    body: {
      required: true,
      ...json(
        z.strictObject({
          clientMessageId: z.string().min(8).max(64),
          type: z.enum(['text', 'internal_note']),
          content: z.string().trim().max(16000),
          attachmentIds: z.array(z.string().max(64)).max(10).optional().openapi({ description: 'Files uploaded to this conversation by this member. Content may be empty if there is at least one.' }),
          translate: z.boolean().optional().openapi({
            description:
              "Send a reply translated into the visitor's language when the workspace translates and they read another (ADR-0024). If it cannot be translated, nothing is sent: 409 `translation_unavailable`, 429 `translation_limit`, or 502 `translation_failed`. Send again without it to send the words as written.",
          }),
        }).refine((body) => body.content.length > 0 || (body.attachmentIds?.length ?? 0) > 0, { message: 'Write something or attach a file' }),
      ),
    },
  },
  responses: {
    201: { description: 'Committed', ...json(MessageSchema) },
    200: { description: 'A replay of an existing clientMessageId. Returns the original.', ...json(MessageSchema) },
    default: problemResponse,
  },
});

export const markConversationReadRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/read',
  tags: ['conversations'],
  operationId: 'markConversationRead',
  summary: "Move the caller's delivered and read positions forward",
  security: bearer,
  request: {
    params: conversationParams,
    body: { required: true, ...json(z.strictObject({ deliveredSeq: z.number().int().min(0), readSeq: z.number().int().min(0) })) },
  },
  responses: { 204: { description: 'Recorded' }, default: problemResponse },
});

// ---------- The widget, for visitors ----------

const visitor = [{ visitorAuth: [] }];
const ClientMessageId = z.string().min(8).max(64);
/** The most that an installation can allow. Its own limit, 4,000 by default, is checked later and given in the bootstrap. */
const VISITOR_CONTENT_MAX = 16000;
const VisitorContent = z.string().trim().min(1).max(VISITOR_CONTENT_MAX);
const visitorConversationParams = z.object({ conversationId: z.string() });

export const WidgetBootstrapSchema = z
  .object({
    websiteId: z.string(),
    settings: WidgetSettingsSchema,
    availability: z.enum(['online', 'offline']),
    turnstileSiteKey: z.string().optional().openapi({ description: 'Present when this website requires Turnstile for a new visitor.' }),
    reportPage: z.boolean().openapi({ description: 'Whether the widget should say which page the visitor is on, with setVisitorPage. False when the operator turned it off.' }),
    messageMaxChars: z.number().int().openapi({ description: "The longest message this installation accepts from a visitor. A longer one is refused with `message_too_long`." }),
    helpLanguages: z.array(z.string()).openapi({ description: 'Languages with published help articles, most articles first. Empty: the widget shows no Help tab.' }),
  })
  .openapi('WidgetBootstrap');

export const VisitorSessionSchema = z
  .object({ visitorId: z.string(), accessToken: z.string(), accessTokenExpiresAt: z.string(), refreshToken: z.string() })
  .openapi('VisitorSession');

export const VisitorConversationSchema = z
  .object({ id: z.string(), status: ConversationStatusSchema, lastSeq: z.number().int().openapi({ description: 'The latest public sequence number.' }), readSeq: z.number().int().openapi({ description: "This visitor's own read position." }), agentReadSeq: z.number().int().openapi({ description: 'How far any agent has read, as a public sequence number.' }), createdAt: z.string() })
  .openapi('VisitorConversation', { description: 'A deliberately reduced view, with no assignee, priority, or internal counters.' });

const VisitorConversationStartedSchema = VisitorConversationSchema.extend({ message: VisitorWireMessageSchema }).openapi('VisitorConversationStarted', {
  description: 'The conversation, and the message that started it, so that a client knows it is committed without asking again.',
});

export const widgetBootstrapRoute = createRoute({
  method: 'get',
  path: '/api/v1/widget/bootstrap',
  tags: ['widget'],
  operationId: 'widgetBootstrap',
  summary: 'Public configuration. Cached for 30 seconds. The Origin must be allowed for the website.',
  security: [],
  request: { query: z.object({ websiteKey: z.string().max(128) }) },
  responses: { 200: { description: 'Widget configuration', ...json(WidgetBootstrapSchema) }, default: problemResponse },
});

export const createVisitorSessionRoute = createRoute({
  method: 'post',
  path: '/api/v1/widget/sessions',
  tags: ['widget'],
  operationId: 'createVisitorSession',
  summary: 'Create or resume an anonymous visitor session. The Origin must be allowed for the website.',
  description: 'A refresh token that is unknown or belongs to another website starts a new visitor, with no history.',
  security: [],
  request: { body: { required: true, ...json(z.strictObject({ websiteKey: z.string().max(128), refreshToken: z.string().max(256).optional(), turnstileToken: z.string().max(2048).optional().openapi({ description: 'Needed to start a new visitor on a website that requires Turnstile. Not needed to resume one.' }) })) } },
  responses: { 200: { description: 'Visitor session', ...json(VisitorSessionSchema) }, default: problemResponse },
});

export const updateVisitorProfileRoute = createRoute({
  method: 'patch',
  path: '/api/v1/widget/me',
  tags: ['widget'],
  operationId: 'updateVisitorProfile',
  summary: 'Provide a name, email, and follow-up consent',
  description: 'An email is unverified, and never merges with an existing contact automatically.',
  security: visitor,
  request: {
    body: {
      required: true,
      ...json(
        z
          .strictObject({ name: SafeName.optional(), email: z.email().max(254).optional(), followUpConsent: z.boolean().optional() })
          .refine((b) => b.name !== undefined || b.email !== undefined || b.followUpConsent !== undefined, 'Nothing to change'),
      ),
    },
  },
  responses: { 204: { description: 'Updated' }, default: problemResponse },
});

export const listVisitorConversationsRoute = createRoute({
  method: 'get',
  path: '/api/v1/widget/conversations',
  tags: ['widget'],
  operationId: 'listVisitorConversations',
  summary: "The visitor's own conversations",
  security: visitor,
  responses: { 200: { description: 'Conversations', ...json(z.object({ data: z.array(VisitorConversationSchema) })) }, default: problemResponse },
});

export const createVisitorConversationRoute = createRoute({
  method: 'post',
  path: '/api/v1/widget/conversations',
  tags: ['widget'],
  operationId: 'createVisitorConversation',
  summary: 'Start a conversation with a first message',
  security: visitor,
  request: {
    body: {
      required: true,
      ...json(
        z.strictObject({
          clientMessageId: ClientMessageId,
          content: VisitorContent,
          helpArticleId: z.string().max(64).optional().openapi({ description: 'The help article the visitor came from. Kept only if it is a published article of this website.' }),
          language: LanguageTagSchema.optional().openapi({ description: "The visitor's language: the widget's, or the browser's when the widget does not speak it." }),
        }),
      ),
    },
  },
  responses: {
    201: { description: 'Created', ...json(VisitorConversationStartedSchema) },
    200: { description: 'A replay of an existing clientMessageId. Returns the same conversation.', ...json(VisitorConversationStartedSchema) },
    default: problemResponse,
  },
});

export const listVisitorMessagesRoute = createRoute({
  method: 'get',
  path: '/api/v1/widget/conversations/{conversationId}/messages',
  tags: ['widget'],
  operationId: 'listVisitorMessages',
  summary: 'Public messages only, oldest first. Here seq is the public sequence.',
  security: visitor,
  request: {
    params: visitorConversationParams,
    query: z.object({ afterSeq: SeqQuery.optional(), beforeSeq: SeqQuery.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
  },
  responses: { 200: { description: 'Messages', ...json(z.object({ data: z.array(VisitorWireMessageSchema) })) }, default: problemResponse },
});

export const sendVisitorMessageRoute = createRoute({
  method: 'post',
  path: '/api/v1/widget/conversations/{conversationId}/messages',
  tags: ['widget'],
  operationId: 'sendVisitorMessage',
  summary: 'Send a message. Rate limited per visitor and per website.',
  security: visitor,
  request: { params: visitorConversationParams, body: { required: true, ...json(z.strictObject({ clientMessageId: ClientMessageId, content: z.string().trim().max(VISITOR_CONTENT_MAX), attachmentIds: z.array(z.string().max(64)).max(5).optional(), language: LanguageTagSchema.optional().openapi({ description: "The visitor's language. Kept only if the conversation has none yet." }) }).refine((body) => body.content.length > 0 || (body.attachmentIds?.length ?? 0) > 0, { message: 'Write something or attach a file' })) } },
  responses: {
    201: { description: 'Committed', ...json(VisitorWireMessageSchema) },
    200: { description: 'A replay of an existing clientMessageId', ...json(VisitorWireMessageSchema) },
    default: problemResponse,
  },
});

export const setVisitorPageRoute = createRoute({
  method: 'put',
  path: '/api/v1/widget/conversations/{conversationId}/page',
  tags: ['widget'],
  operationId: 'setVisitorPage',
  summary: 'Say which page the visitor is on. The query and fragment are dropped, and it replaces the last page.',
  security: visitor,
  request: { params: visitorConversationParams, body: { required: true, ...json(z.strictObject({ url: z.string().min(1).max(4096) })) } },
  responses: { 204: { description: 'Recorded, or ignored because the installation has it turned off' }, default: problemResponse },
});

export const markVisitorConversationReadRoute = createRoute({
  method: 'post',
  path: '/api/v1/widget/conversations/{conversationId}/read',
  tags: ['widget'],
  operationId: 'markVisitorConversationRead',
  summary: "Move the visitor's delivered and read positions forward, in public sequence numbers",
  security: visitor,
  request: { params: visitorConversationParams, body: { required: true, ...json(z.strictObject({ deliveredSeq: z.number().int().min(0), readSeq: z.number().int().min(0) })) } },
  responses: { 204: { description: 'Recorded' }, default: problemResponse },
});

// ---------- Realtime ----------

export const RealtimeTicketSchema = z
  .object({ ticket: z.string(), url: z.string(), expiresAt: z.string() })
  .openapi('RealtimeTicket', { description: 'Connect to `url` within 30 seconds. The ticket is good for one purpose only, and grants nothing over REST.' });

export const createAgentTicketRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/realtime/tickets',
  tags: ['realtime'],
  operationId: 'createAgentTicket',
  summary: 'A ticket for a socket that receives everything in this workspace',
  security: bearer,
  request: { params: workspaceParams },
  responses: { 201: { description: 'Ticket', ...json(RealtimeTicketSchema) }, default: problemResponse },
});

export const createVisitorTicketRoute = createRoute({
  method: 'post',
  path: '/api/v1/widget/conversations/{conversationId}/realtime/tickets',
  tags: ['widget'],
  operationId: 'createVisitorTicket',
  summary: "A ticket for a socket that receives this conversation's public events",
  security: visitor,
  request: { params: visitorConversationParams },
  responses: { 201: { description: 'Ticket', ...json(RealtimeTicketSchema) }, default: problemResponse },
});

export const connectRealtimeRoute = createRoute({
  method: 'get',
  path: '/api/v1/realtime/connect',
  tags: ['realtime'],
  operationId: 'connectRealtime',
  summary: 'Upgrade to a WebSocket',
  description: 'Frames are published as AgentServerFrame, AgentClientFrame, VisitorServerFrame, and VisitorClientFrame.',
  security: [],
  request: { query: z.object({ ticket: z.string().max(4096) }) },
  responses: { 101: { description: 'Switching protocols' }, default: problemResponse },
});

// ---------- Contacts and tags ----------

const contactParams = workspaceParams.extend({ contactId: z.string() });
const tagParams = workspaceParams.extend({ tagId: z.string() });

export const ContactSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable().openapi({ description: 'Never verified, so it proves nothing about who this is.' }),
    phone: z.string().nullable(),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
  })
  .openapi('Contact');

export const getContactRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/contacts/{contactId}',
  tags: ['conversations'],
  operationId: 'getContact',
  summary: 'Get a contact',
  security: bearer,
  request: { params: contactParams },
  responses: { 200: { description: 'Contact', ...json(ContactSchema) }, default: problemResponse },
});

export const updateContactRoute = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{workspaceId}/contacts/{contactId}',
  tags: ['conversations'],
  operationId: 'updateContact',
  summary: 'Correct a name, email, or phone number',
  security: bearer,
  request: {
    params: contactParams,
    body: {
      required: true,
      ...json(
        z
          .strictObject({
            name: SafeName.nullable().optional(),
            email: z.email().max(254).nullable().optional(),
            phone: z.string().trim().max(40).regex(/^\P{Cc}*$/u, 'Must not contain control characters').nullable().optional(),
          })
          .refine((b) => b.name !== undefined || b.email !== undefined || b.phone !== undefined, 'Nothing to change'),
      ),
    },
  },
  responses: { 200: { description: 'Updated', ...json(ContactSchema) }, default: problemResponse },
});

export const ContactExportSchema = z
  .object({
    exportedAt: z.string(),
    includesInternalNotes: z.boolean(),
    contact: ContactSchema.extend({
      attributes: z.record(z.string(), z.unknown()).nullable(),
      followUpConsentAt: z.string().nullable(),
      followUpConsentSource: z.string().nullable(),
      createdAt: z.string(),
    }),
    tags: z.array(z.string()),
    browsers: z.array(z.object({ id: z.string(), websiteId: z.string(), firstSeenAt: z.string(), lastSeenAt: z.string() })),
    conversations: z.array(
      z.object({
        id: z.string(),
        websiteId: z.string(),
        status: z.string(),
        subject: z.string().nullable(),
        createdAt: z.string(),
        visitorPage: VisitorPageSchema.nullable(),
        messages: z.array(
          z.object({
            id: z.string(),
            from: z.enum(['visitor', 'member', 'system']).openapi({ description: 'Who wrote it, without naming colleagues.' }),
            type: z.string(),
            internal: z.boolean(),
            content: z.string(),
            createdAt: z.string(),
            attachments: z.array(z.object({ filename: z.string(), contentType: z.string(), size: z.number().int() })),
            machineTranslations: z.array(MessageTranslationSchema).openapi({ description: 'Machine translations for the team (ADR-0024). Written by a model, not by anyone in the conversation.' }),
            original: OriginalSchema.optional().openapi({ description: 'A team reply sent translated: what the team member wrote. `content` is the machine translation the visitor received.' }),
          }),
        ),
      }),
    ),
    emailSuppressions: z.array(z.object({ email: z.string(), reason: z.string(), createdAt: z.string() })),
  })
  .openapi('ContactExport', { description: 'Everything this workspace holds about one contact, for a request from that person. Files are listed, not included.' });

const contactAdminDescription =
  'For an installation admin who is a member of this workspace. Another member gets 403, and anyone else 404. Recorded in the audit log.';

export const exportContactRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/contacts/{contactId}/export',
  tags: ['conversations'],
  operationId: 'exportContact',
  summary: 'Export what this workspace holds about a contact',
  description: `${contactAdminDescription} Internal notes are left out unless \`include=notes\`, because the export is usually given to the person it is about.`,
  security: bearer,
  request: { params: contactParams, query: z.object({ include: z.enum(['notes']).optional() }) },
  responses: { 200: { description: 'Export', ...json(ContactExportSchema) }, default: problemResponse },
});

export const eraseContactRoute = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{workspaceId}/contacts/{contactId}',
  tags: ['conversations'],
  operationId: 'eraseContact',
  summary: 'Erase a contact, with their conversations, messages, and files',
  description: `${contactAdminDescription} Cannot be undone. Email suppressions for their address stay, so that an address that opted out stays out.`,
  security: bearer,
  request: { params: contactParams },
  responses: { 204: { description: 'Erased' }, default: problemResponse },
});

export const listTagsRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/tags',
  tags: ['conversations'],
  operationId: 'listTags',
  summary: "The workspace's tags, by name",
  security: bearer,
  request: { params: workspaceParams },
  responses: { 200: { description: 'Tags', ...json(z.object({ data: z.array(TagSchema) })) }, default: problemResponse },
});

export const createTagRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/tags',
  tags: ['conversations'],
  operationId: 'createTag',
  summary: 'Create a tag, or return the one with this name',
  security: bearer,
  request: { params: workspaceParams, body: { required: true, ...json(z.strictObject({ name: SafeName.max(50) })) } },
  responses: {
    201: { description: 'Created', ...json(TagSchema) },
    200: { description: 'A tag with this name already exists, whatever its capitals.', ...json(TagSchema) },
    default: problemResponse,
  },
});

export const deleteTagRoute = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{workspaceId}/tags/{tagId}',
  tags: ['conversations'],
  operationId: 'deleteTag',
  summary: 'Delete a tag, and take it off everything',
  security: bearer,
  request: { params: tagParams },
  responses: { 204: { description: 'Deleted' }, default: problemResponse },
});

export const setConversationTagsRoute = createRoute({
  method: 'put',
  path: '/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/tags',
  tags: ['conversations'],
  operationId: 'setConversationTags',
  summary: 'Replace the tags on a conversation',
  description: "Does not move the conversation's version, so tagging never conflicts with a reply or an assignment. The last write wins.",
  security: bearer,
  request: { params: conversationParams, body: { required: true, ...json(z.strictObject({ tagIds: z.array(z.string().max(64)).max(50) })) } },
  responses: { 204: { description: 'Updated' }, default: problemResponse },
});

const BinaryBody = { required: true, content: { 'application/octet-stream': { schema: z.string().openapi({ type: 'string', format: 'binary' }) } } } as const;
const BinaryFile = { description: 'The file, with safe headers', content: { 'application/octet-stream': { schema: z.string().openapi({ type: 'string', format: 'binary' }) } } } as const;
const FilenameQuery = z.object({ filename: z.string().min(1).max(1024) });
const UPLOAD_NOTE = 'The body is the file, as a stream, with its type in Content-Type and its size in Content-Length. Name its ID on a later message. A file that no message claims within a day is deleted.';

export const uploadAttachmentRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/attachments',
  tags: ['attachments'],
  operationId: 'uploadAttachment',
  summary: 'Upload a file',
  description: UPLOAD_NOTE,
  security: bearer,
  request: { params: conversationParams, query: FilenameQuery, body: BinaryBody },
  responses: { 201: { description: 'Stored', ...json(AttachmentSchema) }, default: problemResponse },
});

export const downloadAttachmentRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/attachments/{attachmentId}',
  tags: ['attachments'],
  operationId: 'downloadAttachment',
  summary: 'Download a file',
  security: bearer,
  request: { params: z.object({ workspaceId: z.string(), attachmentId: z.string() }) },
  responses: { 200: BinaryFile, default: problemResponse },
});

export const uploadVisitorAttachmentRoute = createRoute({
  method: 'post',
  path: '/api/v1/widget/conversations/{conversationId}/attachments',
  tags: ['widget'],
  operationId: 'uploadVisitorAttachment',
  summary: 'Upload a file to a conversation of this visitor',
  description: UPLOAD_NOTE,
  security: visitor,
  request: { params: visitorConversationParams, query: FilenameQuery, body: BinaryBody },
  responses: { 201: { description: 'Stored', ...json(AttachmentSchema) }, default: problemResponse },
});

export const downloadVisitorAttachmentRoute = createRoute({
  method: 'get',
  path: '/api/v1/widget/attachments/{attachmentId}',
  tags: ['widget'],
  operationId: 'downloadVisitorAttachment',
  summary: 'Download a file on a public message in a conversation of this visitor',
  security: visitor,
  request: { params: z.object({ attachmentId: z.string() }) },
  responses: { 200: BinaryFile, default: problemResponse },
});

// ---------- Installation admin ----------

const personParams = z.object({ userId: z.string() });
const personWorkspaceParams = personParams.extend({ workspaceId: z.string() });

export const PersonSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    isInstallationAdmin: z.boolean(),
    deactivated: z.boolean(),
    memberships: z.array(z.object({ memberId: z.string(), workspaceId: z.string(), workspaceName: z.string(), role: RoleSchema, status: MemberStatusSchema })),
  })
  .openapi('Person');

export const AdminWorkspaceSchema = z.object({ id: z.string(), name: z.string() }).openapi('AdminWorkspace');

const adminRoute = { tags: ['admin'], security: bearer };

export const listPeopleRoute = createRoute({
  ...adminRoute,
  method: 'get',
  path: '/api/v1/admin/people',
  operationId: 'listPeople',
  summary: 'List every account on the installation. Anyone but an installation admin gets 404.',
  request: {
    query: PaginationQuery.extend({
      q: z.string().trim().max(254).optional().describe('Only people whose name or email contains this, ignoring case for the letters A to Z.'),
    }),
  },
  responses: { 200: { description: 'People', ...json(page(PersonSchema)) }, default: problemResponse },
});

export const createPersonRoute = createRoute({
  ...adminRoute,
  method: 'post',
  path: '/api/v1/admin/people',
  operationId: 'createPerson',
  summary: 'Create an account and email a link that lasts seven days to choose a password. 409 if the address has an account.',
  request: { body: { required: true, ...json(z.strictObject({ name: SafeName, email: Email })) } },
  responses: { 201: { description: 'Created', ...json(PersonSchema) }, default: problemResponse },
});

export const updatePersonRoute = createRoute({
  ...adminRoute,
  method: 'patch',
  path: '/api/v1/admin/people/{userId}',
  operationId: 'updatePerson',
  summary: 'Grant or take away installation admin. The installation must keep one active admin.',
  request: { params: personParams, body: { required: true, ...json(z.strictObject({ isInstallationAdmin: z.boolean() })) } },
  responses: { 200: { description: 'Updated', ...json(PersonSchema) }, default: problemResponse },
});

export const deactivatePersonRoute = createRoute({
  ...adminRoute,
  method: 'post',
  path: '/api/v1/admin/people/{userId}/deactivate',
  operationId: 'deactivatePerson',
  summary: 'End all access, keeping the account and its memberships. Refused for yourself.',
  request: { params: personParams },
  responses: { 200: { description: 'Deactivated', ...json(PersonSchema) }, default: problemResponse },
});

export const reactivatePersonRoute = createRoute({
  ...adminRoute,
  method: 'post',
  path: '/api/v1/admin/people/{userId}/reactivate',
  operationId: 'reactivatePerson',
  summary: 'Restore a deactivated account, with its password and memberships as they were.',
  request: { params: personParams },
  responses: { 200: { description: 'Reactivated', ...json(PersonSchema) }, default: problemResponse },
});

export const assignPersonRoute = createRoute({
  ...adminRoute,
  method: 'put',
  path: '/api/v1/admin/people/{userId}/workspaces/{workspaceId}',
  operationId: 'assignPerson',
  summary: 'Put someone in a workspace with a role, or change their role there. Brings back a removed or suspended member. An admin who adds themselves can then read the workspace, and this is audited.',
  request: { params: personWorkspaceParams, body: { required: true, ...json(z.strictObject({ role: RoleSchema })) } },
  responses: { 200: { description: 'Assigned', ...json(PersonSchema) }, default: problemResponse },
});

export const unassignPersonRoute = createRoute({
  ...adminRoute,
  method: 'delete',
  path: '/api/v1/admin/people/{userId}/workspaces/{workspaceId}',
  operationId: 'unassignPerson',
  summary: 'Remove someone from a workspace. Their messages keep their name.',
  request: { params: personWorkspaceParams },
  responses: { 200: { description: 'Removed', ...json(PersonSchema) }, default: problemResponse },
});

export const listAdminWorkspacesRoute = createRoute({
  ...adminRoute,
  method: 'get',
  path: '/api/v1/admin/workspaces',
  operationId: 'listAdminWorkspaces',
  summary: 'List every workspace by name. Gives no access to its conversations.',
  request: { query: PaginationQuery },
  responses: { 200: { description: 'Workspaces', ...json(page(AdminWorkspaceSchema)) }, default: problemResponse },
});

export const createWorkspaceRoute = createRoute({
  ...adminRoute,
  method: 'post',
  path: '/api/v1/admin/workspaces',
  operationId: 'createWorkspace',
  summary: 'Create a workspace. Nobody joins it by creating it, so assign people to it afterwards.',
  request: { body: { required: true, ...json(z.strictObject({ name: SafeName })) } },
  responses: { 201: { description: 'Created', ...json(WorkspaceSchema) }, default: problemResponse },
});

export const updateWorkspaceRoute = createRoute({
  ...adminRoute,
  method: 'patch',
  path: '/api/v1/admin/workspaces/{workspaceId}',
  operationId: 'updateWorkspace',
  summary: 'Update workspace settings',
  request: { params: workspaceParams, body: { required: true, ...json(z.strictObject({ name: SafeName.optional() })) } },
  responses: { 200: { description: 'Updated', ...json(WorkspaceSchema) }, default: problemResponse },
});

export const listAdminWebsitesRoute = createRoute({
  ...adminRoute,
  method: 'get',
  path: '/api/v1/admin/workspaces/{workspaceId}/websites',
  operationId: 'listAdminWebsites',
  summary: 'List the websites of any workspace, without being a member of it',
  request: { params: workspaceParams },
  responses: { 200: { description: 'Websites', ...json(z.object({ data: z.array(WebsiteSchema) })) }, default: problemResponse },
});

export const createWebsiteRoute = createRoute({
  ...adminRoute,
  method: 'post',
  path: '/api/v1/admin/workspaces/{workspaceId}/websites',
  operationId: 'createWebsite',
  summary: 'Register a website and obtain its public key',
  request: { params: workspaceParams, body: { required: true, ...json(z.strictObject({ name: SafeName, ...websiteFields })) } },
  responses: { 201: { description: 'Created', ...json(WebsiteSchema) }, default: problemResponse },
});

export const updateWebsiteRoute = createRoute({
  ...adminRoute,
  method: 'patch',
  path: '/api/v1/admin/workspaces/{workspaceId}/websites/{websiteId}',
  operationId: 'updateWebsite',
  summary: 'Update a website',
  request: {
    params: websiteParams,
    body: { required: true, ...json(z.strictObject({ name: SafeName.optional(), allowedOrigins: websiteFields.allowedOrigins.optional(), settings: websiteFields.settings })) },
  },
  responses: { 200: { description: 'Updated', ...json(WebsiteSchema) }, default: problemResponse },
});

export const RelayStatusSchema = z
  .object({
    state: z.enum(['not_configured', 'connected', 'disconnected']).openapi({
      description: 'not_configured: no relay in this deployment. disconnected: an admin disconnected from the configured relay, which erased what it held, and push is off.',
    }),
    relay: z.object({ id: z.string(), url: z.string() }).nullable(),
    /** Whether the relay has accepted this installation. It registers when a phone first asks for push. */
    registered: z.boolean(),
    subscriptions: z.number().int().openapi({ description: 'Phones registered for push, across every workspace.' }),
  })
  .openapi('RelayStatus');

export const getRelayStatusRoute = createRoute({
  ...adminRoute,
  method: 'get',
  path: '/api/v1/admin/push',
  operationId: 'getRelayStatus',
  summary: 'The notification relay this installation uses, and whether push is on',
  responses: { 200: { description: 'Relay status', ...json(RelayStatusSchema) }, default: problemResponse },
});

export const disconnectRelayRoute = createRoute({
  ...adminRoute,
  method: 'post',
  path: '/api/v1/admin/push/disconnect',
  operationId: 'disconnectRelay',
  summary: 'Turn push off, and have the relay erase everything it holds about this installation. Push stays off until reconnected.',
  description: 'Repeat it if it answers 503: push is already off, and only the erasure at the relay is left.',
  responses: { 200: { description: 'Disconnected, and erased at the relay', ...json(RelayStatusSchema) }, default: problemResponse },
});

export const reconnectRelayRoute = createRoute({
  ...adminRoute,
  method: 'post',
  path: '/api/v1/admin/push/reconnect',
  operationId: 'reconnectRelay',
  summary: 'Turn push back on. Phones register again the next time the app starts.',
  responses: { 200: { description: 'Reconnected', ...json(RelayStatusSchema) }, default: problemResponse },
});

export const FailedJobSchema = z
  .object({
    id: z.string(),
    jobType: z.string(),
    queue: z.string(),
    workspace: z.object({ id: z.string(), name: z.string() }).nullable().openapi({ description: 'Null for an installation job, or one whose workspace is gone.' }),
    attempts: z.number().int(),
    failedAt: z.iso.datetime(),
    replayedAt: z.iso.datetime().nullable(),
    replayable: z.boolean().openapi({ description: 'False once replayed, past the time the job had to run by, or when this Worker has nowhere to send it.' }),
  })
  .openapi('FailedJob');

const failedJobParams = z.object({ failedJobId: z.string() });

export const listFailedJobsRoute = createRoute({
  ...adminRoute,
  method: 'get',
  path: '/api/v1/admin/failed-jobs',
  operationId: 'listFailedJobs',
  summary: 'Background jobs that failed for good, newest first. Shows no job contents.',
  request: { query: PaginationQuery },
  responses: { 200: { description: 'Failed jobs', ...json(page(FailedJobSchema)) }, default: problemResponse },
});

export const replayFailedJobRoute = createRoute({
  ...adminRoute,
  method: 'post',
  path: '/api/v1/admin/failed-jobs/{failedJobId}/replay',
  operationId: 'replayFailedJob',
  summary: 'Queue a failed job again, with the same idempotency key, so that work already done is not repeated. Each record replays once; a job that fails again is recorded anew.',
  request: { params: failedJobParams },
  responses: { 200: { description: 'Queued again', ...json(FailedJobSchema) }, default: problemResponse },
});

export const dismissFailedJobRoute = createRoute({
  ...adminRoute,
  method: 'delete',
  path: '/api/v1/admin/failed-jobs/{failedJobId}',
  operationId: 'dismissFailedJob',
  summary: 'Delete the record of a failed job',
  request: { params: failedJobParams },
  responses: { 204: { description: 'Dismissed' }, default: problemResponse },
});

export const RetentionSchema = z
  .object({
    retentionDays: z.number().int().min(30).max(3650).nullable().openapi({
      description: 'Resolved and archived conversations whose last message is older than this many days are deleted, with their messages and files, by an hourly sweep. Contacts left with no conversations, and not seen for as long, go too. Null keeps everything.',
    }),
  })
  .openapi('Retention');

export const getRetentionRoute = createRoute({
  ...adminRoute,
  method: 'get',
  path: '/api/v1/admin/workspaces/{workspaceId}/retention',
  operationId: 'getRetention',
  summary: 'How long a workspace keeps closed conversations',
  request: { params: workspaceParams },
  responses: { 200: { description: 'Retention', ...json(RetentionSchema) }, default: problemResponse },
});

export const setRetentionRoute = createRoute({
  ...adminRoute,
  method: 'put',
  path: '/api/v1/admin/workspaces/{workspaceId}/retention',
  operationId: 'setRetention',
  summary: 'Set how long a workspace keeps closed conversations. Deletion starts within the hour and cannot be undone.',
  request: { params: workspaceParams, body: { required: true, ...json(RetentionSchema.strict()) } },
  responses: { 200: { description: 'Set', ...json(RetentionSchema) }, default: problemResponse },
});

export const AuditEntrySchema = z
  .object({
    id: z.string(),
    createdAt: z.iso.datetime(),
    action: z.string().openapi({ description: 'Such as person.created or contact.erased. New actions may appear.' }),
    actor: z.object({ type: z.string().openapi({ description: 'user, or system for the retention sweep.' }), id: z.string().nullable(), name: z.string().nullable() }),
    workspace: z.object({ id: z.string(), name: z.string() }).nullable().openapi({ description: 'Null for an installation action, or a workspace that is gone.' }),
    target: z
      .object({ type: z.string(), id: z.string(), name: z.string().nullable().openapi({ description: 'For a person, member, workspace, or website only. A contact is never named.' }) })
      .nullable(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .openapi('AuditEntry');

export const listAuditLogRoute = createRoute({
  ...adminRoute,
  method: 'get',
  path: '/api/v1/admin/audit-log',
  operationId: 'listAuditLog',
  summary: 'What admins, members, and the system changed, newest first. IDs and names of what was changed only, never content.',
  request: { query: PaginationQuery.extend({ workspaceId: z.string().optional() }) },
  responses: { 200: { description: 'Audit entries', ...json(page(AuditEntrySchema)) }, default: problemResponse },
});

// Operator health checks. Each answers 200 when it is ok or only a warning, and 503 when it fails, so that a
// monitor can watch the status code alone. Anyone without the operator token gets 404.
// See docs/operations/monitoring.md.

const operator = [{ operatorAuth: [] }];
const HealthStatusSchema = z.enum(['ok', 'warn', 'fail']);
/** Short codes, such as `heartbeat_stale`, for what made the status worse than ok. */
const HealthProblemsSchema = z.array(z.string());
const healthResponses = (schema: z.ZodType, name: string) => ({
  200: { description: `${name} is ok, or only warns`, ...json(schema) },
  503: { description: `${name} is failing`, ...json(schema) },
  default: problemResponse,
});

export const DatabaseHealthSchema = z
  .object({
    status: HealthStatusSchema,
    problems: HealthProblemsSchema,
    latencyMs: z.number().int(),
    sizeBytes: z.number().int().nullable(),
    sizeLimitBytes: z.number().int(),
    migration: z.string().nullable(),
  })
  .openapi('DatabaseHealth');

export const QueueHealthSchema = z
  .object({
    status: HealthStatusSchema,
    problems: HealthProblemsSchema,
    heartbeatAgeSeconds: z.number().int().nullable(),
    oldestPendingOutboxSeconds: z.number().int().nullable(),
    unreviewedFailedJobs: z.number().int(),
  })
  .openapi('QueueHealth');

export const RealtimeHealthSchema = z
  .object({ status: HealthStatusSchema, problems: HealthProblemsSchema, roundTripMs: z.number().int().nullable() })
  .openapi('RealtimeHealth');

export const NotificationHealthSchema = z
  .object({
    status: HealthStatusSchema,
    problems: HealthProblemsSchema,
    relay: z.enum(['off', 'disconnected', 'unregistered', 'ok', 'unreachable', 'rejected']),
    roundTripMs: z.number().int().nullable(),
  })
  .openapi('NotificationHealth');

const healthRoute = { method: 'get' as const, tags: ['health'], security: operator };

export const getDatabaseHealthRoute = createRoute({
  ...healthRoute,
  path: '/health/database',
  operationId: 'getDatabaseHealth',
  summary: 'Query latency, the latest migration, and size against the D1 limit.',
  responses: healthResponses(DatabaseHealthSchema, 'The database'),
});

export const getQueueHealthRoute = createRoute({
  ...healthRoute,
  path: '/health/queues',
  operationId: 'getQueueHealth',
  summary: 'Age of the last cron heartbeat to pass through the jobs queue, the oldest undispatched outbox row, and unreviewed failed jobs.',
  responses: healthResponses(QueueHealthSchema, 'Background work'),
});

export const getRealtimeHealthRoute = createRoute({
  ...healthRoute,
  path: '/health/realtime',
  operationId: 'getRealtimeHealth',
  summary: 'Round trip to a Durable Object that holds no data.',
  responses: healthResponses(RealtimeHealthSchema, 'Realtime'),
});

export const getNotificationHealthRoute = createRoute({
  ...healthRoute,
  path: '/health/notifications',
  operationId: 'getNotificationHealth',
  summary: 'Whether the relay answers and accepts this installation\'s signature. A problem here only warns: messaging works without push.',
  responses: { 200: { description: 'Push is ok, off, or only warns', ...json(NotificationHealthSchema) }, default: problemResponse },
});

// ---------- The AI assistant (ADR-0022) ----------

const assistantParams = workspaceParams.extend({ websiteId: z.string() });
const assistantSourceParams = workspaceParams.extend({ sourceId: z.string() });
const AssistantName = SafeName.max(60);
const SourceTitle = z.string().trim().min(1).max(200).regex(/^\P{Cc}*$/u, 'Must not contain control characters');
const SourceText = z.string().max(20_000);

export const AssistantSourceSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['page', 'text']),
    title: z.string(),
    url: z.string().nullable(),
    status: z.enum(['pending', 'indexing', 'ready', 'failed']),
    errorCode: z.string().nullable().openapi({ description: 'Why the last reading failed: unreachable, blocked_by_robots, not_html, empty, or too_large.' }),
    chunkCount: z.number().int(),
    pageCount: z.number().int(),
    indexedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AssistantSource');

export const AssistantSchema = z
  .object({
    available: z.boolean().openapi({ description: 'False when the installation has no Workers AI and Vectorize bindings. Sources cannot be added then.' }),
    canReply: z.boolean().openapi({ description: "True when it can also answer visitors: the assistant's queue is bound as well. It can be turned on only then." }),
    models: z.array(z.object({ id: z.string(), label: z.string() })),
    defaultModel: z.string(),
    settings: z.object({ name: z.string(), model: z.string().nullable(), enabled: z.boolean(), learn: z.boolean() }).nullable(),
    sources: z.array(AssistantSourceSchema),
    helpArticles: z
      .object({ published: z.number().int(), inUse: z.number().int().openapi({ description: 'Published articles the assistant answers from, at their current version. The rest are being read.' }) })
      .openapi({ description: "The website's published help articles, which are a source as soon as the assistant is set up (ADR-0023)." }),
    learning: z
      .object({
        autoApprove: z.boolean().openapi({ description: 'For the whole workspace: learned answers are used without waiting for approval.' }),
        pending: z.number().int(),
        approved: z.number().int(),
        rejected: z.number().int(),
      })
      .openapi({ description: "Answers learned from this website's resolved conversations, by status." }),
    limits: z.object({ sourcesPerWebsite: z.number().int(), pagesPerSource: z.number().int(), textSourceChars: z.number().int(), turnsPerConversation: z.number().int() }),
  })
  .openapi('Assistant');

export const AssistantAnswerSchema = z
  .object({
    outcome: z.enum(['answered', 'no_sources', 'unsure', 'limit_reached']),
    answer: z.string().nullable(),
    model: z.string(),
    sources: z.array(z.object({ title: z.string(), url: z.string().nullable(), excerpt: z.string(), score: z.number() })),
  })
  .openapi('AssistantAnswer');

export const getAssistantRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/assistant',
  tags: ['assistant'],
  operationId: 'getAssistant',
  summary: "A website's AI assistant: its settings and sources. For supervisors.",
  security: bearer,
  request: { params: assistantParams },
  responses: { 200: { description: 'Assistant', ...json(AssistantSchema) }, default: problemResponse },
});

export const saveAssistantSettingsRoute = createRoute({
  method: 'put',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/assistant/settings',
  tags: ['assistant'],
  operationId: 'saveAssistantSettings',
  summary: 'Name the assistant, choose its model, and turn answering visitors and learning on or off. For supervisors.',
  security: bearer,
  request: {
    params: assistantParams,
    body: {
      required: true,
      ...json(
        z.strictObject({
          name: AssistantName,
          model: z.string().max(100).nullable(),
          enabled: z.boolean().optional().openapi({ description: 'Answer visitors in conversations nobody has. Left out, it stays as it was; a new assistant starts off.' }),
          learn: z.boolean().optional().openapi({ description: 'Learn a question and answer from each resolved conversation. Left out, it stays as it was; a new assistant starts off.' }),
        }),
      ),
    },
  },
  responses: { 200: { description: 'Settings', ...json(z.object({ name: z.string(), model: z.string().nullable(), enabled: z.boolean(), learn: z.boolean() })) }, default: problemResponse },
});

export const addAssistantSourceRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/assistant/sources',
  tags: ['assistant'],
  operationId: 'addAssistantSource',
  summary: 'Add a page or text for the assistant to answer from. For supervisors.',
  description: "A page must be https and on one of the website's allowed origins. Pages it links to on the same host, under the same path, are read too, up to the installation's limit, respecting robots.txt. Reading happens in the background.",
  security: bearer,
  request: {
    params: assistantParams,
    body: {
      required: true,
      ...json(
        z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('page'), url: z.string().max(2000), title: SourceTitle.optional() }),
          z.strictObject({ kind: z.literal('text'), title: SourceTitle, content: SourceText }),
        ]),
      ),
    },
  },
  responses: { 201: { description: 'Source', ...json(AssistantSourceSchema) }, default: problemResponse },
});

export const updateAssistantSourceRoute = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{workspaceId}/assistant/sources/{sourceId}',
  tags: ['assistant'],
  operationId: 'updateAssistantSource',
  summary: 'Read a source again, or change its title or text. For supervisors.',
  description: 'An empty body reads it again. The answers it gave stay in use until the new reading is ready.',
  security: bearer,
  request: { params: assistantSourceParams, body: { required: true, ...json(z.strictObject({ title: SourceTitle.optional(), content: SourceText.optional() })) } },
  responses: { 200: { description: 'Source', ...json(AssistantSourceSchema) }, default: problemResponse },
});

export const deleteAssistantSourceRoute = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{workspaceId}/assistant/sources/{sourceId}',
  tags: ['assistant'],
  operationId: 'deleteAssistantSource',
  summary: 'Delete a source, and everything read from it. For supervisors.',
  security: bearer,
  request: { params: assistantSourceParams },
  responses: { 204: { description: 'Deleted' }, default: problemResponse },
});

export const testAssistantRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/assistant/test',
  tags: ['assistant'],
  operationId: 'testAssistant',
  summary: 'Ask the assistant a question, as a visitor would. For supervisors.',
  description: 'No visitor sees this. It counts against the daily limit on answers.',
  security: bearer,
  request: { params: assistantParams, body: { required: true, ...json(z.strictObject({ question: z.string().trim().min(1).max(1000) })) } },
  responses: { 200: { description: 'Answer', ...json(AssistantAnswerSchema) }, default: problemResponse },
});

const learnedParams = workspaceParams.extend({ learnedId: z.string() });
const LearnedText = (max: number) => z.string().trim().min(1).max(max);

export const AssistantLearnedSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    question: z.string(),
    answer: z.string(),
    status: z.enum(['pending', 'approved', 'rejected']),
    inUse: z.boolean().openapi({ description: 'Approved, and indexed, so the assistant answers from it now.' }),
    decidedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AssistantLearned');

export const listLearnedAnswersRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/assistant/learned',
  tags: ['assistant'],
  operationId: 'listLearnedAnswers',
  summary: "Questions and answers learned from the website's resolved conversations, newest first, up to 200. For supervisors.",
  security: bearer,
  request: { params: assistantParams, query: z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }) },
  responses: { 200: { description: 'Learned answers', ...json(z.object({ data: z.array(AssistantLearnedSchema) })) }, default: problemResponse },
});

export const decideLearnedAnswerRoute = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{workspaceId}/assistant/learned/{learnedId}',
  tags: ['assistant'],
  operationId: 'decideLearnedAnswer',
  summary: 'Approve a learned answer, optionally with changed words, or reject it. For supervisors.',
  description: 'An approved answer is used once it is indexed, within a minute or so. Rejecting one stops it being used.',
  security: bearer,
  request: {
    params: learnedParams,
    body: { required: true, ...json(z.strictObject({ status: z.enum(['approved', 'rejected']), question: LearnedText(300).optional(), answer: LearnedText(1200).optional() })) },
  },
  responses: { 200: { description: 'Learned answer', ...json(AssistantLearnedSchema) }, default: problemResponse },
});

export const deleteLearnedAnswerRoute = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{workspaceId}/assistant/learned/{learnedId}',
  tags: ['assistant'],
  operationId: 'deleteLearnedAnswer',
  summary: 'Delete a learned answer. For supervisors.',
  description: 'The conversation is not read again unless it gets new messages and is resolved again.',
  security: bearer,
  request: { params: learnedParams },
  responses: { 204: { description: 'Deleted' }, default: problemResponse },
});

export const setLearnedAutoApproveRoute = createRoute({
  method: 'put',
  path: '/api/v1/workspaces/{workspaceId}/assistant/learning',
  tags: ['assistant'],
  operationId: 'setLearnedAutoApprove',
  summary: "Whether learned answers are used without a supervisor's approval, for every website in the workspace. For supervisors.",
  description: 'Off by default. A change is recorded in the audit log.',
  security: bearer,
  request: { params: workspaceParams, body: { required: true, ...json(z.strictObject({ autoApprove: z.boolean() })) } },
  responses: { 200: { description: 'Setting', ...json(z.object({ autoApprove: z.boolean() })) }, default: problemResponse },
});

// ---------- Help centre (ADR-0023) ----------

const HELP_LANGUAGE = z.enum(['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh-Hans', 'zh-Hant']);
const helpCollectionParams = workspaceParams.extend({ collectionId: z.string() });
const helpArticleParams = workspaceParams.extend({ articleId: z.string() });
const helpAssetParams = workspaceParams.extend({ assetId: z.string() });
const HelpSlug = z.string().min(1).max(80).openapi({ description: 'Letters and digits in any script, joined by hyphens.' });

export const HelpCollectionSchema = z
  .object({ id: z.string(), language: z.string(), name: z.string(), slug: z.string(), position: z.number().int(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
  .openapi('HelpCollection');

const helpArticleSummaryFields = {
  id: z.string(),
  collectionId: z.string().nullable(),
  translationGroupId: z.string().openapi({ description: 'Shared by the same article in other languages.' }),
  language: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  status: z.enum(['draft', 'published']),
  position: z.number().int(),
  version: z.number().int(),
  publishedAt: z.iso.datetime().nullable(),
  aiDrafted: z.boolean().openapi({ description: 'Written by Draft with AI and not changed by a person since.' }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const HelpArticleSummarySchema = z.object(helpArticleSummaryFields).openapi('HelpArticleSummary');
export const HelpArticleSchema = z
  .object({ ...helpArticleSummaryFields, bodyMarkdown: z.string(), bodyHtml: z.string().openapi({ description: 'Rendered by the server from an allow-list. What visitors are sent.' }),
    aiSources: z.array(z.object({ title: z.string(), url: z.string().nullable() })).openapi({ description: 'For an article Draft with AI wrote: the pages (with url) and files (url null) it came from.' }),
  })
  .openapi('HelpArticle');

export const HelpAssetSchema = z
  .object({ id: z.string(), contentType: z.string(), sizeBytes: z.number().int(), filename: z.string(), url: z.string().openapi({ description: 'Where it is served, for use in Markdown: ![text](url)' }), createdAt: z.iso.datetime() })
  .openapi('HelpAsset');

export const HelpDraftRunSchema = z
  .object({
    id: z.string(),
    language: z.string(),
    collectionId: z.string().nullable(),
    readWebsite: z.boolean(),
    links: z.array(z.string()),
    files: z.array(z.object({ name: z.string(), sizeBytes: z.number().int() })),
    status: z.enum(['uploading', 'queued', 'reading', 'writing', 'done', 'failed']).openapi({ description: 'uploading takes files until it is started.' }),
    errorCode: z.string().nullable().openapi({ description: 'For failed: no_material, no_outline or timed_out.' }),
    planned: z.number().int().openapi({ description: 'Articles in the outline.' }),
    written: z.number().int(),
    failed: z.number().int().openapi({ description: 'Outlined articles the model could not write from the material.' }),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .openapi('HelpDraftRun');

export const HelpCentreSchema = z
  .object({
    websiteId: z.string(),
    websiteName: z.string(),
    slug: z.string().nullable().openapi({ description: 'The public address is /help/<slug>. Null while the help centre is off.' }),
    noindex: z.boolean(),
    languages: z.array(z.string()),
    collections: z.array(HelpCollectionSchema),
    articles: z.array(HelpArticleSummarySchema),
    assets: z.array(HelpAssetSchema),
    drafting: z.object({
      available: z.boolean().openapi({ description: 'False on an installation without Workers AI: Draft with AI is not offered.' }),
      runs: z.array(HelpDraftRunSchema).openapi({ description: 'The latest, newest first.' }),
    }),
    limits: z.object({ articlesPerWebsite: z.number().int(), titleChars: z.number().int(), summaryChars: z.number().int(), bodyChars: z.number().int(), collectionNameChars: z.number().int(), assetBytes: z.number().int() }),
  })
  .openapi('HelpCentre');

export const getHelpCentreRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/help',
  tags: ['help'],
  operationId: 'getHelpCentre',
  summary: "A website's help centre: its address, collections, articles and images. For every member.",
  security: bearer,
  request: { params: websiteParams },
  responses: { 200: { description: 'Help centre', ...json(HelpCentreSchema) }, default: problemResponse },
});

export const saveHelpSettingsRoute = createRoute({
  method: 'put',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/help/settings',
  tags: ['help'],
  operationId: 'saveHelpSettings',
  summary: 'Turn the public help centre on with an address, move it, or turn it off. For supervisors.',
  description: 'A change of address is recorded in the audit log.',
  security: bearer,
  request: {
    params: websiteParams,
    body: {
      required: true,
      ...json(
        z.strictObject({
          slug: z.string().max(50).nullable().openapi({ description: 'Lower-case letters, digits and hyphens. Null turns the public help centre off.' }),
          noindex: z.boolean().optional().openapi({ description: 'Ask search engines not to list it. Left out, it stays as it was.' }),
        }),
      ),
    },
  },
  responses: { 200: { description: 'Settings', ...json(z.object({ slug: z.string().nullable(), noindex: z.boolean() })) }, default: problemResponse },
});

export const createHelpCollectionRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/help/collections',
  tags: ['help'],
  operationId: 'createHelpCollection',
  summary: 'Add a collection of articles, in one language. For supervisors.',
  security: bearer,
  request: { params: websiteParams, body: { required: true, ...json(z.strictObject({ language: HELP_LANGUAGE, name: z.string().min(1).max(100) })) } },
  responses: { 201: { description: 'Collection', ...json(HelpCollectionSchema) }, default: problemResponse },
});

export const updateHelpCollectionRoute = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{workspaceId}/help/collections/{collectionId}',
  tags: ['help'],
  operationId: 'updateHelpCollection',
  summary: 'Rename or move a collection. For supervisors.',
  security: bearer,
  request: {
    params: helpCollectionParams,
    body: { required: true, ...json(z.strictObject({ name: z.string().min(1).max(100).optional(), slug: HelpSlug.optional(), position: z.number().int().min(0).max(10_000).optional() })) },
  },
  responses: { 200: { description: 'Collection', ...json(HelpCollectionSchema) }, default: problemResponse },
});

export const deleteHelpCollectionRoute = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{workspaceId}/help/collections/{collectionId}',
  tags: ['help'],
  operationId: 'deleteHelpCollection',
  summary: 'Delete a collection. Its articles stay, outside any collection. For supervisors.',
  security: bearer,
  request: { params: helpCollectionParams },
  responses: { 204: { description: 'Deleted' }, default: problemResponse },
});

export const createHelpArticleRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/help/articles',
  tags: ['help'],
  operationId: 'createHelpArticle',
  summary: 'Write an article, as a draft. For supervisors.',
  security: bearer,
  request: {
    params: websiteParams,
    body: {
      required: true,
      ...json(
        z.strictObject({
          language: HELP_LANGUAGE,
          title: z.string().min(1).max(200),
          summary: z.string().max(500).optional(),
          bodyMarkdown: z.string().max(20_000).optional().openapi({ description: 'Markdown: headings, paragraphs, bold, italic, lists, links, code, quotes and images. No HTML.' }),
          collectionId: z.string().nullable().optional(),
          translationOf: z.string().optional().openapi({ description: 'An article this one translates. They are then offered as each other in other languages.' }),
        }),
      ),
    },
  },
  responses: { 201: { description: 'Article', ...json(HelpArticleSchema) }, default: problemResponse },
});

export const getHelpArticleRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{workspaceId}/help/articles/{articleId}',
  tags: ['help'],
  operationId: 'getHelpArticle',
  summary: 'An article, with its Markdown. For every member.',
  security: bearer,
  request: { params: helpArticleParams },
  responses: { 200: { description: 'Article', ...json(HelpArticleSchema) }, default: problemResponse },
});

export const updateHelpArticleRoute = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{workspaceId}/help/articles/{articleId}',
  tags: ['help'],
  operationId: 'updateHelpArticle',
  summary: 'Change an article. For supervisors.',
  description: 'A published article changes for visitors at once.',
  security: bearer,
  request: {
    params: helpArticleParams,
    body: {
      required: true,
      ...json(
        z.strictObject({
          expectedVersion: z.number().int(),
          title: z.string().min(1).max(200).optional(),
          summary: z.string().max(500).optional(),
          bodyMarkdown: z.string().max(20_000).optional(),
          slug: HelpSlug.optional(),
          collectionId: z.string().nullable().optional(),
          position: z.number().int().min(0).max(100_000).optional(),
        }),
      ),
    },
  },
  responses: { 200: { description: 'Article', ...json(HelpArticleSchema) }, default: problemResponse },
});

export const setHelpArticleStatusRoute = createRoute({
  method: 'put',
  path: '/api/v1/workspaces/{workspaceId}/help/articles/{articleId}/status',
  tags: ['help'],
  operationId: 'setHelpArticleStatus',
  summary: 'Publish an article, or take it back to a draft. For supervisors.',
  description: 'Recorded in the audit log.',
  security: bearer,
  request: { params: helpArticleParams, body: { required: true, ...json(z.strictObject({ status: z.enum(['draft', 'published']) })) } },
  responses: { 200: { description: 'Article', ...json(HelpArticleSchema) }, default: problemResponse },
});

export const deleteHelpArticleRoute = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{workspaceId}/help/articles/{articleId}',
  tags: ['help'],
  operationId: 'deleteHelpArticle',
  summary: 'Delete an article. For supervisors.',
  description: 'Recorded in the audit log.',
  security: bearer,
  request: { params: helpArticleParams },
  responses: { 204: { description: 'Deleted' }, default: problemResponse },
});

export const uploadHelpAssetRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/help/assets',
  tags: ['help'],
  operationId: 'uploadHelpAsset',
  summary: 'Upload an image for articles: PNG, JPEG, GIF or WebP, up to 5 MB. For supervisors.',
  description: 'The body is the image, with its type in Content-Type and its size in Content-Length. It is public at its url, which cannot be guessed.',
  security: bearer,
  request: { params: websiteParams, query: FilenameQuery, body: BinaryBody },
  responses: { 201: { description: 'Stored', ...json(HelpAssetSchema) }, default: problemResponse },
});

export const deleteHelpAssetRoute = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{workspaceId}/help/assets/{assetId}',
  tags: ['help'],
  operationId: 'deleteHelpAsset',
  summary: 'Delete an image. Articles that show it show nothing there. For supervisors.',
  security: bearer,
  request: { params: helpAssetParams },
  responses: { 204: { description: 'Deleted' }, default: problemResponse },
});

const helpDraftParams = workspaceParams.extend({ runId: z.string() });

export const createHelpDraftRunRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/websites/{websiteId}/help/drafts',
  tags: ['help'],
  operationId: 'createHelpDraftRun',
  summary: 'Begin a Draft with AI: the website, links on it, or files, in one language. For supervisors.',
  description:
    'Links must be https, on the host of one of the website\'s allowed origins. The run takes files (uploadHelpDraftFile) until it is started (startHelpDraftRun). One run at a time per website, and a daily limit per workspace (429 draft_limit_reached). 409 drafting_unavailable on an installation without Workers AI.',
  security: bearer,
  request: {
    params: websiteParams,
    body: {
      required: true,
      ...json(
        z.strictObject({
          language: HELP_LANGUAGE,
          collectionId: z.string().nullable().optional().openapi({ description: 'All its articles go in this collection. Otherwise the model groups them, in collections it finds or makes.' }),
          readWebsite: z.boolean().optional().openapi({ description: "Read the website from its first allowed origin, following links, as the assistant does." }),
          links: z.array(z.string().max(2000)).max(10).optional(),
        }),
      ),
    },
  },
  responses: { 201: { description: 'Run', ...json(HelpDraftRunSchema) }, default: problemResponse },
});

export const uploadHelpDraftFileRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/help/drafts/{runId}/files',
  tags: ['help'],
  operationId: 'uploadHelpDraftFile',
  summary: 'Add a file to a Draft with AI before it starts: PDF, Word, OpenDocument, HTML, Markdown or text, up to 10 MB. For supervisors.',
  description: 'The body is the file, with its size in Content-Length; its kind is told by the extension in filename and checked against its first bytes. At most 10. It is deleted when the run ends.',
  security: bearer,
  request: { params: helpDraftParams, query: FilenameQuery, body: BinaryBody },
  responses: { 201: { description: 'Run', ...json(HelpDraftRunSchema) }, default: problemResponse },
});

export const startHelpDraftRunRoute = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{workspaceId}/help/drafts/{runId}/start',
  tags: ['help'],
  operationId: 'startHelpDraftRun',
  summary: 'Start a Draft with AI. Its articles appear as drafts as they are written. For supervisors.',
  security: bearer,
  request: { params: helpDraftParams },
  responses: { 200: { description: 'Run', ...json(HelpDraftRunSchema) }, default: problemResponse },
});

// ---------- The widget's Help tab (ADR-0023, step 3) ----------

const WidgetHelpArticleSummarySchema = z.object({ id: z.string(), title: z.string(), summary: z.string(), collectionId: z.string().nullable() }).openapi('WidgetHelpArticleSummary');

export const WidgetHelpSchema = z
  .object({
    language: z.string().nullable().openapi({ description: 'The language shown: the one asked for if it has articles, else English, else the language with most. Null if there are none.' }),
    collections: z.array(z.object({ id: z.string(), name: z.string() })).openapi({ description: 'Empty for search results.' }),
    articles: z.array(WidgetHelpArticleSummarySchema),
  })
  .openapi('WidgetHelp');

export const WidgetHelpArticleSchema = z
  .object({
    id: z.string(),
    language: z.string(),
    title: z.string(),
    summary: z.string(),
    bodyHtml: z.string().openapi({ description: "Rendered on save from an allow-list. Images and help-centre links are absolute, on the installation's address." }),
    url: z.string().nullable().openapi({ description: 'The article on the public help centre, if the website has one.' }),
  })
  .openapi('WidgetHelpArticle');

export const widgetHelpRoute = createRoute({
  method: 'get',
  path: '/api/v1/widget/help',
  tags: ['widget'],
  operationId: 'widgetHelp',
  summary: "A website's published help articles in a language, or those matching a search. No session needed; the Origin must be allowed.",
  security: [],
  request: { query: z.object({ websiteKey: z.string().max(128), language: z.string().max(16).optional(), q: z.string().max(200).optional() }) },
  responses: { 200: { description: 'Articles', ...json(WidgetHelpSchema) }, default: problemResponse },
});

export const widgetHelpArticleRoute = createRoute({
  method: 'get',
  path: '/api/v1/widget/help/articles/{articleId}',
  tags: ['widget'],
  operationId: 'widgetHelpArticle',
  summary: 'One published help article, to read in the widget. No session needed; the Origin must be allowed.',
  security: [],
  request: { params: z.object({ articleId: z.string() }), query: z.object({ websiteKey: z.string().max(128) }) },
  responses: { 200: { description: 'Article', ...json(WidgetHelpArticleSchema) }, default: problemResponse },
});
