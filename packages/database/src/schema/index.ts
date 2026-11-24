/**
 * The installation database. Rationale: docs/architecture/data-model.md.
 *
 * Conventions
 *  - IDs are TEXT, `<prefix>_<26 chars>`. Timestamps are INTEGER milliseconds UTC.
 *  - Every workspace-owned table has workspace_id, and child tables reference parents by
 *    (workspace_id, id) so that a cross-tenant reference cannot be stored at all.
 *  - No ON DELETE SET NULL on composite keys: it would also null workspace_id.
 *  - JSON lives in TEXT columns suffixed _json, validated by Zod at the application boundary.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const nocase = customType<{ data: string }>({ dataType: () => 'text COLLATE NOCASE' });
const json = (name: string) => text(name).notNull().default('{}');
const ts = (name: string) => integer(name).notNull();

// ---------- Installation scope (deliberately no workspace_id) ----------

export const installation = sqliteTable(
  'installation',
  {
    id: text('id').primaryKey(),
    singleton: integer('singleton').notNull().default(1).unique(),
    name: text('name').notNull(),
    publicBaseUrl: text('public_base_url').notNull(),
    /** The relay that has accepted this installation. Compared with the configured one, so that a change registers again. */
    relayRegisteredId: text('relay_registered_id'),
    /**
     * The relay an installation admin disconnected from, which erased what it held. While it is still the configured
     * one, push is off, so that a phone asking for a grant does not quietly register the installation again.
     */
    relayDisconnectedId: text('relay_disconnected_id'),
    signupPolicy: text('signup_policy', { enum: ['invite_only', 'open'] }).notNull().default('invite_only'),
    systemEmailEnc: text('system_email_enc'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    check('installation_singleton_ck', sql`${t.singleton} = 1`),
    check('installation_signup_ck', sql`${t.signupPolicy} IN ('invite_only','open')`),
  ],
);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: nocase('email').notNull().unique(),
  name: text('name').notNull(),
  /** PHC string, so that parameters can be upgraded per hash. */
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: integer('email_verified_at'),
  /** Set while the account is deactivated. It can be cleared again, and nothing else about the account changes. */
  disabledAt: integer('disabled_at'),
  /** Manages people across the installation. Reading a workspace still needs a membership. See ADR-0015. */
  isInstallationAdmin: integer('is_installation_admin', { mode: 'boolean' }).notNull().default(false),
  /** The language they read, one of the dashboard's (ADR-0024). The same in every workspace. NULL until a client sets it. */
  language: text('language'),
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
});

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    /** Presenting this hash again means a token was stolen, and revokes the session. */
    previousTokenHash: text('previous_token_hash'),
    clientType: text('client_type', { enum: ['dashboard', 'mobile'] }).notNull(),
    clientLabel: text('client_label'),
    createdAt: ts('created_at'),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    revokedAt: integer('revoked_at'),
  },
  (t) => [
    index('auth_sessions_user_idx').on(t.userId, t.revokedAt),
    index('auth_sessions_expiry_idx').on(t.expiresAt),
    check('auth_sessions_client_ck', sql`${t.clientType} IN ('dashboard','mobile')`),
  ],
);

export const authTokens = sqliteTable(
  'auth_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['password_reset', 'email_verification'] }).notNull(),
    expiresAt: ts('expires_at'),
    consumedAt: integer('consumed_at'),
    /** A fresh ID per attempt. Later statements in a batch check this rather than repeating the decision. */
    consumedBy: text('consumed_by'),
  },
  (t) => [
    index('auth_tokens_expiry_idx').on(t.expiresAt),
    // Foreign-key lookups: a cascade from the parent scans the whole table without these.
    index('auth_tokens_user_idx').on(t.userId),
    check('auth_tokens_purpose_ck', sql`${t.purpose} IN ('password_reset','email_verification')`),
  ],
);

// ---------- Workspace, membership ----------

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    settingsJson: json('settings_json'),
    relayWorkspaceStatus: text('relay_workspace_status', { enum: ['unregistered', 'registered', 'revoked'] })
      .notNull()
      .default('unregistered'),
    /** Closed conversations older than this, by their last message, are deleted. NULL keeps them. */
    retentionDays: integer('retention_days'),
    /** The AI assistant uses what it learns without waiting for a supervisor's approval (ADR-0022). Off by default. */
    assistantAutoApprove: integer('assistant_auto_approve', { mode: 'boolean' }).notNull().default(false),
    /** Visitors' messages are translated for members (ADR-0024). Off by default; supervisors turn it on. */
    translationEnabled: integer('translation_enabled', { mode: 'boolean' }).notNull().default(false),
    /** The model for visitors' messages. NULL is the default, m2m100. */
    translationModel: text('translation_model'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [check('workspaces_relay_ck', sql`${t.relayWorkspaceStatus} IN ('unregistered','registered','revoked')`)],
);

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    /** Doubles as the relay recipientId, so that no user ID or email leaves the installation. */
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** No cascade: users are anonymised, never hard-deleted. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['owner', 'admin', 'supervisor', 'agent'] }).notNull(),
    status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
    /** Removed members keep this row, with status 'suspended', so that their messages keep a name. See ADR-0015. */
    removedAt: integer('removed_at'),
    /** Set by the member. While it is, they do not make the widget say the team is online. */
    away: integer('away', { mode: 'boolean' }).notNull().default(false),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('workspace_members_tenant_uq').on(t.workspaceId, t.id),
    unique('workspace_members_user_uq').on(t.workspaceId, t.userId),
    index('workspace_members_user_idx').on(t.userId, t.status),
    check('workspace_members_role_ck', sql`${t.role} IN ('owner','admin','supervisor','agent')`),
    check('workspace_members_status_ck', sql`${t.status} IN ('active','suspended')`),
  ],
);

