/**
 * The help centre (ADR-0023). helpRepository is scoped by a WorkspaceContext, for supervisors and agents.
 * publicHelpRepository is what visitors reach, by a website's help slug, and it only ever reads published
 * articles.
 *
 * Every change a visitor could see bumps websites.help_version in the same batch. Public pages are cached under
 * that version, so a change shows at once and nothing stale is served.
 */
import { newId } from '@openchat/shared';
import type { WorkspaceContext } from './context';
import { helpArticleUnindexStatements, queueHelpAssistantSync } from './help-assistant';
import { DB_NOW_MS, rawHandle, type Database } from './internal/handle';

export type HelpArticleStatus = 'draft' | 'published';

export interface HelpSettingsRow {
  websiteId: string;
  websiteName: string;
  helpSlug: string | null;
  helpNoindex: number;
}

export interface HelpCollectionRow {
  id: string;
  websiteId: string;
  language: string;
  name: string;
  slug: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface HelpArticleSummaryRow {
  id: string;
  websiteId: string;
  collectionId: string | null;
  translationGroupId: string;
  language: string;
  slug: string;
  title: string;
  summary: string;
  status: HelpArticleStatus;
  position: number;
  version: number;
  publishedAt: number | null;
  aiDrafted: number;
  /** Times it was opened while published, and the answers to "Was this helpful?". */
  views: number;
  helpful: number;
  notHelpful: number;
  createdAt: number;
  updatedAt: number;
}

export interface HelpArticleRow extends HelpArticleSummaryRow {
  bodyMarkdown: string;
  bodyHtml: string;
  aiSourcesJson: string | null;
}

export type HelpDraftStatus = 'uploading' | 'queued' | 'reading' | 'writing' | 'done' | 'failed';

export interface HelpDraftRunRow {
  id: string;
  workspaceId: string;
  websiteId: string;
  language: string;
  collectionId: string | null;
  readWebsite: number;
  linksJson: string;
  filesJson: string;
  status: HelpDraftStatus;
  errorCode: string | null;
  outlineJson: string | null;
  planned: number;
  failedJson: string;
  materialChars: number;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  /** Articles written so far. */
  written: number;
}

/** What may go into one run (ADR-0023). */
export const HELP_DRAFT_LIMITS = {
  links: 10,
  files: 10,
  fileBytes: 10 * 1024 * 1024,
  materialChars: 200_000,
  articles: 20,
  /** Runs still open after this are stopped by the sweep, and their files removed. */
  openMs: 60 * 60 * 1000,
} as const;

export const HELP_DRAFT_TOPIC = 'help.draft_started';

/** Where a run keeps its files and its material while it runs. Removed when it ends. */
export const helpDraftPrefix = (runId: string) => `help-draft/${runId}/`;

/** What is stored for an article's text: the source and everything derived from it. */
export interface HelpArticleText {
  title: string;
  summary: string;
  bodyMarkdown: string;
  bodyHtml: string;
  searchTitle: string;
  searchText: string;
}

export interface HelpAssetRow {
  id: string;
  websiteId: string;
  contentType: string;
  sizeBytes: number;
  filename: string;
  createdAt: number;
}

export const HELP_LIMITS = {
  articlesPerWebsite: 1_000,
  collectionsPerWebsite: 100,
  assetsPerWebsite: 2_000,
} as const;

/** The R2 key of a help image. Not under a workspace prefix: the ID is unique, and the row says whose it is. */
export const helpAssetKey = (assetId: string) => `help/${assetId}`;

/** True if D1 refused a write because a unique index already holds the value. */
export const isUniqueViolation = (error: unknown) => error instanceof Error && /UNIQUE constraint failed/i.test(error.message);

const COLLECTION_COLUMNS = `id, website_id AS websiteId, language, name, slug, position, created_at AS createdAt, updated_at AS updatedAt`;
const SUMMARY_COLUMNS = `id, website_id AS websiteId, collection_id AS collectionId, translation_group_id AS translationGroupId, language, slug,
  title, summary, status, position, version, published_at AS publishedAt, ai_drafted AS aiDrafted, created_at AS createdAt, updated_at AS updatedAt,
  COALESCE((SELECT s.views FROM help_article_stats s WHERE s.workspace_id = help_articles.workspace_id AND s.article_id = help_articles.id), 0) AS views,
  COALESCE((SELECT s.helpful FROM help_article_stats s WHERE s.workspace_id = help_articles.workspace_id AND s.article_id = help_articles.id), 0) AS helpful,
  COALESCE((SELECT s.not_helpful FROM help_article_stats s WHERE s.workspace_id = help_articles.workspace_id AND s.article_id = help_articles.id), 0) AS notHelpful`;
const ARTICLE_COLUMNS = `${SUMMARY_COLUMNS}, body_markdown AS bodyMarkdown, body_html AS bodyHtml, ai_sources_json AS aiSourcesJson`;
const RUN_COLUMNS = `r.id, r.workspace_id AS workspaceId, r.website_id AS websiteId, r.language, r.collection_id AS collectionId, r.read_website AS readWebsite,
  r.links_json AS linksJson, r.files_json AS filesJson, r.status, r.error_code AS errorCode, r.outline_json AS outlineJson, r.planned,
  r.failed_json AS failedJson, r.material_chars AS materialChars, r.created_at AS createdAt, r.updated_at AS updatedAt, r.finished_at AS finishedAt,
  (SELECT COUNT(*) FROM help_articles a WHERE a.workspace_id = r.workspace_id AND a.draft_run_id = r.id) AS written`;
const OPEN_RUN = `status NOT IN ('done', 'failed')`;
const ASSET_COLUMNS = `id, website_id AS websiteId, content_type AS contentType, size_bytes AS sizeBytes, filename, created_at AS createdAt`;

export function helpRepository(database: Database, ctx: WorkspaceContext) {
  const d1 = rawHandle(database);
  const w = ctx.workspaceId;
  const bump = (websiteId: string) =>
    d1.prepare(`UPDATE websites SET help_version = help_version + 1, updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND id = ?2`).bind(w, websiteId);
  const audit = (action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) =>
    d1
      .prepare(
        `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?1, ?2, 'user', (SELECT user_id FROM workspace_members WHERE id = ?3), ?4, ?5, ?6, ?7, ${DB_NOW_MS}`,
      )
      .bind(newId('audit'), w, ctx.memberId, action, targetType, targetId, JSON.stringify(metadata));

  return {
    async settings(websiteId: string): Promise<HelpSettingsRow | null> {
      return d1
        .prepare(`SELECT id AS websiteId, name AS websiteName, help_slug AS helpSlug, help_noindex AS helpNoindex FROM websites WHERE workspace_id = ?1 AND id = ?2`)
        .bind(w, websiteId)
        .first<HelpSettingsRow>();
    },

    /** Throws on a slug another website has; see isUniqueViolation. Audited when the address changes. */
    async saveSettings(websiteId: string, input: { helpSlug: string | null; helpNoindex: boolean }): Promise<HelpSettingsRow | null> {
      const changed = `(help_slug IS NOT ?3)`;
      await d1.batch([
        d1
          .prepare(
            `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, target_type, target_id, metadata_json, created_at)
             SELECT ?4, ?1, 'user', (SELECT user_id FROM workspace_members WHERE id = ?5), 'help.address_changed', 'website', ?2,
                    json_object('from', help_slug, 'to', ?3), ${DB_NOW_MS}
               FROM websites WHERE workspace_id = ?1 AND id = ?2 AND ${changed}`,
          )
          .bind(w, websiteId, input.helpSlug, newId('audit'), ctx.memberId),
        d1
          .prepare(
            `UPDATE websites SET help_slug = ?3, help_noindex = ?4, help_version = help_version + 1, updated_at = ${DB_NOW_MS}
              WHERE workspace_id = ?1 AND id = ?2`,
          )
          .bind(w, websiteId, input.helpSlug, input.helpNoindex ? 1 : 0),
      ]);
      return this.settings(websiteId);
    },

    async collections(websiteId: string): Promise<HelpCollectionRow[]> {
      const { results } = await d1
        .prepare(`SELECT ${COLLECTION_COLUMNS} FROM help_collections WHERE workspace_id = ?1 AND website_id = ?2 ORDER BY language, position, name, id`)
        .bind(w, websiteId)
        .all<HelpCollectionRow>();
      return results;
    },

    async collection(collectionId: string): Promise<HelpCollectionRow | null> {
      return d1.prepare(`SELECT ${COLLECTION_COLUMNS} FROM help_collections WHERE workspace_id = ?1 AND id = ?2`).bind(w, collectionId).first<HelpCollectionRow>();
    },

    /** Null if the website is not here, or has as many collections as it may. Throws on a slug in use. */
    async createCollection(websiteId: string, input: { language: string; name: string; slug: string }): Promise<HelpCollectionRow | null> {
      const id = newId('helpCollection');
      const [inserted] = await d1.batch([
        d1
          .prepare(
            `INSERT INTO help_collections (id, workspace_id, website_id, language, name, slug, position, created_at, updated_at)
             SELECT ?3, ?1, ?2, ?4, ?5, ?6,
                    (SELECT COALESCE(MAX(position), -1) + 1 FROM help_collections WHERE workspace_id = ?1 AND website_id = ?2 AND language = ?4),
                    ${DB_NOW_MS}, ${DB_NOW_MS}
              WHERE EXISTS (SELECT 1 FROM websites WHERE workspace_id = ?1 AND id = ?2)
                AND (SELECT COUNT(*) FROM help_collections WHERE workspace_id = ?1 AND website_id = ?2) < ${HELP_LIMITS.collectionsPerWebsite}`,
          )
          .bind(w, websiteId, id, input.language, input.name, input.slug),
        bump(websiteId),
      ]);
      return inserted!.meta.changes ? this.collection(id) : null;
    },

    async updateCollection(collectionId: string, input: { name?: string | undefined; slug?: string | undefined; position?: number | undefined }): Promise<HelpCollectionRow | null> {
      const [updated] = await d1.batch([
        d1
          .prepare(
            `UPDATE help_collections SET name = COALESCE(?3, name), slug = COALESCE(?4, slug), position = COALESCE(?5, position), updated_at = ${DB_NOW_MS}
              WHERE workspace_id = ?1 AND id = ?2`,
          )
          .bind(w, collectionId, input.name ?? null, input.slug ?? null, input.position ?? null),
        d1
          .prepare(`UPDATE websites SET help_version = help_version + 1 WHERE workspace_id = ?1 AND id = (SELECT website_id FROM help_collections WHERE workspace_id = ?1 AND id = ?2)`)
          .bind(w, collectionId),
      ]);
      return updated!.meta.changes ? this.collection(collectionId) : null;
    },

    /** Its articles stay, outside any collection. False if it was not here. */
    async deleteCollection(collectionId: string): Promise<boolean> {
      const results = await d1.batch([
        d1
          .prepare(`UPDATE websites SET help_version = help_version + 1 WHERE workspace_id = ?1 AND id = (SELECT website_id FROM help_collections WHERE workspace_id = ?1 AND id = ?2)`)
          .bind(w, collectionId),
        d1.prepare(`UPDATE help_articles SET collection_id = NULL, updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND collection_id = ?2`).bind(w, collectionId),
        d1.prepare(`DELETE FROM help_collections WHERE workspace_id = ?1 AND id = ?2`).bind(w, collectionId),
      ]);
      return results[2]!.meta.changes > 0;
    },

    async articles(websiteId: string): Promise<HelpArticleSummaryRow[]> {
      const { results } = await d1
        .prepare(`SELECT ${SUMMARY_COLUMNS} FROM help_articles WHERE workspace_id = ?1 AND website_id = ?2 ORDER BY language, position, title, id`)
        .bind(w, websiteId)
        .all<HelpArticleSummaryRow>();
      return results;
    },

    async article(articleId: string): Promise<HelpArticleRow | null> {
      return d1.prepare(`SELECT ${ARTICLE_COLUMNS} FROM help_articles WHERE workspace_id = ?1 AND id = ?2`).bind(w, articleId).first<HelpArticleRow>();
    },

    /** Slugs in use in one website and language that start with this one, so that a free one can be chosen. */
    async slugsLike(websiteId: string, language: string, table: 'help_articles' | 'help_collections', base: string): Promise<string[]> {
      const { results } = await d1
        .prepare(`SELECT slug FROM ${table} WHERE website_id = ?1 AND language = ?2 AND workspace_id = ?3 AND substr(slug, 1, length(?4)) = ?4`)
        .bind(websiteId, language, w, base)
        .all<{ slug: string }>();
      return results.map((row) => row.slug);
    },

    /**
     * Null if the website is not here, it is full, or the collection is not one of its own in that language.
     * Throws on a slug in use.
     */
    async createArticle(
      websiteId: string,
      input: HelpArticleText & { language: string; slug: string; collectionId: string | null; translationGroupId: string | null },
    ): Promise<HelpArticleRow | null> {
      const id = newId('helpArticle');
      const [inserted] = await d1.batch([
        d1
          .prepare(
            `INSERT INTO help_articles (id, workspace_id, website_id, collection_id, translation_group_id, language, slug, title, summary,
                                        body_markdown, body_html, search_title, search_text, position, updated_by_member_id, created_at, updated_at)
             SELECT ?3, ?1, ?2, ?4, COALESCE(?5, ?3), ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                    (SELECT COALESCE(MAX(position), -1) + 1 FROM help_articles WHERE workspace_id = ?1 AND website_id = ?2 AND language = ?6),
                    ?14, ${DB_NOW_MS}, ${DB_NOW_MS}
              WHERE EXISTS (SELECT 1 FROM websites WHERE workspace_id = ?1 AND id = ?2)
                AND (SELECT COUNT(*) FROM help_articles WHERE workspace_id = ?1 AND website_id = ?2) < ${HELP_LIMITS.articlesPerWebsite}
                AND (?4 IS NULL OR EXISTS (SELECT 1 FROM help_collections WHERE workspace_id = ?1 AND id = ?4 AND website_id = ?2 AND language = ?6))
                AND (?5 IS NULL OR EXISTS (SELECT 1 FROM help_articles WHERE workspace_id = ?1 AND translation_group_id = ?5 AND website_id = ?2))`,
          )
          .bind(
            w,
            websiteId,
            id,
            input.collectionId,
            input.translationGroupId,
            input.language,
            input.slug,
            input.title,
            input.summary,
            input.bodyMarkdown,
            input.bodyHtml,
            input.searchTitle,
            input.searchText,
            ctx.memberId,
          ),
        bump(websiteId),
      ]);
      return inserted!.meta.changes ? this.article(id) : null;
    },

    /**
     * Changes an article if it is still at `expectedVersion`. Null if it is not here, has moved on, or the collection
     * is not one of its website's in its language. Throws on a slug in use.
     */
    async updateArticle(
      articleId: string,
      expectedVersion: number,
      input: Partial<HelpArticleText> & { slug?: string | undefined; collectionId?: string | null | undefined; position?: number | undefined },
    ): Promise<HelpArticleRow | null> {
      const moveCollection = input.collectionId !== undefined ? 1 : 0;
      const [updated] = await d1.batch([
        d1
          .prepare(
            `UPDATE help_articles
                SET title = COALESCE(?4, title), summary = COALESCE(?5, summary), body_markdown = COALESCE(?6, body_markdown),
                    body_html = COALESCE(?7, body_html), search_title = COALESCE(?8, search_title), search_text = COALESCE(?9, search_text),
                    slug = COALESCE(?10, slug), position = COALESCE(?11, position),
                    collection_id = CASE WHEN ?12 = 1 THEN ?13 ELSE collection_id END,
                    ai_drafted = CASE WHEN COALESCE(?4, ?5, ?6) IS NULL THEN ai_drafted ELSE 0 END,
                    version = version + 1, updated_by_member_id = ?14, updated_at = ${DB_NOW_MS}
              WHERE workspace_id = ?1 AND id = ?2 AND version = ?3
                AND (?12 = 0 OR ?13 IS NULL OR EXISTS (SELECT 1 FROM help_collections c WHERE c.workspace_id = ?1 AND c.id = ?13
                                                         AND c.website_id = help_articles.website_id AND c.language = help_articles.language))`,
          )
          .bind(
            w,
            articleId,
            expectedVersion,
            input.title ?? null,
            input.summary ?? null,
            input.bodyMarkdown ?? null,
            input.bodyHtml ?? null,
            input.searchTitle ?? null,
            input.searchText ?? null,
            input.slug ?? null,
            input.position ?? null,
            moveCollection,
            input.collectionId ?? null,
            ctx.memberId,
          ),
        d1
          .prepare(`UPDATE websites SET help_version = help_version + 1 WHERE workspace_id = ?1 AND id = (SELECT website_id FROM help_articles WHERE workspace_id = ?1 AND id = ?2)`)
          .bind(w, articleId),
        // The assistant keeps answering from the version before until this one is indexed.
        queueHelpAssistantSync(d1, w, articleId, `a.status = 'published'`),
      ]);
      return updated!.meta.changes ? this.article(articleId) : null;
    },

    /** Publishes or unpublishes, audited when it changes. Null if the article is not here. */
    async setStatus(articleId: string, status: HelpArticleStatus): Promise<HelpArticleRow | null> {
      const differs = `status <> ?3`;
      await d1.batch([
        d1
          .prepare(
            `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, target_type, target_id, metadata_json, created_at)
             SELECT ?4, ?1, 'user', (SELECT user_id FROM workspace_members WHERE id = ?5),
                    CASE ?3 WHEN 'published' THEN 'help.article_published' ELSE 'help.article_unpublished' END,
                    'help_article', id, json_object('title', title, 'language', language), ${DB_NOW_MS}
               FROM help_articles WHERE workspace_id = ?1 AND id = ?2 AND ${differs}`,
          )
          .bind(w, articleId, status, newId('audit'), ctx.memberId),
        // Unpublished: out of the assistant at once. These run before the status changes, while it still differs.
        ...helpArticleUnindexStatements(d1, w, articleId, `${status === 'draft' ? '1' : '0'} = 1 AND status <> 'draft'`),
        d1
          .prepare(`UPDATE websites SET help_version = help_version + 1 WHERE workspace_id = ?1 AND id = (SELECT website_id FROM help_articles WHERE workspace_id = ?1 AND id = ?2 AND ${differs})`)
          .bind(w, articleId, status),
        d1
          .prepare(
            `UPDATE help_articles SET status = ?3, published_at = CASE ?3 WHEN 'published' THEN ${DB_NOW_MS} END,
                    version = version + 1, updated_by_member_id = ?4, updated_at = ${DB_NOW_MS}
              WHERE workspace_id = ?1 AND id = ?2 AND ${differs}`,
          )
          .bind(w, articleId, status, ctx.memberId),
        queueHelpAssistantSync(d1, w, articleId, `a.status = 'published' AND ?3 = 'published'`, status),
      ]);
      return this.article(articleId);
    },

    /** Audited. False if it was not here. */
    async deleteArticle(articleId: string): Promise<boolean> {
      const article = await this.article(articleId);
      if (!article) return false;
      const results = await d1.batch([
        audit('help.article_deleted', 'help_article', articleId, { title: article.title, language: article.language }),
        bump(article.websiteId),
        // Its chunks go by cascade.
        helpArticleUnindexStatements(d1, w, articleId)[0]!,
        d1.prepare(`DELETE FROM help_articles WHERE workspace_id = ?1 AND id = ?2`).bind(w, articleId),
      ]);
      return results[3]!.meta.changes > 0;
    },

    async assets(websiteId: string): Promise<HelpAssetRow[]> {
      const { results } = await d1
        .prepare(`SELECT ${ASSET_COLUMNS} FROM help_assets WHERE workspace_id = ?1 AND website_id = ?2 ORDER BY created_at DESC, id DESC`)
        .bind(w, websiteId)
        .all<HelpAssetRow>();
      return results;
    },

    async asset(assetId: string): Promise<HelpAssetRow | null> {
      return d1.prepare(`SELECT ${ASSET_COLUMNS} FROM help_assets WHERE workspace_id = ?1 AND id = ?2`).bind(w, assetId).first<HelpAssetRow>();
    },

    /** Recorded after the file is in R2. Null if the website is not here, or is full. */
    async addAsset(websiteId: string, input: { id: string; contentType: string; sizeBytes: number; filename: string }): Promise<HelpAssetRow | null> {
      const result = await d1
        .prepare(
          `INSERT INTO help_assets (id, workspace_id, website_id, content_type, size_bytes, filename, created_by_member_id, created_at)
           SELECT ?3, ?1, ?2, ?4, ?5, ?6, ?7, ${DB_NOW_MS}
            WHERE EXISTS (SELECT 1 FROM websites WHERE workspace_id = ?1 AND id = ?2)
              AND (SELECT COUNT(*) FROM help_assets WHERE workspace_id = ?1 AND website_id = ?2) < ${HELP_LIMITS.assetsPerWebsite}`,
        )
        .bind(w, websiteId, input.id, input.contentType, input.sizeBytes, input.filename, ctx.memberId)
        .run();
      return result.meta.changes ? this.asset(input.id) : null;
    },

    async deleteAsset(assetId: string): Promise<boolean> {
      const result = await d1.prepare(`DELETE FROM help_assets WHERE workspace_id = ?1 AND id = ?2`).bind(w, assetId).run();
      return result.meta.changes > 0;
    },

    // ---------- Draft with AI ----------

    async draftRuns(websiteId: string, limit = 10): Promise<HelpDraftRunRow[]> {
      const { results } = await d1
        .prepare(`SELECT ${RUN_COLUMNS} FROM help_draft_runs r WHERE r.workspace_id = ?1 AND r.website_id = ?2 ORDER BY r.created_at DESC, r.id DESC LIMIT ?3`)
        .bind(w, websiteId, limit)
        .all<HelpDraftRunRow>();
      return results;
    },

    async draftRun(runId: string): Promise<HelpDraftRunRow | null> {
      return d1.prepare(`SELECT ${RUN_COLUMNS} FROM help_draft_runs r WHERE r.workspace_id = ?1 AND r.id = ?2`).bind(w, runId).first<HelpDraftRunRow>();
    },

    /**
     * Null if the website is not here, already has a run open, or the workspace has started `perDay` runs since
     * `dayStart`. The caller tells which.
     */
    async createDraftRun(
      websiteId: string,
      input: { language: string; collectionId: string | null; readWebsite: boolean; links: string[] },
      perDay: number,
      dayStart: number,
    ): Promise<HelpDraftRunRow | null> {
      const id = newId('helpDraftRun');
      const result = await d1
        .prepare(
          `INSERT INTO help_draft_runs (id, workspace_id, website_id, language, collection_id, read_website, links_json, created_by_member_id, created_at, updated_at)
           SELECT ?3, ?1, ?2, ?4, ?5, ?6, ?7, ?8, ${DB_NOW_MS}, ${DB_NOW_MS}
            WHERE EXISTS (SELECT 1 FROM websites WHERE workspace_id = ?1 AND id = ?2)
              AND NOT EXISTS (SELECT 1 FROM help_draft_runs WHERE workspace_id = ?1 AND website_id = ?2 AND ${OPEN_RUN})
              AND (SELECT COUNT(*) FROM help_draft_runs WHERE workspace_id = ?1 AND created_at >= ?9) < ?10`,
        )
        .bind(w, websiteId, id, input.language, input.collectionId, input.readWebsite ? 1 : 0, JSON.stringify(input.links), ctx.memberId, dayStart, perDay)
        .run();
      return result.meta.changes ? this.draftRun(id) : null;
    },

    async openDraftRun(websiteId: string): Promise<boolean> {
      return (await d1.prepare(`SELECT 1 AS yes FROM help_draft_runs WHERE workspace_id = ?1 AND website_id = ?2 AND ${OPEN_RUN}`).bind(w, websiteId).first()) !== null;
    },

    /** Adds a file's name to a run still taking files, at position `index`. False if it is not, or is full. */
    async addDraftFile(runId: string, index: number, file: { name: string; contentType: string; sizeBytes: number }): Promise<boolean> {
      const result = await d1
        .prepare(
          `UPDATE help_draft_runs SET files_json = json_insert(files_json, '$[#]', json(?3)), updated_at = ${DB_NOW_MS}
            WHERE workspace_id = ?1 AND id = ?2 AND status = 'uploading' AND json_array_length(files_json) = ?4 AND ?4 < ${HELP_DRAFT_LIMITS.files}`,
        )
        .bind(w, runId, JSON.stringify(file), index)
        .run();
      return result.meta.changes > 0;
    },

    /** Queues a run that is taking files, with its outbox row. False if it is not. */
    async startDraftRun(runId: string): Promise<boolean> {
      const [updated] = await d1.batch([
        d1.prepare(`UPDATE help_draft_runs SET status = 'queued', updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND id = ?2 AND status = 'uploading'`).bind(w, runId),
        d1
          .prepare(
            `INSERT INTO outbox (id, workspace_id, topic, aggregate_id, payload_json, created_at)
             SELECT ?3, ?1, '${HELP_DRAFT_TOPIC}', ?2, '{}', ${DB_NOW_MS} WHERE changes() = 1`,
          )
          .bind(w, runId, newId('outbox')),
      ]);
      return updated!.meta.changes > 0;
    },
  };
}

// ---------- Draft with AI, from its jobs ----------

export async function helpDraftRunForJob(database: Database, workspaceId: string, runId: string): Promise<HelpDraftRunRow | null> {
  return rawHandle(database).prepare(`SELECT ${RUN_COLUMNS} FROM help_draft_runs r WHERE r.workspace_id = ?1 AND r.id = ?2`).bind(workspaceId, runId).first<HelpDraftRunRow>();
}

/** The website a run drafts for, as a job reads it: its name for the model, and where pages may be read. */
export async function helpDraftWebsite(database: Database, workspaceId: string, websiteId: string): Promise<{ name: string; allowedOrigins: string[] } | null> {
  const row = await rawHandle(database)
    .prepare(`SELECT name, allowed_origins_json AS originsJson FROM websites WHERE workspace_id = ?1 AND id = ?2`)
    .bind(workspaceId, websiteId)
    .first<{ name: string; originsJson: string }>();
  return row ? { name: row.name, allowedOrigins: JSON.parse(row.originsJson) as string[] } : null;
}

export async function helpCollectionName(database: Database, workspaceId: string, collectionId: string): Promise<string | null> {
  return (await rawHandle(database).prepare(`SELECT name FROM help_collections WHERE workspace_id = ?1 AND id = ?2`).bind(workspaceId, collectionId).first<{ name: string }>())?.name ?? null;
}

/** Moves a run on, if it is in one of `from`. False if it was not. */
export async function moveHelpDraftRun(
  database: Database,
  workspaceId: string,
  runId: string,
  from: HelpDraftStatus[],
  to: HelpDraftStatus,
  patch: { errorCode?: string; outlineJson?: string; planned?: number; materialChars?: number } = {},
): Promise<boolean> {
  const ends = to === 'done' || to === 'failed';
  const result = await rawHandle(database)
    .prepare(
      `UPDATE help_draft_runs SET status = ?3, error_code = COALESCE(?4, error_code), outline_json = COALESCE(?5, outline_json),
              planned = COALESCE(?6, planned), material_chars = COALESCE(?7, material_chars), updated_at = ${DB_NOW_MS},
              finished_at = ${ends ? DB_NOW_MS : 'finished_at'}
        WHERE workspace_id = ?1 AND id = ?2 AND status IN (${from.map((f) => `'${f}'`).join(', ')})`,
    )
    .bind(workspaceId, runId, to, patch.errorCode ?? null, patch.outlineJson ?? null, patch.planned ?? null, patch.materialChars ?? null)
    .run();
  return result.meta.changes > 0;
}

/** Slugs taken in a website and language that start with `base`. */
export async function helpSlugsLike(database: Database, workspaceId: string, websiteId: string, language: string, table: 'help_articles' | 'help_collections', base: string): Promise<string[]> {
  const { results } = await rawHandle(database)
    .prepare(`SELECT slug FROM ${table} WHERE website_id = ?1 AND language = ?2 AND workspace_id = ?3 AND substr(slug, 1, length(?4)) = ?4`)
    .bind(websiteId, language, workspaceId, base)
    .all<{ slug: string }>();
  return results.map((row) => row.slug);
}

/** A collection in this language by name, ignoring case, or a new one. Null if the website has as many as it may. */
export async function helpCollectionForDraft(database: Database, workspaceId: string, websiteId: string, language: string, name: string, slug: string): Promise<string | null> {
  const d1 = rawHandle(database);
  const find = () =>
    d1
      .prepare(`SELECT id FROM help_collections WHERE workspace_id = ?1 AND website_id = ?2 AND language = ?3 AND lower(name) = lower(?4) ORDER BY position, id LIMIT 1`)
      .bind(workspaceId, websiteId, language, name)
      .first<{ id: string }>();
  const found = await find();
  if (found) return found.id;
  const id = newId('helpCollection');
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO help_collections (id, workspace_id, website_id, language, name, slug, position, created_at, updated_at)
         SELECT ?3, ?1, ?2, ?4, ?5, ?6,
                (SELECT COALESCE(MAX(position), -1) + 1 FROM help_collections WHERE workspace_id = ?1 AND website_id = ?2 AND language = ?4),
                ${DB_NOW_MS}, ${DB_NOW_MS}
          WHERE (SELECT COUNT(*) FROM help_collections WHERE workspace_id = ?1 AND website_id = ?2) < ${HELP_LIMITS.collectionsPerWebsite}`,
      )
      .bind(workspaceId, websiteId, id, language, name, slug),
    d1.prepare(`UPDATE websites SET help_version = help_version + 1 WHERE workspace_id = ?1 AND id = ?2`).bind(workspaceId, websiteId),
  ]);
  return (await find())?.id ?? null;
}

/**
 * A drafted article, as a draft. Null if the website is full. Throws on a slug in use, or on this outline position
 * written already (both unique violations; the caller looks again to tell which).
 */
export async function insertHelpDraftedArticle(
  database: Database,
  workspaceId: string,
  run: { id: string; websiteId: string; language: string },
  index: number,
  input: HelpArticleText & { slug: string; collectionId: string | null; sourcesJson: string },
): Promise<boolean> {
  const d1 = rawHandle(database);
  const id = newId('helpArticle');
  const [inserted] = await d1.batch([
    d1
      .prepare(
        `INSERT INTO help_articles (id, workspace_id, website_id, collection_id, translation_group_id, language, slug, title, summary,
                                    body_markdown, body_html, search_title, search_text, position, draft_run_id, draft_index, ai_drafted,
                                    ai_sources_json, created_at, updated_at)
         SELECT ?3, ?1, ?2, CASE WHEN EXISTS (SELECT 1 FROM help_collections WHERE workspace_id = ?1 AND id = ?4 AND website_id = ?2 AND language = ?5) THEN ?4 END,
                ?3, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                (SELECT COALESCE(MAX(position), -1) + 1 FROM help_articles WHERE workspace_id = ?1 AND website_id = ?2 AND language = ?5),
                ?13, ?14, 1, ?15, ${DB_NOW_MS}, ${DB_NOW_MS}
          WHERE (SELECT COUNT(*) FROM help_articles WHERE workspace_id = ?1 AND website_id = ?2) < ${HELP_LIMITS.articlesPerWebsite}`,
      )
      .bind(
        workspaceId,
        run.websiteId,
        id,
        input.collectionId,
        run.language,
        input.slug,
        input.title,
        input.summary,
        input.bodyMarkdown,
        input.bodyHtml,
        input.searchTitle,
        input.searchText,
        run.id,
        index,
        input.sourcesJson,
      ),
    d1.prepare(`UPDATE websites SET help_version = help_version + 1 WHERE workspace_id = ?1 AND id = ?2`).bind(workspaceId, run.websiteId),
    d1.prepare(`UPDATE help_draft_runs SET updated_at = ${DB_NOW_MS} WHERE workspace_id = ?1 AND id = ?2`).bind(workspaceId, run.id),
  ]);
  return inserted!.meta.changes > 0;
}

export async function helpDraftWritten(database: Database, workspaceId: string, runId: string, index: number): Promise<boolean> {
  return (await rawHandle(database).prepare(`SELECT 1 AS yes FROM help_articles WHERE workspace_id = ?1 AND draft_run_id = ?2 AND draft_index = ?3`).bind(workspaceId, runId, index).first()) !== null;
}

/** Records an outline position that could not be written. Once only, however often it is repeated. */
export async function recordHelpDraftFailure(database: Database, workspaceId: string, runId: string, index: number): Promise<void> {
  await rawHandle(database)
    .prepare(
      `UPDATE help_draft_runs SET failed_json = json_insert(failed_json, '$[#]', ?3), updated_at = ${DB_NOW_MS}
        WHERE workspace_id = ?1 AND id = ?2 AND NOT EXISTS (SELECT 1 FROM json_each(failed_json) WHERE value = ?3)`,
    )
    .bind(workspaceId, runId, index)
    .run();
}

/** Ends a writing run once every position is written or failed. True for the one call that ended it. */
export async function finishHelpDraftRunIfComplete(database: Database, workspaceId: string, runId: string): Promise<boolean> {
  const result = await rawHandle(database)
    .prepare(
      `UPDATE help_draft_runs SET status = 'done', updated_at = ${DB_NOW_MS}, finished_at = ${DB_NOW_MS}
        WHERE workspace_id = ?1 AND id = ?2 AND status = 'writing'
          AND (SELECT COUNT(*) FROM help_articles a WHERE a.workspace_id = ?1 AND a.draft_run_id = ?2) + json_array_length(failed_json) >= planned`,
    )
    .bind(workspaceId, runId)
    .run();
  return result.meta.changes > 0;
}

/** Runs open for longer than `olderThanMs` since they last moved: stopped, for their files to be removed. */
export async function stopStaleHelpDraftRuns(database: Database, olderThanMs: number, limit: number): Promise<{ workspaceId: string; id: string }[]> {
  const d1 = rawHandle(database);
  const { results } = await d1
    .prepare(`SELECT workspace_id AS workspaceId, id FROM help_draft_runs WHERE ${OPEN_RUN} AND updated_at < ?1 ORDER BY updated_at LIMIT ?2`)
    .bind(Date.now() - olderThanMs, limit)
    .all<{ workspaceId: string; id: string }>();
  for (const run of results) await moveHelpDraftRun(database, run.workspaceId, run.id, ['uploading', 'queued', 'reading', 'writing'], 'failed', { errorCode: 'timed_out' });
  return results;
}

// ---------- What visitors reach ----------

export interface PublicHelpSite {
  websiteId: string;
  workspaceId: string;
  name: string;
  helpSlug: string;
  helpVersion: number;
  helpNoindex: number;
  settingsJson: string;
}

export interface PublicHelpArticle {
  id: string;
  collectionId: string | null;
  language: string;
  slug: string;
  title: string;
  summary: string;
  updatedAt: number;
}

export interface PublicHelpArticlePage extends PublicHelpArticle {
  bodyHtml: string;
  /** The same article in other languages, published. */
  translations: { language: string; slug: string }[];
}

const PUBLIC_COLUMNS = `id, collection_id AS collectionId, language, slug, title, summary, updated_at AS updatedAt`;
const PUBLISHED = `website_id = ?1 AND status = 'published'`;

/**
 * Reads for the public help centre. No context: a visitor is not a member. Every query names the website found by
 * its slug, and every article query requires `published`.
 */
export function publicHelpRepository(database: Database) {
  const d1 = rawHandle(database);
  return {
    async site(helpSlug: string): Promise<PublicHelpSite | null> {
      return d1
        .prepare(
          `SELECT id AS websiteId, workspace_id AS workspaceId, name, help_slug AS helpSlug, help_version AS helpVersion,
                  help_noindex AS helpNoindex, settings_json AS settingsJson
             FROM websites WHERE help_slug = ?1`,
        )
        .bind(helpSlug)
        .first<PublicHelpSite>();
    },

    /** Languages with at least one published article, most articles first. */
    async languages(websiteId: string): Promise<string[]> {
      const { results } = await d1
        .prepare(`SELECT language FROM help_articles WHERE ${PUBLISHED} GROUP BY language ORDER BY COUNT(*) DESC, language`)
        .bind(websiteId)
        .all<{ language: string }>();
      return results.map((row) => row.language);
    },

    async home(websiteId: string, language: string): Promise<{ collections: { id: string; name: string; slug: string }[]; articles: PublicHelpArticle[] }> {
      const [collections, articles] = await d1.batch([
        d1
          .prepare(
            `SELECT c.id, c.name, c.slug FROM help_collections c
              WHERE c.website_id = ?1 AND c.language = ?2
                AND EXISTS (SELECT 1 FROM help_articles a WHERE a.collection_id = c.id AND a.workspace_id = c.workspace_id AND a.status = 'published')
              ORDER BY c.position, c.name, c.id`,
          )
          .bind(websiteId, language),
        d1.prepare(`SELECT ${PUBLIC_COLUMNS} FROM help_articles WHERE ${PUBLISHED} AND language = ?2 ORDER BY position, title, id`).bind(websiteId, language),
      ]);
      return {
        collections: collections!.results as { id: string; name: string; slug: string }[],
        articles: articles!.results as PublicHelpArticle[],
      };
    },

    async article(websiteId: string, language: string, slug: string): Promise<PublicHelpArticlePage | null> {
      const row = await d1
        .prepare(`SELECT ${PUBLIC_COLUMNS}, body_html AS bodyHtml, translation_group_id AS groupId, workspace_id AS workspaceId FROM help_articles WHERE ${PUBLISHED} AND language = ?2 AND slug = ?3`)
        .bind(websiteId, language, slug)
        .first<PublicHelpArticlePage & { groupId: string; workspaceId: string }>();
      if (!row) return null;
      const { results } = await d1
        .prepare(`SELECT language, slug FROM help_articles WHERE ${PUBLISHED} AND workspace_id = ?2 AND translation_group_id = ?3 AND id <> ?4 ORDER BY language`)
        .bind(websiteId, row.workspaceId, row.groupId, row.id)
        .all<{ language: string; slug: string }>();
      return {
        id: row.id,
        collectionId: row.collectionId,
        language: row.language,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        updatedAt: row.updatedAt,
        bodyHtml: row.bodyHtml,
        translations: results,
      };
    },

    /**
     * Every term must appear. Ranked by terms in the title, then in the summary, then anywhere. search_text holds
     * the title, a U+0001, the summary, a U+0002, and the body, so the summary is the part before the U+0002.
     * It is a scan of one website's published articles in one language, bounded by HELP_LIMITS.
     */
    async search(websiteId: string, language: string, terms: string[], limit: number): Promise<PublicHelpArticle[]> {
      if (terms.length === 0) return [];
      const params: (string | number)[] = [websiteId, language];
      const where: string[] = [];
      const score: string[] = [];
      for (const term of terms) {
        params.push(term);
        const p = `?${params.length}`;
        where.push(`instr(search_text, ${p}) > 0`);
        score.push(`(CASE WHEN instr(search_title, ${p}) > 0 THEN 4 WHEN instr(substr(search_text, 1, instr(search_text, char(2))), ${p}) > 0 THEN 2 ELSE 1 END)`);
      }
      const { results } = await d1
        .prepare(
          `SELECT ${PUBLIC_COLUMNS} FROM help_articles
            WHERE ${PUBLISHED} AND language = ?2 AND ${where.join(' AND ')}
            ORDER BY ${score.join(' + ')} DESC, position, title, id LIMIT ${Math.max(1, Math.min(limit, 50))}`,
        )
        .bind(...params)
        .all<PublicHelpArticle>();
      return results;
    },

    /** The public address of a website's help centre, if it has one. */
    async slugOf(websiteId: string): Promise<string | null> {
      return (await d1.prepare(`SELECT help_slug AS slug FROM websites WHERE id = ?1`).bind(websiteId).first<{ slug: string | null }>())?.slug ?? null;
    },

    /** A published article of this website by its ID, as the widget opens it. */
    async articleById(websiteId: string, articleId: string): Promise<PublicHelpArticlePage | null> {
      const row = await d1.prepare(`SELECT language, slug FROM help_articles WHERE ${PUBLISHED} AND id = ?2`).bind(websiteId, articleId).first<{ language: string; slug: string }>();
      return row ? this.article(websiteId, row.language, row.slug) : null;
    },

    /**
     * Counts one view, or one answer to "Was this helpful?", of a published article of this website, named by its ID
     * or by its language and slug. One statement: the row is made by the first count. False if there is no such
     * published article. Nothing about the reader is stored.
     */
    async count(websiteId: string, article: { id: string } | { language: string; slug: string }, what: 'view' | 'helpful' | 'notHelpful'): Promise<boolean> {
      const column = what === 'view' ? 'views' : what === 'helpful' ? 'helpful' : 'not_helpful';
      const byId = 'id' in article;
      const result = await d1
        .prepare(
          `INSERT INTO help_article_stats (workspace_id, article_id, ${column})
           SELECT a.workspace_id, a.id, 1 FROM help_articles a WHERE a.website_id = ?1 AND a.status = 'published' AND ${byId ? 'a.id = ?2' : 'a.language = ?2 AND a.slug = ?3'}
           ON CONFLICT (workspace_id, article_id) DO UPDATE SET ${column} = ${column} + 1`,
        )
        .bind(...(byId ? [websiteId, article.id] : [websiteId, article.language, article.slug]))
        .run();
      return result.meta.changes > 0;
    },

    async sitemap(websiteId: string): Promise<PublicHelpArticle[]> {
      const { results } = await d1.prepare(`SELECT ${PUBLIC_COLUMNS} FROM help_articles WHERE ${PUBLISHED} ORDER BY language, position, id`).bind(websiteId).all<PublicHelpArticle>();
      return results;
    },

    /** An image, if it belongs to a website. Images of drafts are reachable by their ID, which cannot be guessed. */
    async asset(assetId: string): Promise<{ id: string; contentType: string; sizeBytes: number } | null> {
      return d1.prepare(`SELECT id, content_type AS contentType, size_bytes AS sizeBytes FROM help_assets WHERE id = ?1`).bind(assetId).first();
    },
  };
}
