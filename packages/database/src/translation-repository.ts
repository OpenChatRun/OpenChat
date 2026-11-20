/**
 * Automatic translation (ADR-0024): the workspace's setting, the translations of messages, and the characters
 * translated per day. Translations are rows of their own, deleted with their message.
 */
import { newId } from '@openchat/shared';
import type { WorkspaceContext } from './context';
import { DB_NOW_MS, rawHandle, type Database } from './internal/handle';

export interface TranslationSettingsRow {
  enabled: boolean;
  /** NULL is the default model. */
  model: string | null;
}

export interface MessageForTranslation {
  id: string;
  conversationId: string;
  senderType: string;
  type: string;
  visibility: string;
  content: string;
  visitorLanguage: string | null;
  /** The languages it is already translated into. */
  languages: string[];
}

export interface TranslationRow {
  language: string;
  content: string;
  model: string;
}

/** The translations of a message, as JSON, for a query with messages as m. */
export const TRANSLATIONS_JSON = `(SELECT COALESCE(json_group_array(json_object('language', tr.language, 'content', tr.content)), '[]')
       FROM message_translations tr WHERE tr.workspace_id = m.workspace_id AND tr.message_id = m.id)`;

async function settingsOf(database: Database, workspaceId: string): Promise<TranslationSettingsRow> {
  const row = await rawHandle(database)
    .prepare(`SELECT translation_enabled AS enabled, translation_model AS model FROM workspaces WHERE id = ?1`)
    .bind(workspaceId)
    .first<{ enabled: number; model: string | null }>();
  return { enabled: row?.enabled === 1, model: row?.model ?? null };
}

/** For members: the setting, the day's usage, and asking for one message's translation. */
export function translationRepository(database: Database, ctx: WorkspaceContext) {
  const d1 = rawHandle(database);
  const w = ctx.workspaceId;
  return {
    settings: () => settingsOf(database, w),

    /** Audited when anything changes. */
    async setSettings(input: { enabled: boolean; model: string | null }): Promise<void> {
      const differs = `EXISTS (SELECT 1 FROM workspaces WHERE id = ?1 AND (translation_enabled <> ?2 OR translation_model IS NOT ?3))`;
      await d1.batch([
        d1
          .prepare(
            `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, target_type, target_id, metadata_json, created_at)
             SELECT ?4, ?1, 'user', (SELECT user_id FROM workspace_members WHERE id = ?5), 'translation.settings_changed', 'workspace', ?1,
                    json_object('enabled', CAST(?2 AS INTEGER), 'model', ?3), ${DB_NOW_MS}
              WHERE ${differs}`,
          )
          .bind(w, input.enabled ? 1 : 0, input.model, newId('audit'), ctx.memberId),
        d1
          .prepare(`UPDATE workspaces SET translation_enabled = ?2, translation_model = ?3, updated_at = ${DB_NOW_MS} WHERE id = ?1 AND ${differs}`)
          .bind(w, input.enabled ? 1 : 0, input.model),
      ]);
    },

    async charactersToday(day: string): Promise<number> {
      const row = await d1.prepare(`SELECT translated_chars AS n FROM assistant_usage WHERE workspace_id = ?1 AND day = ?2`).bind(w, day).first<{ n: number }>();
      return row?.n ?? 0;
    },

    /** A message of a conversation in this workspace, or null. */
    message: (conversationId: string, messageId: string) => messageForTranslation(database, w, messageId, conversationId),
  };
}

export type TranslationRepository = ReturnType<typeof translationRepository>;

// ---------- For the job, and for a member's request, after the caller has checked access ----------

export const translationSettingsFor = settingsOf;

export async function messageForTranslation(database: Database, workspaceId: string, messageId: string, conversationId?: string): Promise<MessageForTranslation | null> {
  const row = await rawHandle(database)
    .prepare(
      `SELECT m.id, m.conversation_id AS conversationId, m.sender_type AS senderType, m.message_type AS type, m.visibility, m.content,
              c.visitor_language AS visitorLanguage,
              (SELECT COALESCE(json_group_array(tr.language), '[]') FROM message_translations tr WHERE tr.workspace_id = m.workspace_id AND tr.message_id = m.id) AS languagesJson
         FROM messages m JOIN conversations c ON c.workspace_id = m.workspace_id AND c.id = m.conversation_id
        WHERE m.workspace_id = ?1 AND m.id = ?2 AND (?3 IS NULL OR m.conversation_id = ?3)`,
    )
    .bind(workspaceId, messageId, conversationId ?? null)
    .first<Omit<MessageForTranslation, 'languages'> & { languagesJson: string }>();
  if (!row) return null;
  const { languagesJson, ...rest } = row;
  return { ...rest, languages: JSON.parse(languagesJson) as string[] };
}

/** The languages the workspace's active members read, most readers first. */
export async function memberLanguages(database: Database, workspaceId: string): Promise<string[]> {
  const { results } = await rawHandle(database)
    .prepare(
      `SELECT u.language FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ?1 AND m.status = 'active' AND m.removed_at IS NULL AND u.disabled_at IS NULL AND u.language IS NOT NULL
        GROUP BY u.language ORDER BY COUNT(*) DESC, u.language`,
    )
    .bind(workspaceId)
    .all<{ language: string }>();
  return results.map((r) => r.language);
}

/** Counts `characters` against the day's limit, before the model is called. False, and nothing counted, if over it. */
export async function takeTranslationCharacters(database: Database, workspaceId: string, day: string, characters: number, limit: number): Promise<boolean> {
  if (characters > limit) return false;
  const row = await rawHandle(database)
    .prepare(
      `INSERT INTO assistant_usage (workspace_id, day, translated_chars) VALUES (?1, ?2, ?3)
       ON CONFLICT (workspace_id, day) DO UPDATE SET translated_chars = translated_chars + excluded.translated_chars
        WHERE translated_chars + excluded.translated_chars <= ?4
       RETURNING translated_chars`,
    )
    .bind(workspaceId, day, characters, limit)
    .first<{ translated_chars: number }>();
  return row !== null;
}

/** Kept only while the message exists. A translation already there stays: the first one stored is the one shown. */
export async function saveTranslation(database: Database, workspaceId: string, messageId: string, translation: TranslationRow): Promise<void> {
  await rawHandle(database)
    .prepare(
      `INSERT INTO message_translations (workspace_id, message_id, language, content, model, created_at)
       SELECT workspace_id, id, ?3, ?4, ?5, ${DB_NOW_MS} FROM messages WHERE workspace_id = ?1 AND id = ?2
       ON CONFLICT (workspace_id, message_id, language) DO NOTHING`,
    )
    .bind(workspaceId, messageId, translation.language, translation.content, translation.model)
    .run();
}

export async function translationOf(database: Database, workspaceId: string, messageId: string, language: string): Promise<TranslationRow | null> {
  return rawHandle(database)
    .prepare(`SELECT language, content, model FROM message_translations WHERE workspace_id = ?1 AND message_id = ?2 AND language = ?3`)
    .bind(workspaceId, messageId, language)
    .first<TranslationRow>();
}