export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: nocase('email').notNull(),
    role: text('role', { enum: ['admin', 'supervisor', 'agent'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedByMemberId: text('invited_by_member_id').notNull(),
    expiresAt: ts('expires_at'),
    acceptedAt: integer('accepted_at'),
    createdAt: ts('created_at'),
  },
  (t) => [
    unique('invitations_tenant_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'invitations_inviter_fk',
      columns: [t.workspaceId, t.invitedByMemberId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.id],
    }).onDelete('cascade'),
    check('invitations_role_ck', sql`${t.role} IN ('admin','supervisor','agent')`),
    index('invitations_inviter_idx').on(t.workspaceId, t.invitedByMemberId),
  ],
);

// ---------- Websites, visitors, contacts ----------

export const websites = sqliteTable(
  'websites',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** A public identifier embedded in page source. Not a credential. */
    websiteKey: text('website_key').notNull().unique(),
    allowedOriginsJson: text('allowed_origins_json').notNull().default('[]'),
    settingsJson: json('settings_json'),
    /** The help centre's address, /help/<slug> (ADR-0023). NULL until a supervisor turns it on. */
    helpSlug: text('help_slug'),
    /** Bumped by every change visitors could see, so cached help pages are never served stale. */
    helpVersion: integer('help_version').notNull().default(1),
    helpNoindex: integer('help_noindex', { mode: 'boolean' }).notNull().default(false),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [unique('websites_tenant_uq').on(t.workspaceId, t.id), uniqueIndex('websites_help_slug_uq').on(t.helpSlug).where(sql`${t.helpSlug} IS NOT NULL`)],
);

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name'),
    email: nocase('email'),
    phone: text('phone'),
    attributesJson: json('attributes_json'),
    /** NULL means no consent recorded. */
    followUpConsentAt: integer('follow_up_consent_at'),
    followUpConsentSource: text('follow_up_consent_source'),
    mergedIntoContactId: text('merged_into_contact_id'),
    firstSeenAt: ts('first_seen_at'),
    lastSeenAt: ts('last_seen_at'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('contacts_tenant_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'contacts_merged_fk',
      columns: [t.workspaceId, t.mergedIntoContactId],
      foreignColumns: [t.workspaceId, t.id],
    }),
    index('contacts_email_idx').on(t.workspaceId, t.email).where(sql`${t.email} IS NOT NULL`),
    index('contacts_list_idx').on(t.workspaceId, sql`${t.lastSeenAt} DESC`, sql`${t.id} DESC`),
    // For the retention sweep, across workspaces.
    index('contacts_stale_idx').on(t.lastSeenAt),
    index('contacts_merged_idx').on(t.workspaceId, t.mergedIntoContactId).where(sql`${t.mergedIntoContactId} IS NOT NULL`),
  ],
);

