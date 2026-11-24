/**
 * Scoped repositories. Every query here applies ctx.workspaceId. A cross-tenant ID behaves exactly
 * like an ID that does not exist. Write patterns: docs/architecture/data-model.md.
 */
import { newId } from '@openchat/shared';
import type { Role, WorkspaceContext } from './context';
import { DB_NOW_MS, rawHandle, type Database } from './internal/handle';
import { learnedVectorRemovalSql } from './assistant-learning';
import { ATTACHMENTS_JSON, messageStatements } from './internal/message-statements';
import { effectiveRole } from './internal/roles';
import { TRANSLATIONS_JSON } from './translation-repository';

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
}

export interface WebsiteRow {
  id: string;
  name: string;
  websiteKey: string;
  allowedOrigins: string[];
  settings: Record<string, unknown>;
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'suspended' | 'removed';
  /** Their own choice: an away member does not make the widget say the team is online. */
  away: boolean;
}
type RawMember = Omit<MemberRow, 'away'> & { away: number };
const toMember = (row: RawMember): MemberRow => ({ ...row, away: row.away === 1 });

/** Counts for one member's view of a workspace's inbox. */
export interface InboxSummaryRow {
  open: number;
  unassigned: number;
  mine: number;
  pending: number;
  unread: number;
}

export const WEBSITE_COLUMNS = `id, name, website_key AS websiteKey, allowed_origins_json AS originsJson, settings_json AS settingsJson`;
export type RawWebsite = Omit<WebsiteRow, 'allowedOrigins' | 'settings'> & { originsJson: string; settingsJson: string | null };
export const toWebsite = ({ originsJson, settingsJson, ...row }: RawWebsite): WebsiteRow => ({
  ...row,
  allowedOrigins: JSON.parse(originsJson) as string[],
  settings: settingsJson ? (JSON.parse(settingsJson) as Record<string, unknown>) : {},
});

const MEMBER_SELECT = `SELECT m.id, u.name, u.email, ${effectiveRole('m')} AS role, CASE WHEN m.removed_at IS NOT NULL THEN 'removed' ELSE m.status END AS status, m.away FROM workspace_members m JOIN users u ON u.id = m.user_id`;

export type SendableType = 'text' | 'image' | 'file' | 'system' | 'internal_note';


export interface SendMessageInput {
  conversationId: string;
  clientMessageId: string;
  sender: { type: 'visitor' | 'member' | 'system'; id: string | null };
  type: SendableType;
  content: string;
  attachmentIds?: string[];
  /** What the member wrote, when `content` is its translation for the visitor (ADR-0024). */
  original?: { language: string; content: string } | undefined;
}

export interface StoredMessage {
  id: string;
  workspaceId: string;
  /** JSON from ATTACHMENTS_JSON. */
  attachmentsJson: string;
  conversationId: string;
  seq: number;
  publicSeq: number | null;
  clientMessageId: string | null;
  senderType: string;
  senderId: string | null;
  type: SendableType;
  visibility: 'public' | 'internal';
  content: string;
  createdAt: number;
  /** The member's or contact's current name. Null if there is none, or the member has since left. */
  senderName: string | null;
  /** The author was removed from the workspace, or their account was deactivated. Agents only. */
  senderRemoved: number | null;
  /** Written by the AI assistant (ADR-0022): an answer, or handing the conversation to the team. */
  assistantKind: AssistantMessageKind | null;
  /** Why it handed over. */
  assistantReason: string | null;
  /** JSON from TRANSLATIONS_JSON, in lists for members only (ADR-0024). */
  translationsJson?: string;
  /** A member wrote it in this language, and `originalContent` is what they wrote (ADR-0024). */
  originalLanguage: string | null;
  originalContent: string | null;
}

export type AssistantMessageKind = 'answer' | 'handover';
export type AssistantState = 'answering' | 'handed_over' | 'stopped';

