/**
 * The help centre (ADR-0023), for members. Any member can read it, so that an agent can link an article in a reply;
 * supervisors change it (`help.manage`). What visitors reach is in help-public.ts.
 */
import { helpAssetKey, helpRepository, isUniqueViolation, HELP_LIMITS, type Database, type HelpArticleRow, type HelpArticleSummaryRow, type HelpAssetRow, type HelpCollectionRow, type WorkspaceContext } from '@openchat/database';
import {
  AppError,
  HELP_LANGUAGES,
  HELP_SLUG_PATTERN,
  helpMarkdownToText,
  helpSlug,
  normalizeSearchText,
  notFound,
  renderHelpMarkdown,
  toIso,
  versionConflict,
} from '@openchat/shared';
import { toHelpDraftRun } from './help-draft';
import { requireCapability } from './workspaces';

export { HELP_LIMITS, helpAssetKey };

export const HELP_TEXT_LIMITS = {
  titleChars: 200,
  summaryChars: 500,
  bodyChars: 20_000,
  collectionNameChars: 100,
  assetBytes: 5 * 1024 * 1024,
} as const;

/** A website's help address: plain, so that it reads well in a link. */
export const HELP_ADDRESS_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export const HELP_ASSET_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

const slugTaken = () => new AppError(409, 'slug_taken', 'Another one already uses that address');
const isLanguage = (value: string) => (HELP_LANGUAGES as readonly string[]).includes(value);

async function websiteOrNotFound(db: Database, ctx: WorkspaceContext, websiteId: string) {
  const settings = await helpRepository(db, ctx).settings(websiteId);
  if (!settings) throw notFound();
  return settings;
}