/** A contact can be many browsers and devices. Merging contacts only repoints visitors. */
export const visitors = sqliteTable(
  'visitors',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    contactId: text('contact_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    createdAt: ts('created_at'),
    lastSeenAt: ts('last_seen_at'),
  },
  (t) => [
    unique('visitors_tenant_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'visitors_website_fk',
      columns: [t.workspaceId, t.websiteId],
      foreignColumns: [websites.workspaceId, websites.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'visitors_contact_fk',
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete('cascade'),
    index('visitors_contact_idx').on(t.workspaceId, t.contactId),
    index('visitors_stale_idx').on(t.lastSeenAt),
    index('visitors_website_idx').on(t.workspaceId, t.websiteId),
  ],
);

// ---------- Conversations, messages ----------

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    websiteId: text('website_id').notNull(),
    contactId: text('contact_id').notNull(),
    assignedMemberId: text('assigned_member_id'),
    status: text('status', { enum: ['open', 'pending', 'resolved', 'archived'] }).notNull().default('open'),
    priority: text('priority', { enum: ['low', 'normal', 'high', 'urgent'] }).notNull().default('normal'),
    subject: text('subject'),
    lastMessageSeq: integer('last_message_seq').notNull().default(0),
    /** The gapless sequence shown to visitors. */
    lastPublicSeq: integer('last_public_seq').notNull().default(0),
    lastMessageAt: integer('last_message_at'),
    lastVisitorMessageAt: integer('last_visitor_message_at'),
    lastAgentMessageAt: integer('last_agent_message_at'),
    /** Cron work-list. See docs/architecture/background-jobs.md. */
    nextAutomationAt: integer('next_automation_at'),
    /** No longer written, since members are not emailed (amendment A15). A later contract migration drops it. */
    nextUnansweredAlertAt: integer('next_unanswered_alert_at'),
    /** Optimistic concurrency token. */
    version: integer('version').notNull().default(1),
    /** Guards follow-up statements in a batch. See data-model.md, Pattern 2. */
    lastMutationId: text('last_mutation_id'),
    /**
     * The AI assistant here (ADR-0022): NULL until it or a member acts, 'answering', 'handed_over', or 'stopped'.
     * Added with ALTER TABLE, so its CHECK is in migration 0017 and not declared below: declaring it would make
     * Drizzle rebuild this table, which D1 cannot do in time on a large installation.
     */
    assistantState: text('assistant_state', { enum: ['answering', 'handed_over', 'stopped'] }),
    /** The help article the visitor was reading when they started it (ADR-0023). Kept if the article goes. */
    helpArticleId: text('help_article_id'),
    /**
     * The visitor's language (ADR-0024), a BCP 47 tag: the widget's, or the browser's when the widget does not speak
     * it. The first one sent is kept; a supervisor can correct it.
     */
    visitorLanguage: text('visitor_language'),
    /** The page the visitor is on now, without its query or fragment. The current one only: each report replaces the last. */
    visitorPageUrl: text('visitor_page_url'),
    visitorPageAt: integer('visitor_page_at'),
    /**
     * What the visitor said of a resolved conversation: 'good' or 'bad', a comment if they left one, and when. One per
     * conversation: a new rating replaces the last. Its CHECK is in migration 0030, as for assistant_state above.
     */
    visitorRating: text('visitor_rating', { enum: ['good', 'bad'] }),
    visitorRatingComment: text('visitor_rating_comment'),
    visitorRatedAt: integer('visitor_rated_at'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('conversations_tenant_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'conversations_website_fk',
      columns: [t.workspaceId, t.websiteId],
      foreignColumns: [websites.workspaceId, websites.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'conversations_contact_fk',
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'conversations_assignee_fk',
      columns: [t.workspaceId, t.assignedMemberId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.id],
    }),
    index('conversations_inbox_idx').on(t.workspaceId, t.status, sql`${t.lastMessageAt} DESC`, sql`${t.id} DESC`),
    index('conversations_assignee_idx').on(
      t.workspaceId,
      t.assignedMemberId,
      t.status,
      sql`${t.lastMessageAt} DESC`,
      sql`${t.id} DESC`,
    ),
    index('conversations_contact_idx').on(t.workspaceId, t.contactId, sql`${t.lastMessageAt} DESC`),
    index('conversations_automation_idx').on(t.nextAutomationAt).where(sql`${t.nextAutomationAt} IS NOT NULL`),
    index('conversations_unanswered_idx').on(t.nextUnansweredAlertAt).where(sql`${t.nextUnansweredAlertAt} IS NOT NULL`),
    index('conversations_updated_idx').on(t.workspaceId, t.updatedAt, t.id),
    index('conversations_website_idx').on(t.workspaceId, t.websiteId),
    // For the Analytics page, which reads the conversations started in a period.
    index('conversations_created_idx').on(t.workspaceId, t.createdAt),
    check('conversations_status_ck', sql`${t.status} IN ('open','pending','resolved','archived')`),
    check('conversations_priority_ck', sql`${t.priority} IN ('low','normal','high','urgent')`),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    /** All messages, used by agents. */
    seq: integer('seq').notNull(),
    /** Visitors see this as their seq. Notes do not consume it, so gaps cannot reveal them. */
    publicSeq: integer('public_seq'),
    /** Idempotency key supplied by the client. */
    clientMessageId: text('client_message_id'),
    senderType: text('sender_type', { enum: ['visitor', 'member', 'system'] }).notNull(),
    senderId: text('sender_id'),
    messageType: text('message_type', { enum: ['text', 'image', 'file', 'system', 'internal_note'] }).notNull(),
    /** Stored rather than derived so that every visitor-facing query can filter on it directly. */
    visibility: text('visibility', { enum: ['public', 'internal'] }).notNull(),
    content: text('content').notNull().default(''),
    metadataJson: json('metadata_json'),
    createdAt: ts('created_at'),
    /**
     * Set when the AI assistant wrote it (ADR-0022), with sender_type 'system'. A CHECK in migration 0017 holds
     * that; it is not declared here, for the reason given on conversations.assistant_state.
     */
    assistantId: text('assistant_id'),
    /**
     * Set when a member wrote this in another language and it was sent translated (ADR-0024): `content` is what the
     * visitor received, and what they wrote is its translation in this language.
     */
    originalLanguage: text('original_language'),
  },
  (t) => [
    unique('messages_tenant_uq').on(t.workspaceId, t.id),
    unique('messages_seq_uq').on(t.workspaceId, t.conversationId, t.seq),
    unique('messages_public_seq_uq').on(t.workspaceId, t.conversationId, t.publicSeq),
    unique('messages_client_uq').on(t.workspaceId, t.conversationId, t.clientMessageId),
    /** The assistant's answers and handovers, newest first, for the list of questions it could not answer. */
    index('messages_assistant_idx').on(t.workspaceId, t.createdAt).where(sql`${t.assistantId} IS NOT NULL`),
    foreignKey({
      name: 'messages_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    check('messages_sender_ck', sql`${t.senderType} IN ('visitor','member','system')`),
    check('messages_type_ck', sql`${t.messageType} IN ('text','image','file','system','internal_note')`),
    check('messages_visibility_ck', sql`${t.visibility} IN ('public','internal')`),
    check('messages_note_visibility_ck', sql`(${t.messageType} = 'internal_note') = (${t.visibility} = 'internal')`),
    check('messages_public_seq_ck', sql`(${t.visibility} = 'public') = (${t.publicSeq} IS NOT NULL)`),
    check('messages_note_sender_ck', sql`${t.messageType} <> 'internal_note' OR ${t.senderType} = 'member'`),
  ],
);

/**
 * Machine translations of messages (ADR-0024), one per message and language. They go with their message, so erasure
 * and retention need nothing more. Members read them; visitors never do.
 */
export const messageTranslations = sqliteTable(
  'message_translations',
  {
    workspaceId: text('workspace_id').notNull(),
    messageId: text('message_id').notNull(),
    /** A BCP 47 tag: a member's language, one of OpenChat's. */
    language: text('language').notNull(),
    content: text('content').notNull(),
    /** The Workers AI model that wrote it. */
    model: text('model').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    primaryKey({ name: 'message_translations_pk', columns: [t.workspaceId, t.messageId, t.language] }),
    foreignKey({
      name: 'message_translations_message_fk',
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.id],
    }).onDelete('cascade'),
  ],
);

/**
 * A supervisor has dealt with a question the assistant could not answer: answered it, or dismissed it. Keyed by the
 * assistant's handover message, and gone with it, so erasure and retention need nothing more.
 */
export const assistantQuestionReviews = sqliteTable(
  'assistant_question_reviews',
  {
    workspaceId: text('workspace_id').notNull(),
    messageId: text('message_id').notNull(),
    outcome: text('outcome').notNull(),
    memberId: text('member_id'),
    createdAt: ts('created_at'),
  },
  (t) => [
    primaryKey({ name: 'assistant_question_reviews_pk', columns: [t.workspaceId, t.messageId] }),
    foreignKey({
      name: 'assistant_question_reviews_message_fk',
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.id],
    }).onDelete('cascade'),
    check('assistant_question_reviews_outcome_ck', sql`${t.outcome} IN ('answered','dismissed')`),
  ],
);

/** Cursors, not one row per message and reader. For visitors they compare with public_seq. */
export const conversationReadCursors = sqliteTable(
  'conversation_read_cursors',
  {
    workspaceId: text('workspace_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    readerType: text('reader_type', { enum: ['visitor', 'member'] }).notNull(),
    readerId: text('reader_id').notNull(),
    deliveredSeq: integer('delivered_seq').notNull().default(0),
    readSeq: integer('read_seq').notNull().default(0),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.conversationId, t.readerType, t.readerId] }),
    foreignKey({
      name: 'read_cursors_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    check('read_cursors_reader_ck', sql`${t.readerType} IN ('visitor','member')`),
  ],
);

export const conversationEvents = sqliteTable(
  'conversation_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type', { enum: ['visitor', 'member', 'system'] }).notNull(),
    actorId: text('actor_id'),
    metadataJson: json('metadata_json'),
    createdAt: ts('created_at'),
  },
  (t) => [
    foreignKey({
      name: 'conversation_events_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    index('conversation_events_idx').on(t.workspaceId, t.conversationId, t.createdAt),
    check('conversation_events_actor_ck', sql`${t.actorType} IN ('visitor','member','system')`),
  ],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    /** NULL until the sending message commits. */
    messageId: text('message_id'),
    /** w/<workspace_id>/c/<conversation_id>/<id> */
    storageKey: text('storage_key').notNull().unique(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    status: text('status', { enum: ['pending', 'ready', 'rejected'] }).notNull().default('pending'),
    uploadedByType: text('uploaded_by_type', { enum: ['visitor', 'member'] }).notNull(),
    uploadedById: text('uploaded_by_id').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    unique('attachments_tenant_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'attachments_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'attachments_message_fk',
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.id],
    }),
    index('attachments_message_idx').on(t.workspaceId, t.messageId),
    // Every deleted conversation (retention, erasure) cascades here.
    index('attachments_conversation_idx').on(t.workspaceId, t.conversationId),
    index('attachments_orphan_idx').on(t.createdAt).where(sql`${t.messageId} IS NULL`),
    check('attachments_size_ck', sql`${t.size} > 0`),
    check('attachments_status_ck', sql`${t.status} IN ('pending','ready','rejected')`),
    check('attachments_uploader_ck', sql`${t.uploadedByType} IN ('visitor','member')`),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: nocase('name').notNull(),
    color: text('color'),
    createdAt: ts('created_at'),
  },
  (t) => [unique('tags_tenant_uq').on(t.workspaceId, t.id), unique('tags_name_uq').on(t.workspaceId, t.name)],
);