export interface NewAttachment {
  id: string;
  conversationId: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface AttachmentRow {
  id: string;
  storageKey: string;
  filename: string;
  contentType: string;
  size: number;
}

export const ATTACHMENT_SELECT = `SELECT id, storage_key AS storageKey, filename, content_type AS contentType, size FROM attachments`;
/** Under the workspace, so that storage has the same boundary as the database. */
export const attachmentKey = (workspaceId: string, conversationId: string, id: string) => `w/${workspaceId}/c/${conversationId}/${id}`;

export type ConversationStatus = 'open' | 'pending' | 'resolved' | 'archived';
export type ConversationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TagRow {
  id: string;
  name: string;
}

export interface ContactRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** A contact as the Contacts page lists it: with the conversation that changed last, and how many there are. */
export interface ContactListRow extends ContactRow {
  conversationCount: number;
  lastConversationId: string;
  lastActivityAt: number;
}

export interface ContactExportRows {
  contact: ContactRow & { attributesJson: string | null; followUpConsentAt: number | null; followUpConsentSource: string | null; createdAt: number };
  tags: string[];
  browsers: { id: string; websiteId: string; firstSeenAt: number; lastSeenAt: number }[];
  conversations: { id: string; websiteId: string; status: string; subject: string | null; createdAt: number; visitorPageUrl: string | null; visitorPageAt: number | null }[];
  messages: { id: string; conversationId: string; senderType: 'visitor' | 'member' | 'system'; type: string; visibility: 'public' | 'internal'; content: string; createdAt: number; translationsJson: string; originalLanguage: string | null; originalContent: string | null }[];
  files: { messageId: string; filename: string; contentType: string; size: number }[];
  suppressions: { email: string; reason: string; createdAt: number }[];
}

export interface ConversationRow {
  id: string;
  websiteId: string;
  contactId: string;
  contactName: string | null;
  contactEmail: string | null;
  /** A JSON array of TagRow. */
  tagsJson: string;
  assignedMemberId: string | null;
  status: ConversationStatus;
  priority: ConversationPriority;
  subject: string | null;
  version: number;
  lastMessageSeq: number;
  lastPublicSeq: number;
  lastMessageAt: number | null;
  /** The calling member's own read position. */
  lastReadSeq: number;
  createdAt: number;
  updatedAt: number;
  assistantState: AssistantState | null;
  helpArticleId: string | null;
  visitorLanguage: string | null;
  /** The page the visitor is on now, as their widget last reported it, without query or fragment. */
  visitorPageUrl: string | null;
  visitorPageAt: number | null;
  /** A JSON LastMessageRow, or null when the newest message is gone, as retention leaves it. */
  lastMessageJson: string | null;
  /** How far any of the contact's browsers has read, as a public sequence number. */
  visitorReadSeq: number;
}

/** The newest message, cut short, for a line under the contact's name in the inbox. */
export interface LastMessageRow {
  text: string;
  senderType: 'visitor' | 'member' | 'assistant' | 'system';
  senderId: string | null;
  type: 'text' | 'image' | 'file' | 'system' | 'internal_note';
}

/** As long as a preview needs to be. A phone shows one line of it. */
export const PREVIEW_CHARS = 140;

export interface ConversationChange {
  /** Null unassigns. Undefined leaves the assignee alone. */
  assignedMemberId?: string | null | undefined;
  status?: ConversationStatus | undefined;
  priority?: ConversationPriority | undefined;
  /** A correction of the visitor's language (ADR-0024). */
  visitorLanguage?: string | undefined;
}

/** A member ID, or null for conversations nobody is assigned to. */
export interface ConversationFilter {
  status: ConversationStatus;
  assignee?: string | null | undefined;
  /** Part of the contact's name or email, already in lower case. With it, status and assignee are not applied. */
  q?: string | undefined;
  before?: { lastMessageAt: number; id: string } | undefined;
  limit: number;
}

export type SendResult =
  | { outcome: 'created'; message: StoredMessage }
  | { outcome: 'replayed'; message: StoredMessage }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_attachments' };

export type AssignResult =
  | { outcome: 'updated'; version: number }
  | { outcome: 'conflict'; currentVersion: number }
  | { outcome: 'invalid_assignee' }
  | { outcome: 'not_found' };

/** Names come by primary key, so that this stays cheap on the hot path. Agents only: it includes internal notes. */
export const MESSAGE_SELECT = `SELECT m.id, m.workspace_id AS workspaceId, ${ATTACHMENTS_JSON} AS attachmentsJson, m.conversation_id AS conversationId, m.seq, m.public_seq AS publicSeq,
    m.client_message_id AS clientMessageId, m.sender_type AS senderType, m.sender_id AS senderId,
    m.message_type AS type, m.visibility, m.content, m.created_at AS createdAt, COALESCE(u.name, ct.name, asst.name) AS senderName,
    (sm.removed_at IS NOT NULL OR u.disabled_at IS NOT NULL) AS senderRemoved,
    CASE WHEN m.assistant_id IS NOT NULL THEN COALESCE(json_extract(m.metadata_json, '$.assistant'), 'answer') END AS assistantKind,
    CASE WHEN m.assistant_id IS NOT NULL THEN json_extract(m.metadata_json, '$.reason') END AS assistantReason,
    m.original_language AS originalLanguage,
    CASE WHEN m.original_language IS NOT NULL THEN (SELECT o.content FROM message_translations o
      WHERE o.workspace_id = m.workspace_id AND o.message_id = m.id AND o.language = m.original_language) END AS originalContent
  FROM messages m
  LEFT JOIN workspace_members sm ON m.sender_type = 'member' AND sm.workspace_id = m.workspace_id AND sm.id = m.sender_id
  LEFT JOIN users u ON u.id = sm.user_id
  LEFT JOIN visitors sv ON m.sender_type = 'visitor' AND sv.workspace_id = m.workspace_id AND sv.id = m.sender_id
  LEFT JOIN contacts ct ON ct.workspace_id = sv.workspace_id AND ct.id = sv.contact_id
  LEFT JOIN assistant_settings asst ON m.assistant_id IS NOT NULL AND asst.workspace_id = m.workspace_id AND asst.id = m.assistant_id`;

/** ?1 is the calling member, for their read position. */
const CONTACT_SELECT = `SELECT id, name, email, phone, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt FROM contacts`;
const MAX_TAGS = 500;

/** The member is an installation admin, and active here. ADR-0016: managing does not include reading, so both are needed. */
const memberIsAdmin = (workspace: string, member: string) => `EXISTS (SELECT 1 FROM workspace_members cm JOIN users cu ON cu.id = cm.user_id
    WHERE cm.workspace_id = ${workspace} AND cm.id = ${member} AND cm.status = 'active' AND cu.is_installation_admin = 1 AND cu.disabled_at IS NULL)`;

/** The tags are read by primary key per row, and a page is at most 100 rows. */
export const CONVERSATION_TAGS_JSON = `(SELECT COALESCE(json_group_array(json_object('id', t.id, 'name', t.name)), '[]')
       FROM conversation_tags ct JOIN tags t ON t.workspace_id = ct.workspace_id AND t.id = ct.tag_id
      WHERE ct.workspace_id = c.workspace_id AND ct.conversation_id = c.id)`;

const CONVERSATION_SELECT = `SELECT c.id, c.website_id AS websiteId, c.contact_id AS contactId, k.name AS contactName, k.email AS contactEmail,
    ${CONVERSATION_TAGS_JSON} AS tagsJson, c.assigned_member_id AS assignedMemberId,
    c.status, c.priority, c.subject, c.version, c.last_message_seq AS lastMessageSeq, c.last_public_seq AS lastPublicSeq,
    c.last_message_at AS lastMessageAt, COALESCE(r.read_seq, 0) AS lastReadSeq, c.created_at AS createdAt, c.updated_at AS updatedAt,
    c.assistant_state AS assistantState, c.help_article_id AS helpArticleId, c.visitor_language AS visitorLanguage, c.visitor_page_url AS visitorPageUrl, c.visitor_page_at AS visitorPageAt,
    (SELECT json_object('text', substr(lm.content, 1, ${PREVIEW_CHARS}),
              'senderType', CASE WHEN lm.assistant_id IS NOT NULL THEN 'assistant' ELSE lm.sender_type END,
              'senderId', CASE WHEN lm.sender_type = 'member' AND lm.assistant_id IS NULL THEN lm.sender_id END, 'type', lm.message_type)
       FROM messages lm WHERE lm.workspace_id = c.workspace_id AND lm.conversation_id = c.id AND lm.seq = c.last_message_seq) AS lastMessageJson,
    COALESCE((SELECT MAX(vr.read_seq) FROM conversation_read_cursors vr
       WHERE vr.workspace_id = c.workspace_id AND vr.conversation_id = c.id AND vr.reader_type = 'visitor'), 0) AS visitorReadSeq
  FROM conversations c
  JOIN contacts k ON k.workspace_id = c.workspace_id AND k.id = c.contact_id
  LEFT JOIN conversation_read_cursors r ON r.workspace_id = c.workspace_id AND r.conversation_id = c.id
    AND r.reader_type = 'member' AND r.reader_id = ?1`;

export function repositories(database: Database, ctx: WorkspaceContext) {
  const d1 = rawHandle(database);
  const w = ctx.workspaceId;

  return {
    contacts: {
      get(contactId: string): Promise<ContactRow | null> {
        return d1.prepare(`${CONTACT_SELECT} WHERE workspace_id = ?1 AND id = ?2`).bind(w, contactId).first<ContactRow>();
      },
      /**
       * Contacts who have a conversation, the one whose conversation changed last first. It walks the conversations by
       * their last change and keeps each contact's newest, so a page costs about a page of rows however many there are.
       * A browser that never wrote is a contact too, with no conversation, and is not listed.
       */
      async list(filter: { q?: string | undefined; before?: { at: number; id: string } | undefined; limit: number }): Promise<ContactListRow[]> {
        // The + keeps SQLite from using an index on updated_at for a contact's other conversations, so that it looks
        // them up by contact. Without it, it walked every newer conversation in the workspace for each row.
        const before = filter.before ? 'AND (c.updated_at, c.id) < (?3, ?4)' : '';
        // instr, unlike LIKE, gives no meaning to % or _ in what a member types.
        const q = filter.q ? `AND (instr(lower(COALESCE(k.name, '')), ?5) > 0 OR instr(lower(COALESCE(k.email, '')), ?5) > 0)` : '';
        const { results } = await d1
          .prepare(
            `SELECT k.id, k.name, k.email, k.phone, k.first_seen_at AS firstSeenAt, k.last_seen_at AS lastSeenAt,
                    c.id AS lastConversationId, c.updated_at AS lastActivityAt,
                    (SELECT COUNT(*) FROM conversations n WHERE n.workspace_id = c.workspace_id AND n.contact_id = c.contact_id) AS conversationCount
               FROM conversations c
               JOIN contacts k ON k.workspace_id = c.workspace_id AND k.id = c.contact_id
              WHERE c.workspace_id = ?1 ${before} ${q}
                AND NOT EXISTS (SELECT 1 FROM conversations o WHERE o.workspace_id = c.workspace_id AND o.contact_id = c.contact_id
                                 AND (+o.updated_at > c.updated_at OR (+o.updated_at = c.updated_at AND o.id > c.id)))
              ORDER BY c.updated_at DESC, c.id DESC LIMIT ?2`,
          )
          .bind(w, filter.limit, ...(filter.before ? [filter.before.at, filter.before.id] : filter.q ? [null, null] : []), ...(filter.q ? [filter.q] : []))
          .all<ContactListRow>();
        return results;
      },
      /** Undefined leaves a field alone, and null clears it. Consent was given for one address, so a different one loses it. */
      async update(contactId: string, change: { name?: string | null | undefined; email?: string | null | undefined; phone?: string | null | undefined }): Promise<boolean> {
        const field = (value: string | null | undefined) => [value === undefined ? 0 : 1, value ?? null];
        const result = await d1
          .prepare(
            `UPDATE contacts
                SET name = CASE WHEN ?1 THEN ?2 ELSE name END, email = CASE WHEN ?3 THEN ?4 ELSE email END,
                    phone = CASE WHEN ?5 THEN ?6 ELSE phone END,
                    follow_up_consent_at = CASE WHEN ?3 AND email IS NOT ?4 THEN NULL ELSE follow_up_consent_at END,
                    follow_up_consent_source = CASE WHEN ?3 AND email IS NOT ?4 THEN NULL ELSE follow_up_consent_source END,
                    updated_at = ${DB_NOW_MS}
              WHERE workspace_id = ?7 AND id = ?8`,
          )
          .bind(...field(change.name), ...field(change.email), ...field(change.phone), w, contactId)
          .run();
        return result.meta.changes === 1;
      },
      /** Whether the caller may export or erase contacts: an installation admin who is an active member here. */
      async callerIsAdmin(): Promise<boolean> {
        return (await d1.prepare(`SELECT 1 WHERE ${memberIsAdmin('?1', '?2')}`).bind(w, ctx.memberId).first()) !== null;
      },

      /** Read in one batch, so that it is one consistent view. Internal notes only when asked for. */
      async exportData(contactId: string, includeNotes: boolean): Promise<ContactExportRows | null> {
        const notes = includeNotes ? '' : `AND m.visibility = 'public'`;
        const [contact, tags, browsers, conversations, messages, files, suppressions] = await d1.batch([
          d1
            .prepare(
              `SELECT id, name, email, phone, attributes_json AS attributesJson, follow_up_consent_at AS followUpConsentAt,
                      follow_up_consent_source AS followUpConsentSource, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, created_at AS createdAt
                 FROM contacts WHERE workspace_id = ?1 AND id = ?2`,
            )
            .bind(w, contactId),
          d1.prepare(`SELECT t.name FROM contact_tags ct JOIN tags t ON t.workspace_id = ct.workspace_id AND t.id = ct.tag_id WHERE ct.workspace_id = ?1 AND ct.contact_id = ?2 ORDER BY t.name`).bind(w, contactId),
          d1.prepare(`SELECT id, website_id AS websiteId, created_at AS firstSeenAt, last_seen_at AS lastSeenAt FROM visitors WHERE workspace_id = ?1 AND contact_id = ?2 ORDER BY created_at`).bind(w, contactId),
          d1.prepare(`SELECT id, website_id AS websiteId, status, subject, created_at AS createdAt, visitor_page_url AS visitorPageUrl, visitor_page_at AS visitorPageAt FROM conversations WHERE workspace_id = ?1 AND contact_id = ?2 ORDER BY created_at`).bind(w, contactId),
          d1
            .prepare(
              `SELECT m.id, m.conversation_id AS conversationId, m.sender_type AS senderType, m.message_type AS type, m.visibility, m.content, m.created_at AS createdAt,
                      ${TRANSLATIONS_JSON} AS translationsJson, m.original_language AS originalLanguage,
                      (SELECT o.content FROM message_translations o WHERE o.workspace_id = m.workspace_id AND o.message_id = m.id AND o.language = m.original_language) AS originalContent
                 FROM messages m JOIN conversations c ON c.workspace_id = m.workspace_id AND c.id = m.conversation_id
                WHERE m.workspace_id = ?1 AND c.contact_id = ?2 ${notes} ORDER BY m.conversation_id, m.seq`,
            )
            .bind(w, contactId),
          d1
            .prepare(
              `SELECT a.message_id AS messageId, a.filename, a.content_type AS contentType, a.size
                 FROM attachments a JOIN conversations c ON c.workspace_id = a.workspace_id AND c.id = a.conversation_id
                 JOIN messages m ON m.workspace_id = a.workspace_id AND m.id = a.message_id
                WHERE a.workspace_id = ?1 AND c.contact_id = ?2 ${notes} ORDER BY a.created_at`,
            )
            .bind(w, contactId),
          d1
            .prepare(
              `SELECT s.email, s.reason, s.created_at AS createdAt FROM email_suppressions s
                WHERE s.workspace_id = ?1 AND s.email = (SELECT email FROM contacts WHERE workspace_id = ?1 AND id = ?2)`,
            )
            .bind(w, contactId),
        ]);
        const row = contact?.results[0] as ContactExportRows['contact'] | undefined;
        if (!row) return null;
        return {
          contact: row,
          tags: (tags?.results as { name: string }[]).map((t) => t.name),
          browsers: browsers?.results as ContactExportRows['browsers'],
          conversations: conversations?.results as ContactExportRows['conversations'],
          messages: messages?.results as ContactExportRows['messages'],
          files: files?.results as ContactExportRows['files'],
          suppressions: suppressions?.results as ContactExportRows['suppressions'],
        };
      },

      /**
       * Pattern 2: the audit row goes in first, only if the contact is here and the caller is an admin who is a member,
       * and every deletion after it depends on that row. Deleting the contact cascades to its browsers, conversations,
       * messages, read positions, events, tags, and automation runs. The outbox row tells dispatch to delete the
       * conversations' files from storage, which it retries until done. `email` and `emailHash` are the address as read
       * before, in case it changes in between; the address in the row at commit is removed as well.
       */
      async erase(contactId: string, previous: { email: string | null; emailHash: string | null }): Promise<boolean> {
        const audit = newId('audit');
        const done = `EXISTS (SELECT 1 FROM audit_log WHERE id = ?3)`;
        const theirs = `(SELECT id FROM conversations WHERE workspace_id = ?1 AND contact_id = ?2)`;
        const [logged] = await d1.batch([
          d1
            .prepare(
              `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, target_type, target_id, created_at)
               SELECT ?3, ?1, 'user', (SELECT user_id FROM workspace_members WHERE id = ?4), 'contact.erased', 'contact', ?2, ${DB_NOW_MS}
                WHERE EXISTS (SELECT 1 FROM contacts WHERE workspace_id = ?1 AND id = ?2) AND ${memberIsAdmin('?1', '?4')}`,
            )
            .bind(w, contactId, audit, ctx.memberId),
          d1
            .prepare(
              `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
               SELECT ?4, ?1, 'contact.erased', ?2, json_object('conversationIds', (SELECT json_group_array(id) FROM conversations WHERE workspace_id = ?1 AND contact_id = ?2)), ${DB_NOW_MS}
                WHERE ${done}`,
            )
            .bind(w, contactId, audit, newId('outbox')),
          d1
            .prepare(`DELETE FROM email_unsubscribe_links WHERE workspace_id = ?1 AND email IN (?4, (SELECT email FROM contacts WHERE workspace_id = ?1 AND id = ?2)) AND ${done}`)
            .bind(w, contactId, audit, previous.email),
          d1.prepare(`DELETE FROM email_deliveries WHERE workspace_id = ?1 AND recipient_hash = ?4 AND ${done}`).bind(w, contactId, audit, previous.emailHash),
          // A failed job's envelope can hold a notification's text, and names the conversation it was about.
          d1
            .prepare(`DELETE FROM failed_jobs WHERE workspace_id = ?1 AND EXISTS (SELECT 1 FROM ${theirs} t WHERE instr(failed_jobs.envelope_json, t.id) > 0) AND ${done}`)
            .bind(w, contactId, audit),
          // What the assistant learned from these conversations goes by cascade; its vectors, through the outbox.
          d1.prepare(learnedVectorRemovalSql('?1', theirs, '?2', done)).bind(w, contactId, audit),
          // Messages and files both cascade from a conversation, but a file also refers to its message without a cascade.
          d1.prepare(`DELETE FROM attachments WHERE workspace_id = ?1 AND conversation_id IN ${theirs} AND ${done}`).bind(w, contactId, audit),
          d1.prepare(`UPDATE contacts SET merged_into_contact_id = NULL WHERE workspace_id = ?1 AND merged_into_contact_id = ?2 AND ${done}`).bind(w, contactId, audit),
          d1.prepare(`DELETE FROM contacts WHERE workspace_id = ?1 AND id = ?2 AND ${done}`).bind(w, contactId, audit),
        ]);
        return logged?.meta.changes === 1;
      },
    },

    tags: {
      async list(): Promise<TagRow[]> {
        const { results } = await d1.prepare(`SELECT id, name FROM tags WHERE workspace_id = ?1 ORDER BY name LIMIT ${MAX_TAGS}`).bind(w).all<TagRow>();
        return results;
      },
      /** Null means that the workspace is at its limit, decided in SQL so that a race cannot exceed it. */
      async create(name: string): Promise<{ created: boolean; tag: TagRow } | null> {
        const insert = await d1
          .prepare(
            `INSERT INTO tags (id, workspace_id, name, created_at)
             SELECT ?1, ?2, ?3, ${DB_NOW_MS} WHERE (SELECT COUNT(*) FROM tags WHERE workspace_id = ?2) < ${MAX_TAGS}
             ON CONFLICT (workspace_id, name) DO NOTHING`,
          )
          .bind(newId('tag'), w, name)
          .run();
        const tag = await d1.prepare(`SELECT id, name FROM tags WHERE workspace_id = ?1 AND name = ?2`).bind(w, name).first<TagRow>();
        return tag ? { created: insert.meta.changes === 1, tag } : null;
      },
      async delete(tagId: string): Promise<boolean> {
        // D1 counts cascaded rows here too, so this cannot compare with 1.
        return (await d1.prepare(`DELETE FROM tags WHERE workspace_id = ?1 AND id = ?2`).bind(w, tagId).run()).meta.changes > 0;
      },
    },

    workspace: {
      get(): Promise<WorkspaceRow | null> {
        return d1.prepare(`SELECT id, name, slug, created_at AS createdAt FROM workspaces WHERE id = ?1`).bind(w).first<WorkspaceRow>();
      },
    },

    members: {
      async list(input: { cursor?: string | undefined; limit: number }): Promise<{ data: MemberRow[]; nextCursor: string | null }> {
        const { results } = await d1
          .prepare(`${MEMBER_SELECT} WHERE m.workspace_id = ?1 AND m.id > ?2 ORDER BY m.id LIMIT ?3`)
          .bind(w, input.cursor ?? '', input.limit + 1)
          .all<RawMember>();
        const data = results.slice(0, input.limit).map(toMember);
        return { data, nextCursor: results.length > input.limit ? (data.at(-1)?.id ?? null) : null };
      },
      async get(memberId: string): Promise<MemberRow | null> {
        const row = await d1.prepare(`${MEMBER_SELECT} WHERE m.workspace_id = ?1 AND m.id = ?2`).bind(w, memberId).first<RawMember>();
        return row && toMember(row);
      },
      /** Only ever the caller's own row: the ID comes from the context, not from the request. */
      async setAway(away: boolean): Promise<MemberRow | null> {
        await d1.prepare(`UPDATE workspace_members SET away = ?3, updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND id = ?2 AND away <> ?3`).bind(w, ctx.memberId, away ? 1 : 0).run();
        return this.get(ctx.memberId);
      },
    },

    websites: {
      async list(): Promise<WebsiteRow[]> {
        const { results } = await d1.prepare(`SELECT ${WEBSITE_COLUMNS} FROM websites WHERE workspace_id = ?1 ORDER BY id`).bind(w).all<RawWebsite>();
        return results.map(toWebsite);
      },
    },

    conversations: {
      get(conversationId: string): Promise<ConversationRow | null> {
        return d1.prepare(`${CONVERSATION_SELECT} WHERE c.workspace_id = ?2 AND c.id = ?3`).bind(ctx.memberId, w, conversationId).first<ConversationRow>();
      },

      /**
       * An inbox view, newest first, using the inbox and assignee indexes. Every conversation starts with a
       * message in the same batch, so last_message_at is set and the row comparison is safe.
       */
      /**
       * One pass over the open and pending rows of conversations_inbox_idx. Unread counts open conversations
       * with a message past this member's read position.
       */
      async summary(): Promise<InboxSummaryRow> {
        const row = await d1
          .prepare(
            `SELECT COALESCE(SUM(c.status = 'open'), 0) AS open,
                    COALESCE(SUM(c.status = 'open' AND c.assigned_member_id IS NULL), 0) AS unassigned,
                    COALESCE(SUM(c.status = 'open' AND c.assigned_member_id = ?1), 0) AS mine,
                    COALESCE(SUM(c.status = 'pending'), 0) AS pending,
                    COALESCE(SUM(c.status = 'open' AND c.last_message_seq > COALESCE(r.read_seq, 0)), 0) AS unread
               FROM conversations c
               LEFT JOIN conversation_read_cursors r ON r.workspace_id = c.workspace_id AND r.conversation_id = c.id AND r.reader_type = 'member' AND r.reader_id = ?1
              WHERE c.workspace_id = ?2 AND c.status IN ('open', 'pending')`,
          )
          .bind(ctx.memberId, w)
          .first<InboxSummaryRow>();
        return row ?? { open: 0, unassigned: 0, mine: 0, pending: 0, unread: 0 };
      },

      async list(filter: ConversationFilter): Promise<ConversationRow[]> {
        const before = filter.before ? 'AND (c.last_message_at, c.id) < (?5, ?6)' : '';
        // A search looks in every status, and reads the workspace's conversations newest first until the page is full.
        // instr, unlike LIKE, gives no meaning to % or _ in what a member types.
        const assignee = filter.assignee === undefined ? '' : filter.assignee === null ? 'AND c.assigned_member_id IS NULL' : 'AND c.assigned_member_id = ?4';
        const where = filter.q ? `AND (instr(lower(COALESCE(k.name, '')), ?8) > 0 OR instr(lower(COALESCE(k.email, '')), ?8) > 0)` : `AND c.status = ?3 ${assignee}`;
        const { results } = await d1
          .prepare(`${CONVERSATION_SELECT} WHERE c.workspace_id = ?2 ${where} ${before} ORDER BY c.last_message_at DESC, c.id DESC LIMIT ?7`)
          .bind(ctx.memberId, w, filter.status, filter.assignee ?? null, filter.before?.lastMessageAt ?? null, filter.before?.id ?? null, filter.limit, ...(filter.q ? [filter.q] : []))
          .all<ConversationRow>();
        return results;
      },

      /** Everything changed since a position, oldest change first, for a client catching up. */
      async listChangedSince(after: { updatedAt: number; id: string }, limit: number): Promise<ConversationRow[]> {
        const { results } = await d1
          .prepare(`${CONVERSATION_SELECT} WHERE c.workspace_id = ?2 AND (c.updated_at, c.id) > (?3, ?4) ORDER BY c.updated_at, c.id LIMIT ?5`)
          .bind(ctx.memberId, w, after.updatedAt, after.id, limit)
          .all<ConversationRow>();
        return results;
      },

      /**
       * Pattern 2: compare-and-set with follow-up statements, guarded by a value unique to this request.
       * Guarding on version = expected + 1 is wrong: if another writer already advanced the version, a stale
       * request would match it and write a false event. The assignee is checked here, so that someone removed
       * since the request was authorised cannot be assigned.
       */
      async update(conversationId: string, change: ConversationChange, expectedVersion: number): Promise<AssignResult> {
        const mutation = newId('mutation');
        const assigning = change.assignedMemberId !== undefined;
        const assignee = change.assignedMemberId ?? null;
        const event = (type: string, applies: boolean, field: string, value: string | null) =>
          d1
            .prepare(
              `INSERT INTO conversation_events (id, workspace_id, conversation_id, event_type, actor_type, actor_id, metadata_json, created_at)
               SELECT ?1, workspace_id, id, ?2, 'member', ?3, json_object(?4, ?5), ${DB_NOW_MS}
                 FROM conversations WHERE workspace_id = ?6 AND id = ?7 AND last_mutation_id = ?8 AND ?9`,
            )
            .bind(newId('event'), type, ctx.memberId, field, value, w, conversationId, mutation, applies ? 1 : 0);
        const [update] = await d1.batch([
          d1
            .prepare(
              `UPDATE conversations
                  SET assigned_member_id = CASE WHEN ?1 THEN ?2 ELSE assigned_member_id END,
                      assistant_state = CASE WHEN ?1 AND ?2 IS NOT NULL AND (assistant_state IS NULL OR assistant_state = 'answering') THEN 'stopped' ELSE assistant_state END,
                      status = COALESCE(?3, status), priority = COALESCE(?4, priority), visitor_language = COALESCE(?9, visitor_language),
                      version = version + 1, last_mutation_id = ?5, updated_at = ${DB_NOW_MS}
                WHERE workspace_id = ?6 AND id = ?7 AND version = ?8
                  AND (NOT ?1 OR ?2 IS NULL OR EXISTS (SELECT 1 FROM workspace_members t
                        WHERE t.workspace_id = conversations.workspace_id AND t.id = ?2 AND t.status = 'active'))`,
            )
            .bind(assigning ? 1 : 0, assignee, change.status ?? null, change.priority ?? null, mutation, w, conversationId, expectedVersion, change.visitorLanguage ?? null),
          event('assigned', assigning, 'assignedMemberId', assignee),
          event('status_changed', change.status !== undefined, 'status', change.status ?? null),
          event('priority_changed', change.priority !== undefined, 'priority', change.priority ?? null),
          event('language_changed', change.visitorLanguage !== undefined, 'visitorLanguage', change.visitorLanguage ?? null),
          d1
            .prepare(
              `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
               SELECT ?1, workspace_id, 'conversation.updated', id, json_object('conversationId', id, 'version', version, 'assignedTo', ?5, 'actorId', ?6), ${DB_NOW_MS}
                 FROM conversations WHERE workspace_id = ?2 AND id = ?3 AND last_mutation_id = ?4`,
            )
            .bind(newId('outbox'), w, conversationId, mutation, assignee, ctx.memberId),
        ]);
        if (update?.meta.changes === 1) return { outcome: 'updated', version: expectedVersion + 1 };
        const current = await this.get(conversationId);
        if (!current) return { outcome: 'not_found' };
        return current.version === expectedVersion ? { outcome: 'invalid_assignee' } : { outcome: 'conflict', currentVersion: current.version };
      },

      assign(conversationId: string, memberId: string | null, expectedVersion: number): Promise<AssignResult> {
        return this.update(conversationId, { assignedMemberId: memberId }, expectedVersion);
      },

      /**
       * Pattern 2 without a version: the first statement applies only if the conversation and every tag are in
       * this workspace, and leaves a mark that guards the rest. Tagging does not conflict with anything else.
       */
      async setTags(conversationId: string, tagIds: string[]): Promise<'updated' | 'not_found' | 'unknown_tag'> {
        const mutation = newId('mutation');
        const ids = JSON.stringify(tagIds);
        const mine = `EXISTS (SELECT 1 FROM conversations WHERE workspace_id = ?1 AND id = ?2 AND last_mutation_id = ?3)`;
        const [update] = await d1.batch([
          d1
            .prepare(
              `UPDATE conversations SET last_mutation_id = ?3, updated_at = ${DB_NOW_MS}
                WHERE workspace_id = ?1 AND id = ?2
                  AND (SELECT COUNT(*) FROM tags WHERE workspace_id = ?1 AND id IN (SELECT value FROM json_each(?4))) = ?5`,
            )
            .bind(w, conversationId, mutation, ids, tagIds.length),
          d1.prepare(`DELETE FROM conversation_tags WHERE workspace_id = ?1 AND conversation_id = ?2 AND ${mine}`).bind(w, conversationId, mutation),
          d1
            .prepare(
              `INSERT INTO conversation_tags (workspace_id, conversation_id, tag_id, created_at)
               SELECT workspace_id, ?2, id, ${DB_NOW_MS} FROM tags WHERE workspace_id = ?1 AND id IN (SELECT value FROM json_each(?4)) AND ${mine}`,
            )
            .bind(w, conversationId, mutation, ids),
          d1
            .prepare(
              `INSERT INTO conversation_events (id, workspace_id, conversation_id, event_type, actor_type, actor_id, metadata_json, created_at)
               SELECT ?4, ?1, ?2, 'tags_changed', 'member', ?5, json_object('tagIds', json(?6)), ${DB_NOW_MS} WHERE ${mine}`,
            )
            .bind(w, conversationId, mutation, newId('event'), ctx.memberId, ids),
          d1
            .prepare(
              `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
               SELECT ?4, ?1, 'conversation.updated', ?2, json_object('conversationId', ?2), ${DB_NOW_MS} WHERE ${mine}`,
            )
            .bind(w, conversationId, mutation, newId('outbox')),
        ]);
        if (update?.meta.changes === 1) return 'updated';
        return (await this.get(conversationId)) ? 'unknown_tag' : 'not_found';
      },

      /** The database's clock, because update times come from it and a Worker's clock can disagree. */
      async now(): Promise<number> {
        return (await d1.prepare(`SELECT ${DB_NOW_MS} AS now`).first<{ now: number }>())!.now;
      },

      /** Positions only move forward, and stop at the last message. False if there is no such conversation. */
      /** Null when the conversation is not in this workspace. publicReadSeq is the only position a visitor may see. */
      async markRead(conversationId: string, input: { deliveredSeq: number; readSeq: number }): Promise<{ deliveredSeq: number; readSeq: number; publicReadSeq: number | null } | null> {
        return d1
          .prepare(
            `INSERT INTO conversation_read_cursors (workspace_id, conversation_id, reader_type, reader_id, delivered_seq, read_seq, updated_at)
             SELECT c.workspace_id, c.id, 'member', ?1, MIN(MAX(?2, ?3), c.last_message_seq), MIN(?3, c.last_message_seq), ${DB_NOW_MS}
               FROM conversations c WHERE c.workspace_id = ?4 AND c.id = ?5
             ON CONFLICT (workspace_id, conversation_id, reader_type, reader_id) DO UPDATE
               SET delivered_seq = MAX(delivered_seq, excluded.delivered_seq), read_seq = MAX(read_seq, excluded.read_seq), updated_at = excluded.updated_at
             RETURNING delivered_seq AS deliveredSeq, read_seq AS readSeq,
               (SELECT m.public_seq FROM messages m
                 WHERE m.workspace_id = conversation_read_cursors.workspace_id AND m.conversation_id = conversation_read_cursors.conversation_id
                   AND m.seq <= conversation_read_cursors.read_seq AND m.public_seq IS NOT NULL
                 ORDER BY m.seq DESC LIMIT 1) AS publicReadSeq`,
          )
          .bind(ctx.memberId, input.deliveredSeq, input.readSeq, w, conversationId)
          .first<{ deliveredSeq: number; readSeq: number; publicReadSeq: number | null }>();
      },
    },

    attachments: {
      /** Null when there is no such conversation here. Pending until its bytes are stored. */
      async begin(input: NewAttachment): Promise<boolean> {
        const result = await d1
          .prepare(
            `INSERT INTO attachments (id, workspace_id, conversation_id, storage_key, filename, content_type, size, status, uploaded_by_type, uploaded_by_id, created_at)
             SELECT ?1, workspace_id, id, ?2, ?3, ?4, ?5, 'pending', 'member', ?6, ${DB_NOW_MS} FROM conversations WHERE workspace_id = ?7 AND id = ?8`,
          )
          .bind(input.id, attachmentKey(w, input.conversationId, input.id), input.filename, input.contentType, input.size, ctx.memberId, w, input.conversationId)
          .run();
        return result.meta.changes === 1;
      },

      async finish(id: string): Promise<void> {
        await d1.prepare(`UPDATE attachments SET status = 'ready' WHERE workspace_id = ?1 AND id = ?2`).bind(w, id).run();
      },

      async abandon(id: string): Promise<void> {
        await d1.prepare(`DELETE FROM attachments WHERE workspace_id = ?1 AND id = ?2 AND message_id IS NULL`).bind(w, id).run();
      },

      /** Any file in this workspace, including those on notes. For agents only. */
      get(id: string): Promise<AttachmentRow | null> {
        return d1.prepare(`${ATTACHMENT_SELECT} WHERE workspace_id = ?1 AND id = ?2 AND status = 'ready'`).bind(w, id).first<AttachmentRow>();
      },
    },

    messages: {
      /**
       * Pattern 1: idempotent insert. Later statements are guarded by the fresh message ID, which
       * exists only if the insert took effect, so a replay or a wrong workspace changes nothing.
       */
      /** A message already sent with this client ID, so that a retry need not be translated again. */
      byClientId(conversationId: string, clientMessageId: string): Promise<StoredMessage | null> {
        return d1.prepare(`${MESSAGE_SELECT} WHERE m.workspace_id = ?1 AND m.conversation_id = ?2 AND m.client_message_id = ?3`).bind(w, conversationId, clientMessageId).first<StoredMessage>();
      },

      async send(input: SendMessageInput): Promise<SendResult> {
        const id = newId('message');
        const c = input.conversationId;
        const [insert] = await d1.batch(messageStatements(d1, { ...input, id, workspaceId: w }));

        const created = insert?.meta.changes === 1;
        const message = await d1
          .prepare(
            `${MESSAGE_SELECT} WHERE m.workspace_id = ?1 AND m.conversation_id = ?2 AND m.client_message_id = ?3`,
          )
          .bind(w, c, input.clientMessageId)
          .first<StoredMessage>();
        if (message) return { outcome: created ? 'created' : 'replayed', message };
        // Refused for its files, or there is no such conversation.
        if (input.attachmentIds?.length) {
          const exists = await d1.prepare(`SELECT 1 AS found FROM conversations WHERE workspace_id = ?1 AND id = ?2`).bind(w, c).first();
          if (exists) return { outcome: 'invalid_attachments' };
        }
        return { outcome: 'not_found' };
      },

      /** Everything, including internal notes. For agents only. Oldest first, whichever direction was asked for. */
      async list(conversationId: string, input: { afterSeq?: number | undefined; beforeSeq?: number | undefined; limit: number }): Promise<StoredMessage[]> {
        const backward = input.beforeSeq !== undefined;
        const { results } = await d1
          .prepare(
            `${MESSAGE_SELECT.replace(' FROM messages m', `, ${TRANSLATIONS_JSON} AS translationsJson FROM messages m`)}
              WHERE m.workspace_id = ?1 AND m.conversation_id = ?2 AND ${backward ? 'm.seq < ?3 ORDER BY m.seq DESC' : 'm.seq > ?3 ORDER BY m.seq'} LIMIT ?4`,
          )
          .bind(w, conversationId, backward ? input.beforeSeq : (input.afterSeq ?? 0), Math.min(input.limit, 100))
          .all<StoredMessage>();
        return backward ? results.reverse() : results;
      },

      listAfter(conversationId: string, afterSeq: number, limit = 50): Promise<StoredMessage[]> {
        return this.list(conversationId, { afterSeq, limit });
      },
    },
  };
}

export type Repositories = ReturnType<typeof repositories>;

/** Reads with no tenant, for the discovery document. Deliberately narrow. */
export async function getInstallation(database: Database) {
  return rawHandle(database)
    .prepare(`SELECT id, name, public_base_url AS publicBaseUrl, relay_disconnected_id AS relayDisconnectedId FROM installation LIMIT 1`)
    .first<{ id: string; name: string; publicBaseUrl: string; relayDisconnectedId: string | null }>();
}

/** Consumer idempotency. True if this caller claimed the key first. */
export async function claimJob(database: Database, key: string, jobType: string): Promise<boolean> {
  const result = await rawHandle(database)
    .prepare(
      `INSERT INTO job_receipts (idempotency_key, job_type, status, claimed_at)
       VALUES (?1, ?2, 'claimed', ${DB_NOW_MS}) ON CONFLICT (idempotency_key) DO NOTHING`,
    )
    .bind(key, jobType)
    .run();
  return result.meta.changes === 1;
}

export async function recordFailedJob(
  database: Database,
  input: { queue: string; jobType: string; idempotencyKey: string; workspaceId: string | null; attempts: number; envelopeJson: string },
): Promise<void> {
  await rawHandle(database)
    .prepare(
      `INSERT INTO failed_jobs (id, workspace_id, queue, job_type, idempotency_key, attempts, envelope_json, failed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ${DB_NOW_MS})`,
    )
    .bind(newId('failedJob'), input.workspaceId, input.queue, input.jobType, input.idempotencyKey, input.attempts, input.envelopeJson)
    .run();
}