const toCollection = (row: HelpCollectionRow) => ({
  id: row.id,
  language: row.language,
  name: row.name,
  slug: row.slug,
  position: row.position,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const toSummary = (row: HelpArticleSummaryRow) => ({
  id: row.id,
  collectionId: row.collectionId,
  translationGroupId: row.translationGroupId,
  language: row.language,
  slug: row.slug,
  title: row.title,
  summary: row.summary,
  status: row.status,
  position: row.position,
  version: row.version,
  publishedAt: row.publishedAt === null ? null : toIso(row.publishedAt),
  aiDrafted: row.aiDrafted === 1,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const toArticle = (row: HelpArticleRow) => ({
  ...toSummary(row),
  bodyMarkdown: row.bodyMarkdown,
  bodyHtml: row.bodyHtml,
  aiSources: row.aiSourcesJson === null ? [] : (JSON.parse(row.aiSourcesJson) as { title: string; url: string | null }[]),
});

const toAsset = (row: HelpAssetRow) => ({
  id: row.id,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  filename: row.filename,
  url: `/help-assets/${row.id}`,
  createdAt: toIso(row.createdAt),
});

/** Everything stored for an article's words: what was written, its HTML, and what search reads. */
export function helpArticleText(input: { title: string; summary: string; bodyMarkdown: string }) {
  const title = input.title.trim();
  const summary = input.summary.trim();
  const bodyMarkdown = input.bodyMarkdown.replace(/\r\n?/g, '\n').trim();
  if (!title) throw new AppError(400, 'title_empty', 'The title is empty');
  if (title.length > HELP_TEXT_LIMITS.titleChars || summary.length > HELP_TEXT_LIMITS.summaryChars || bodyMarkdown.length > HELP_TEXT_LIMITS.bodyChars) {
    throw new AppError(400, 'article_too_long', 'The article is longer than it can be');
  }
  return {
    title,
    summary,
    bodyMarkdown,
    bodyHtml: renderHelpMarkdown(bodyMarkdown),
    searchTitle: normalizeSearchText(title),
    searchText: `${normalizeSearchText(title)}\u0001${normalizeSearchText(summary)}\u0002${normalizeSearchText(helpMarkdownToText(bodyMarkdown))}`,
  };
}

/** The first of `base`, `base-2`, `base-3`… that is free. */
function freeSlug(base: string, taken: string[]): string {
  const used = new Set([...taken, ...RESERVED_SLUGS]);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Paths of the public help centre that an article's slug must not take. */
const RESERVED_SLUGS = ['search', 'sitemap'];

function checkSlug(slug: string): string {
  if (!HELP_SLUG_PATTERN.test(slug) || slug.length > 80 || RESERVED_SLUGS.includes(slug)) throw new AppError(400, 'slug_invalid', 'Use letters, digits and hyphens');
  return slug;
}

async function writing<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw slugTaken();
    throw error;
  }
}

// ---------- The help centre of one website ----------

/** `canDraft`: this installation has Workers AI, so Draft with AI is offered. */
export async function getHelpCentre(db: Database, ctx: WorkspaceContext, websiteId: string, options: { canDraft: boolean } = { canDraft: false }) {
  const settings = await websiteOrNotFound(db, ctx, websiteId);
  const repository = helpRepository(db, ctx);
  const [collections, articles, assets, runs] = await Promise.all([
    repository.collections(websiteId),
    repository.articles(websiteId),
    repository.assets(websiteId),
    repository.draftRuns(websiteId, 5),
  ]);
  return {
    websiteId,
    websiteName: settings.websiteName,
    slug: settings.helpSlug,
    noindex: settings.helpNoindex === 1,
    languages: [...HELP_LANGUAGES],
    collections: collections.map(toCollection),
    articles: articles.map(toSummary),
    assets: assets.map(toAsset),
    drafting: { available: options.canDraft, runs: runs.map(toHelpDraftRun) },
    limits: { articlesPerWebsite: HELP_LIMITS.articlesPerWebsite, ...HELP_TEXT_LIMITS },
  };
}

/** Turns the public help centre on (a slug), off (null), or moves it. */
export async function saveHelpSettings(db: Database, ctx: WorkspaceContext, websiteId: string, input: { slug: string | null; noindex?: boolean | undefined }) {
  requireCapability(ctx, 'help.manage');
  const current = await websiteOrNotFound(db, ctx, websiteId);
  const slug = input.slug === null ? null : input.slug.trim().toLowerCase();
  if (slug !== null && !HELP_ADDRESS_PATTERN.test(slug)) throw new AppError(400, 'slug_invalid', 'Use lower-case letters, digits and hyphens');
  const row = await writing(() => helpRepository(db, ctx).saveSettings(websiteId, { helpSlug: slug, helpNoindex: input.noindex ?? current.helpNoindex === 1 }));
  if (!row) throw notFound();
  return { slug: row.helpSlug, noindex: row.helpNoindex === 1 };
}

// ---------- Collections ----------

export async function createHelpCollection(db: Database, ctx: WorkspaceContext, websiteId: string, input: { language: string; name: string }) {
  requireCapability(ctx, 'help.manage');
  if (!isLanguage(input.language)) throw new AppError(400, 'language_unknown', 'That language is not one the help centre has');
  const name = input.name.trim();
  if (!name || name.length > HELP_TEXT_LIMITS.collectionNameChars) throw new AppError(400, 'name_invalid', 'The name is empty or too long');
  const repository = helpRepository(db, ctx);
  await websiteOrNotFound(db, ctx, websiteId);
  const base = helpSlug(name) || 'collection';
  const slug = freeSlug(base, await repository.slugsLike(websiteId, input.language, 'help_collections', base));
  const row = await writing(() => repository.createCollection(websiteId, { language: input.language, name, slug }));
  if (!row) throw new AppError(409, 'too_many_collections', 'This help centre has as many collections as it can have');
  return toCollection(row);
}

export async function updateHelpCollection(db: Database, ctx: WorkspaceContext, collectionId: string, input: { name?: string | undefined; slug?: string | undefined; position?: number | undefined }) {
  requireCapability(ctx, 'help.manage');
  const name = input.name?.trim();
  if (name !== undefined && (!name || name.length > HELP_TEXT_LIMITS.collectionNameChars)) throw new AppError(400, 'name_invalid', 'The name is empty or too long');
  const slug = input.slug === undefined ? undefined : checkSlug(input.slug);
  const row = await writing(() => helpRepository(db, ctx).updateCollection(collectionId, { name, slug, position: input.position }));
  if (!row) throw notFound();
  return toCollection(row);
}

export async function deleteHelpCollection(db: Database, ctx: WorkspaceContext, collectionId: string) {
  requireCapability(ctx, 'help.manage');
  if (!(await helpRepository(db, ctx).deleteCollection(collectionId))) throw notFound();
}

// ---------- Articles ----------

export async function getHelpArticle(db: Database, ctx: WorkspaceContext, articleId: string) {
  const row = await helpRepository(db, ctx).article(articleId);
  if (!row) throw notFound();
  return toArticle(row);
}

export async function createHelpArticle(
  db: Database,
  ctx: WorkspaceContext,
  websiteId: string,
  input: { language: string; title: string; summary?: string | undefined; bodyMarkdown?: string | undefined; collectionId?: string | null | undefined; translationOf?: string | undefined },
) {
  requireCapability(ctx, 'help.manage');
  if (!isLanguage(input.language)) throw new AppError(400, 'language_unknown', 'That language is not one the help centre has');
  const text = helpArticleText({ title: input.title, summary: input.summary ?? '', bodyMarkdown: input.bodyMarkdown ?? '' });
  const repository = helpRepository(db, ctx);
  await websiteOrNotFound(db, ctx, websiteId);

  let translationGroupId: string | null = null;
  if (input.translationOf !== undefined) {
    const original = await repository.article(input.translationOf);
    if (!original || original.websiteId !== websiteId) throw notFound();
    const group = (await repository.articles(websiteId)).filter((a) => a.translationGroupId === original.translationGroupId);
    if (group.some((a) => a.language === input.language)) throw new AppError(409, 'translation_exists', 'This article is already in that language');
    translationGroupId = original.translationGroupId;
  }

  const base = helpSlug(text.title) || 'article';
  const slug = freeSlug(base, await repository.slugsLike(websiteId, input.language, 'help_articles', base));
  const row = await writing(() => repository.createArticle(websiteId, { ...text, language: input.language, slug, collectionId: input.collectionId ?? null, translationGroupId }));
  if (row) return toArticle(row);
  if (input.collectionId && !(await repository.collection(input.collectionId))) throw new AppError(400, 'collection_invalid', 'That collection is not in this help centre');
  if (input.collectionId) throw new AppError(400, 'collection_invalid', 'That collection is in another language');
  throw new AppError(409, 'too_many_articles', 'This help centre has as many articles as it can have');
}

export async function updateHelpArticle(
  db: Database,
  ctx: WorkspaceContext,
  articleId: string,
  input: {
    expectedVersion: number;
    title?: string | undefined;
    summary?: string | undefined;
    bodyMarkdown?: string | undefined;
    slug?: string | undefined;
    collectionId?: string | null | undefined;
    position?: number | undefined;
  },
) {
  requireCapability(ctx, 'help.manage');
  const repository = helpRepository(db, ctx);
  const existing = await repository.article(articleId);
  if (!existing) throw notFound();
  if (existing.version !== input.expectedVersion) throw versionConflict(existing.version);
  const changesText = input.title !== undefined || input.summary !== undefined || input.bodyMarkdown !== undefined;
  const text = changesText
    ? helpArticleText({ title: input.title ?? existing.title, summary: input.summary ?? existing.summary, bodyMarkdown: input.bodyMarkdown ?? existing.bodyMarkdown })
    : {};
  const slug = input.slug === undefined ? undefined : checkSlug(input.slug);
  const row = await writing(() => repository.updateArticle(articleId, input.expectedVersion, { ...text, slug, collectionId: input.collectionId, position: input.position }));
  if (row) return toArticle(row);
  const now = await repository.article(articleId);
  if (!now) throw notFound();
  if (now.version !== input.expectedVersion) throw versionConflict(now.version);
  throw new AppError(400, 'collection_invalid', 'That collection is not in this help centre, in this language');
}

export async function setHelpArticleStatus(db: Database, ctx: WorkspaceContext, articleId: string, status: 'draft' | 'published') {
  requireCapability(ctx, 'help.manage');
  const row = await helpRepository(db, ctx).setStatus(articleId, status);
  if (!row) throw notFound();
  return toArticle(row);
}

export async function deleteHelpArticle(db: Database, ctx: WorkspaceContext, articleId: string) {
  requireCapability(ctx, 'help.manage');
  if (!(await helpRepository(db, ctx).deleteArticle(articleId))) throw notFound();
}

// ---------- Images ----------

/** Checks an upload before its bytes are read. The bytes are checked by the caller, against the type. */
export async function checkHelpAsset(db: Database, ctx: WorkspaceContext, websiteId: string, input: { contentType: string; sizeBytes: number }) {
  requireCapability(ctx, 'help.manage');
  if (!(HELP_ASSET_TYPES as readonly string[]).includes(input.contentType)) throw new AppError(415, 'unsupported_type', 'Use a PNG, JPEG, GIF or WebP image');
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new AppError(411, 'length_required', 'The size of the image is needed');
  if (input.sizeBytes > HELP_TEXT_LIMITS.assetBytes) throw new AppError(413, 'too_large', 'The image is larger than 5 MB');
  await websiteOrNotFound(db, ctx, websiteId);
}

/** Records an image whose file is already stored. Null if the website is full; the caller removes the file. */
export async function recordHelpAsset(db: Database, ctx: WorkspaceContext, websiteId: string, input: { id: string; contentType: string; sizeBytes: number; filename: string }) {
  requireCapability(ctx, 'help.manage');
  const row = await helpRepository(db, ctx).addAsset(websiteId, input);
  return row ? toAsset(row) : null;
}

/** Forgets an image. The caller removes the file. Articles that show it show nothing there. */
export async function deleteHelpAsset(db: Database, ctx: WorkspaceContext, assetId: string) {
  requireCapability(ctx, 'help.manage');
  if (!(await helpRepository(db, ctx).deleteAsset(assetId))) throw notFound();
}