/** Replies a team writes once and sends often. The title is what a member searches for; the content is what is put in the reply box. */
export const savedReplies = sqliteTable(
  'saved_replies',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: nocase('title').notNull(),
    content: text('content').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [unique('saved_replies_title_uq').on(t.workspaceId, t.title)],
);

export const conversationTags = sqliteTable(
  'conversation_tags',
  {
    workspaceId: text('workspace_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    tagId: text('tag_id').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.conversationId, t.tagId] }),
    index('conversation_tags_tag_idx').on(t.workspaceId, t.tagId),
    foreignKey({
      name: 'conversation_tags_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'conversation_tags_tag_fk',
      columns: [t.workspaceId, t.tagId],
      foreignColumns: [tags.workspaceId, tags.id],
    }).onDelete('cascade'),
  ],
);

export const contactTags = sqliteTable(
  'contact_tags',
  {
    workspaceId: text('workspace_id').notNull(),
    contactId: text('contact_id').notNull(),
    tagId: text('tag_id').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.contactId, t.tagId] }),
    index('contact_tags_tag_idx').on(t.workspaceId, t.tagId),
    foreignKey({
      name: 'contact_tags_contact_fk',
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'contact_tags_tag_fk',
      columns: [t.workspaceId, t.tagId],
      foreignColumns: [tags.workspaceId, tags.id],
    }).onDelete('cascade'),
  ],
);

// ---------- Push: handles only. APNs tokens never enter this database (ADR-0005) ----------

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    memberId: text('member_id').notNull(),
    relayId: text('relay_id').notNull(),
    /** Opaque handle issued by the relay. */
    relaySubscriptionId: text('relay_subscription_id').notNull(),
    /** The phone's X25519 public key for this subscription. Notifications are encrypted to it (ADR-0017). */
    previewKey: text('preview_key').notNull().default(''),
    platform: text('platform', { enum: ['ios', 'android'] }).notNull(),
    deviceLabel: text('device_label'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('push_subscriptions_tenant_uq').on(t.workspaceId, t.id),
    uniqueIndex('push_subscriptions_relay_uq').on(t.relayId, t.relaySubscriptionId),
    foreignKey({
      name: 'push_subscriptions_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.id],
    }).onDelete('cascade'),
    index('push_subscriptions_member_idx').on(t.workspaceId, t.memberId),
    check('push_subscriptions_platform_ck', sql`${t.platform} IN ('ios', 'android')`),
  ],
);

export const notificationPreferences = sqliteTable(
  'notification_preferences',
  {
    workspaceId: text('workspace_id').notNull(),
    memberId: text('member_id').notNull(),
    eventType: text('event_type').notNull(),
    channel: text('channel', { enum: ['push', 'email'] }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.memberId, t.eventType, t.channel] }),
    foreignKey({
      name: 'notification_preferences_member_fk',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.id],
    }).onDelete('cascade'),
    check('notification_preferences_channel_ck', sql`${t.channel} IN ('push','email')`),
  ],
);

// ---------- Email, automation ----------

export const emailSettings = sqliteTable('email_settings', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  senderName: text('sender_name').notNull(),
  senderEmail: text('sender_email').notNull(),
  /** AES-GCM ciphertext, never plaintext JSON. */
  configurationEnc: text('configuration_enc').notNull(),
  keyVersion: integer('key_version').notNull(),
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
});

/** One row for each unsubscribe link sent. The address is here, and not in the link. */
export const emailUnsubscribeLinks = sqliteTable(
  'email_unsubscribe_links',
  {
    tokenHash: text('token_hash').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: nocase('email').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [index('email_unsubscribe_links_email_idx').on(t.workspaceId, t.email)],
);

export const emailSuppressions = sqliteTable(
  'email_suppressions',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: nocase('email').notNull(),
    reason: text('reason', { enum: ['unsubscribe', 'bounce', 'complaint', 'manual'] }).notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.email] }),
    check('email_suppressions_reason_ck', sql`${t.reason} IN ('unsubscribe','bounce','complaint','manual')`),
  ],
);

export const emailDeliveries = sqliteTable(
  'email_deliveries',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull(),
    template: text('template').notNull(),
    /** No plaintext address in the delivery log. */
    recipientHash: text('recipient_hash').notNull(),
    status: text('status', { enum: ['claimed', 'sent', 'failed', 'suppressed'] }).notNull(),
    providerMessageId: text('provider_message_id'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('email_deliveries_dedupe_uq').on(t.workspaceId, t.dedupeKey),
    check('email_deliveries_status_ck', sql`${t.status} IN ('claimed','sent','failed','suppressed')`),
  ],
);

export const automationRules = sqliteTable(
  'automation_rules',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    triggerType: text('trigger_type').notNull(),
    conditionsJson: text('conditions_json').notNull(),
    actionsJson: text('actions_json').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('automation_rules_tenant_uq').on(t.workspaceId, t.id),
    index('automation_rules_trigger_idx').on(t.workspaceId, t.triggerType, t.enabled),
  ],
);

export const automationRuns = sqliteTable(
  'automation_runs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    ruleId: text('rule_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    /** For inactivity rules: last_message_seq at evaluation. One run per rule per quiet period. */
    triggerKey: text('trigger_key').notNull(),
    outcome: text('outcome').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    unique('automation_runs_dedupe_uq').on(t.workspaceId, t.ruleId, t.conversationId, t.triggerKey),
    index('automation_runs_conversation_idx').on(t.workspaceId, t.conversationId),
    foreignKey({
      name: 'automation_runs_rule_fk',
      columns: [t.workspaceId, t.ruleId],
      foreignColumns: [automationRules.workspaceId, automationRules.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'automation_runs_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
  ],
);

// ---------- The AI assistant (ADR-0022) ----------

/** One per website that has been given an assistant. Without a row, the website has none. */
export const assistantSettings = sqliteTable(
  'assistant_settings',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    /** What visitors will see it called. */
    name: text('name').notNull(),
    /** A Workers AI text model from ASSISTANT_MODELS. NULL means the installation's default. */
    model: text('model'),
    /** Answers visitors. Off until a supervisor turns it on. */
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    /** Learns a question and answer from each resolved conversation (step 3). Off until a supervisor turns it on. */
    learn: integer('learn', { mode: 'boolean' }).notNull().default(false),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('assistant_settings_tenant_uq').on(t.workspaceId, t.id),
    unique('assistant_settings_website_uq').on(t.workspaceId, t.websiteId),
    foreignKey({
      name: 'assistant_settings_website_fk',
      columns: [t.workspaceId, t.websiteId],
      foreignColumns: [websites.workspaceId, websites.id],
    }).onDelete('cascade'),
  ],
);

/**
 * What the assistant may answer from. Each change bumps `generation`, and the indexing job for that generation
 * writes chunks whose IDs are `<source id>.<generation>.<n>`, the same IDs as their vectors. So a retried job
 * overwrites rather than duplicates, and the vectors of any generation can be named without a lookup.
 */
export const assistantSources = sqliteTable(
  'assistant_sources',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    kind: text('kind', { enum: ['page', 'text'] }).notNull(),
    title: text('title').notNull(),
    /** For a page: where reading starts. Only pages under it, on the same host, are read. */
    url: text('url'),
    /** For text: what the admin pasted. */
    content: text('content'),
    status: text('status', { enum: ['pending', 'indexing', 'ready', 'failed'] }).notNull().default('pending'),
    /** A code, never a message from elsewhere. */
    errorCode: text('error_code'),
    generation: integer('generation').notNull().default(1),
    /** The generation whose chunks are in use, and how many it has. Together they name its vectors. */
    indexedGeneration: integer('indexed_generation'),
    chunkCount: integer('chunk_count').notNull().default(0),
    pageCount: integer('page_count').notNull().default(0),
    indexedAt: integer('indexed_at'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('assistant_sources_tenant_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'assistant_sources_website_fk',
      columns: [t.workspaceId, t.websiteId],
      foreignColumns: [websites.workspaceId, websites.id],
    }).onDelete('cascade'),
    index('assistant_sources_website_idx').on(t.workspaceId, t.websiteId),
    // Pages are refreshed weekly.
    index('assistant_sources_refresh_idx').on(t.indexedAt).where(sql`${t.kind} = 'page'`),
    check('assistant_sources_kind_ck', sql`${t.kind} IN ('page','text')`),
    check('assistant_sources_status_ck', sql`${t.status} IN ('pending','indexing','ready','failed')`),
    check('assistant_sources_shape_ck', sql`(${t.kind} = 'page') = (${t.url} IS NOT NULL) AND (${t.kind} = 'text') = (${t.content} IS NOT NULL)`),
  ],
);

/** The text of each chunk. Vectorize holds only its vector, under the same ID. */
export const assistantChunks = sqliteTable(
  'assistant_chunks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    sourceId: text('source_id').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    content: text('content').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    foreignKey({
      name: 'assistant_chunks_source_fk',
      columns: [t.workspaceId, t.sourceId],
      foreignColumns: [assistantSources.workspaceId, assistantSources.id],
    }).onDelete('cascade'),
    index('assistant_chunks_source_idx').on(t.workspaceId, t.sourceId),
  ],
);

/** A published help article's text in pieces, for the assistant (ADR-0023 step 4). Vectorize holds the vectors. */
export const helpArticleChunks = sqliteTable(
  'help_article_chunks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    articleId: text('article_id').notNull(),
    content: text('content').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    foreignKey({
      name: 'help_article_chunks_article_fk',
      columns: [t.workspaceId, t.articleId],
      foreignColumns: [helpArticles.workspaceId, helpArticles.id],
    }).onDelete('cascade'),
    index('help_article_chunks_article_idx').on(t.workspaceId, t.articleId),
  ],
);

/**
 * A question and answer learned from one resolved conversation (ADR-0022, step 3), never its messages. One per
 * conversation, deleted with it by cascade; its vector goes through the outbox in the same batch. Only `approved`
 * ones are used. Its vector's ID is `<id>.<indexed generation>.0`, so the sources' removal works for it too.
 * `discarded` keeps the conversation from being read again when nothing could be learned from it.
 */
export const assistantLearned = sqliteTable(
  'assistant_learned',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'discarded'] }).notNull(),
    /** Why nothing was learned, for a discarded one: a code. */
    discardReason: text('discard_reason'),
    /** The conversation's last message when it was learned, so that it is read again only after new messages. */
    learnedSeq: integer('learned_seq').notNull(),
    generation: integer('generation').notNull().default(1),
    indexedGeneration: integer('indexed_generation'),
    decidedByMemberId: text('decided_by_member_id'),
    decidedAt: integer('decided_at'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('assistant_learned_conversation_uq').on(t.workspaceId, t.conversationId),
    foreignKey({
      name: 'assistant_learned_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assistant_learned_website_fk',
      columns: [t.workspaceId, t.websiteId],
      foreignColumns: [websites.workspaceId, websites.id],
    }).onDelete('cascade'),
    index('assistant_learned_website_idx').on(t.workspaceId, t.websiteId, t.status),
    check('assistant_learned_status_ck', sql`${t.status} IN ('pending','approved','rejected','discarded')`),
  ],
);

// ---------- Help centre (ADR-0023) ----------

/** Groups of articles, in one language. */
export const helpCollections = sqliteTable(
  'help_collections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    language: text('language').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('help_collections_tenant_uq').on(t.workspaceId, t.id),
    unique('help_collections_slug_uq').on(t.websiteId, t.language, t.slug),
    index('help_collections_website_idx').on(t.workspaceId, t.websiteId),
    foreignKey({
      name: 'help_collections_website_fk',
      columns: [t.workspaceId, t.websiteId],
      foreignColumns: [websites.workspaceId, websites.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Articles. The Markdown is what a supervisor wrote; the HTML is rendered from it on save, and is all a visitor is
 * ever sent. search_title and search_text are normalised for LIKE search: no FTS5, because D1 cannot export
 * virtual tables.
 */
export const helpArticles = sqliteTable(
  'help_articles',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    /** Removed from a collection before the collection is deleted, in the same batch. */
    collectionId: text('collection_id'),
    /** Articles that say the same thing in other languages share it. */
    translationGroupId: text('translation_group_id').notNull(),
    language: text('language').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    bodyMarkdown: text('body_markdown').notNull().default(''),
    bodyHtml: text('body_html').notNull().default(''),
    searchTitle: text('search_title').notNull().default(''),
    searchText: text('search_text').notNull().default(''),
    status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
    position: integer('position').notNull().default(0),
    version: integer('version').notNull().default(1),
    publishedAt: integer('published_at'),
    updatedByMemberId: text('updated_by_member_id'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
    /** Written by Draft with AI (ADR-0023 step 2): the run, and which of its outline it is. Kept after edits. */
    draftRunId: text('draft_run_id'),
    draftIndex: integer('draft_index'),
    /** Shown as "Drafted by AI" until a person changes the words. */
    aiDrafted: integer('ai_drafted', { mode: 'boolean' }).notNull().default(false),
    /** The pages and files it was drafted from: [{ title, url }], url null for a file. */
    aiSourcesJson: text('ai_sources_json'),
    /**
     * The assistant's copy (ADR-0023 step 4): the version whose chunks are in help_article_chunks, and how many.
     * Its vectors are `<id>.<indexed version>.<n>`, as a source's are, so the same removal works for them.
     */
    indexedVersion: integer('indexed_version'),
    indexedChunks: integer('indexed_chunks').notNull().default(0),
  },
  (t) => [
    unique('help_articles_tenant_uq').on(t.workspaceId, t.id),
    uniqueIndex('help_articles_draft_uq').on(t.draftRunId, t.draftIndex).where(sql`${t.draftRunId} IS NOT NULL`),
    unique('help_articles_slug_uq').on(t.websiteId, t.language, t.slug),
    foreignKey({
      name: 'help_articles_website_fk',
      columns: [t.workspaceId, t.websiteId],
      foreignColumns: [websites.workspaceId, websites.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'help_articles_collection_fk',
      columns: [t.workspaceId, t.collectionId],
      foreignColumns: [helpCollections.workspaceId, helpCollections.id],
    }),
    index('help_articles_website_idx').on(t.workspaceId, t.websiteId),
    index('help_articles_public_idx').on(t.websiteId, t.language, t.status),
    index('help_articles_collection_idx').on(t.workspaceId, t.collectionId),
    index('help_articles_group_idx').on(t.workspaceId, t.translationGroupId),
    check('help_articles_status_ck', sql`${t.status} IN ('draft','published')`),
    check('help_articles_published_ck', sql`(${t.status} = 'published') = (${t.publishedAt} IS NOT NULL)`),
  ],
);

/**
 * One Draft with AI (ADR-0023 step 2). Holds its inputs (links and file names, never the files, which are in R2
 * only while it runs), its outline, and what came of it.
 */
export const helpDraftRuns = sqliteTable(
  'help_draft_runs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    language: text('language').notNull(),
    /** All its articles go here, if chosen. Not a foreign key: a deleted collection leaves the articles outside any. */
    collectionId: text('collection_id'),
    readWebsite: integer('read_website', { mode: 'boolean' }).notNull().default(false),
    linksJson: text('links_json').notNull().default('[]'),
    /** [{ name, contentType, sizeBytes }] */
    filesJson: text('files_json').notNull().default('[]'),
    status: text('status', { enum: ['uploading', 'queued', 'reading', 'writing', 'done', 'failed'] }).notNull().default('uploading'),
    errorCode: text('error_code'),
    /** [{ title, summary, collectionId, sources: number[] }] */
    outlineJson: text('outline_json'),
    planned: integer('planned').notNull().default(0),
    /** Outline positions the model could not write, so that a repeat does not count one twice. */
    failedJson: text('failed_json').notNull().default('[]'),
    materialChars: integer('material_chars').notNull().default(0),
    createdByMemberId: text('created_by_member_id'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    unique('help_draft_runs_tenant_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'help_draft_runs_website_fk',
      columns: [t.workspaceId, t.websiteId],
      foreignColumns: [websites.workspaceId, websites.id],
    }).onDelete('cascade'),
    index('help_draft_runs_website_idx').on(t.workspaceId, t.websiteId, t.createdAt),
    index('help_draft_runs_open_idx').on(t.updatedAt).where(sql`${t.status} NOT IN ('done','failed')`),
    check('help_draft_runs_status_ck', sql`${t.status} IN ('uploading','queued','reading','writing','done','failed')`),
  ],
);

/** Images in articles. The file is in R2 at help/<id>; it is the company's, not a visitor's. */
export const helpAssets = sqliteTable(
  'help_assets',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    websiteId: text('website_id').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    filename: text('filename').notNull(),
    createdByMemberId: text('created_by_member_id'),
    createdAt: ts('created_at'),
  },
  (t) => [
    unique('help_assets_tenant_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'help_assets_website_fk',
      columns: [t.workspaceId, t.websiteId],
      foreignColumns: [websites.workspaceId, websites.id],
    }).onDelete('cascade'),
    index('help_assets_website_idx').on(t.workspaceId, t.websiteId),
    check('help_assets_type_ck', sql`${t.contentType} IN ('image/png','image/jpeg','image/gif','image/webp')`),
  ],
);

/** What the assistant cost each workspace each day (UTC), so that a limit can stop it and an operator can see it. */
export const assistantUsage = sqliteTable(
  'assistant_usage',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** YYYY-MM-DD */
    day: text('day').notNull(),
    answers: integer('answers').notNull().default(0),
    pages: integer('pages').notNull().default(0),
    chunks: integer('chunks').notNull().default(0),
    /** Characters sent to be translated (ADR-0024), counted before the call, and limited per day. */
    translatedChars: integer('translated_chars').notNull().default(0),
  },
  (t) => [primaryKey({ name: 'assistant_usage_pk', columns: [t.workspaceId, t.day] })],
);

// ---------- Reliability, audit ----------

export const outbox = sqliteTable(
  'outbox',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    topic: text('topic').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payloadJson: text('payload_json').notNull(),
    createdAt: ts('created_at'),
    dispatchedAt: integer('dispatched_at'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    index('outbox_pending_idx').on(t.createdAt).where(sql`${t.dispatchedAt} IS NULL`),
    // For finishing one send. The index above would scan the whole backlog, just when there is a backlog.
    index('outbox_pending_aggregate_idx').on(t.workspaceId, t.aggregateId).where(sql`${t.dispatchedAt} IS NULL`),
    index('outbox_purge_idx').on(t.dispatchedAt).where(sql`${t.dispatchedAt} IS NOT NULL`),
  ],
);

export const jobReceipts = sqliteTable(
  'job_receipts',
  {
    idempotencyKey: text('idempotency_key').primaryKey(),
    jobType: text('job_type').notNull(),
    status: text('status', { enum: ['claimed', 'done'] }).notNull(),
    claimedAt: ts('claimed_at'),
    completedAt: integer('completed_at'),
  },
  (t) => [check('job_receipts_status_ck', sql`${t.status} IN ('claimed','done')`), index('job_receipts_claimed_idx').on(t.claimedAt)],
);

/** The DLQ sink, so that failures outlive queue retention. IDs only, no message content. */
export const failedJobs = sqliteTable(
  'failed_jobs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id'),
    queue: text('queue').notNull(),
    jobType: text('job_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    attempts: integer('attempts').notNull(),
    envelopeJson: text('envelope_json').notNull(),
    failedAt: ts('failed_at'),
    replayedAt: integer('replayed_at'),
  },
  (t) => [index('failed_jobs_recent_idx').on(sql`${t.failedAt} DESC`)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadataJson: json('metadata_json'),
    createdAt: ts('created_at'),
  },
  (t) => [
    index('audit_log_idx').on(t.workspaceId, sql`${t.createdAt} DESC`, sql`${t.id} DESC`),
    // For the installation-wide list, newest first.
    index('audit_log_recent_idx').on(sql`${t.createdAt} DESC`, sql`${t.id} DESC`),
  ],
);

/** Tables with no workspace_id. Every other table must have the column, and a test enforces this. */
export const TABLES_WITHOUT_WORKSPACE = [
  'installation',
  'users',
  'auth_sessions',
  'auth_tokens',
  'workspaces',
  'job_receipts',
  'failed_jobs',
] as const;
