/**
 * The public help centre (ADR-0023): what a visitor reaches at /help/<slug>, with no sign-in. Everything here reads
 * published articles of the website the slug names, and nothing else.
 */
import { publicHelpRepository, type Database, type PublicHelpArticle, type PublicHelpSite } from '@openchat/database';
import { HELP_LANGUAGES, helpSearchTerms, type HelpLanguage } from '@openchat/shared';

export const HELP_SEARCH_LIMITS = { queryChars: 200, results: 20 } as const;

/** How a language appears in a URL: lower case, so that links are predictable. */
export const helpLanguagePath = (language: string) => language.toLowerCase();

export function helpLanguageFromPath(segment: string): HelpLanguage | null {
  return HELP_LANGUAGES.find((language) => language.toLowerCase() === segment.toLowerCase()) ?? null;
}

/** The visitor's language from Accept-Language, among those the help centre has. */
export function pickHelpLanguage(acceptLanguage: string | null | undefined, available: string[]): string | null {
  if (available.length === 0) return null;
  const wanted = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1, index };
    })
    .filter((entry) => entry.tag && entry.tag !== '*' && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const lower = new Map(available.map((language) => [language.toLowerCase(), language]));
  for (const { tag } of wanted) {
    if (lower.has(tag)) return lower.get(tag)!;
    if (tag.startsWith('zh')) {
      const traditional = /-(hant|tw|hk|mo)\b/.test(tag);
      const match = lower.get(traditional ? 'zh-hant' : 'zh-hans');
      if (match) return match;
      continue;
    }
    const primary = tag.split('-')[0]!;
    if (lower.has(primary)) return lower.get(primary)!;
  }
  // Nothing matched: English, which more visitors read than any other, if there is any; else the most articles.
  return available.includes('en') ? 'en' : available[0]!;
}

export interface HelpSite extends PublicHelpSite {
  primaryColor: string | null;
}

export async function findHelpSite(db: Database, slug: string): Promise<HelpSite | null> {
  if (!/^[a-z0-9-]{1,50}$/.test(slug)) return null;
  const site = await publicHelpRepository(db).site(slug);
  if (!site) return null;
  let primaryColor: string | null = null;
  try {
    const settings = JSON.parse(site.settingsJson) as { primaryColor?: unknown };
    if (typeof settings.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(settings.primaryColor)) primaryColor = settings.primaryColor;
  } catch {
    // Settings are validated on the way in; an unreadable value only loses the colour.
  }
  return { ...site, primaryColor };
}

export const helpLanguages = (db: Database, site: HelpSite) => publicHelpRepository(db).languages(site.websiteId);
export const helpHome = (db: Database, site: HelpSite, language: string) => publicHelpRepository(db).home(site.websiteId, language);
export const helpArticlePage = (db: Database, site: HelpSite, language: string, slug: string) => publicHelpRepository(db).article(site.websiteId, language, slug);
export const helpSitemap = (db: Database, site: HelpSite) => publicHelpRepository(db).sitemap(site.websiteId);
export const helpAssetInfo = (db: Database, assetId: string) => (/^hast_[0-9A-Z]{26}$/.test(assetId) ? publicHelpRepository(db).asset(assetId) : Promise.resolve(null));

export async function searchHelp(db: Database, site: HelpSite, language: string, query: string): Promise<PublicHelpArticle[]> {
  const terms = helpSearchTerms(query.slice(0, HELP_SEARCH_LIMITS.queryChars));
  return publicHelpRepository(db).search(site.websiteId, language, terms, HELP_SEARCH_LIMITS.results);
}

// ---------- The widget's Help tab (step 3) ----------

/** Images and links to the help centre point at the installation, because the widget runs on another site. */
export function absoluteHelpHtml(html: string, origin: string): string {
  return html
    .replaceAll('src="/help-assets/', `src="${origin}/help-assets/`)
    .replaceAll('<a href="/help/', `<a target="_blank" rel="noopener" href="${origin}/help/`);
}

/** The language a widget in `wanted` shows: that, if it has articles, else English, else the one with most. */
export function widgetHelpLanguage(wanted: string | undefined, available: string[]): string | null {
  return available.includes(wanted ?? '') ? wanted! : pickHelpLanguage(null, available);
}

/** The widget's list is short; search reaches the rest. */
export const WIDGET_HELP_LIST = 100;

export const publishedHelpLanguages = (db: Database, websiteId: string) => publicHelpRepository(db).languages(websiteId);

export async function widgetHelp(db: Database, websiteId: string, input: { language?: string | undefined; q?: string | undefined }) {
  const repository = publicHelpRepository(db);
  const language = widgetHelpLanguage(input.language, await repository.languages(websiteId));
  if (!language) return { language: null, collections: [], articles: [] };
  const summary = (a: PublicHelpArticle) => ({ id: a.id, title: a.title, summary: a.summary, collectionId: a.collectionId });
  const query = input.q?.trim();
  if (query) {
    const terms = helpSearchTerms(query.slice(0, HELP_SEARCH_LIMITS.queryChars));
    return { language, collections: [], articles: (await repository.search(websiteId, language, terms, HELP_SEARCH_LIMITS.results)).map(summary) };
  }
  const home = await repository.home(websiteId, language);
  const articles = home.articles.slice(0, WIDGET_HELP_LIST);
  const shown = new Set(articles.map((a) => a.collectionId));
  return { language, collections: home.collections.filter((c) => shown.has(c.id)).map((c) => ({ id: c.id, name: c.name })), articles: articles.map(summary) };
}

export async function widgetHelpArticle(db: Database, websiteId: string, articleId: string, origin: string) {
  const repository = publicHelpRepository(db);
  const [article, slug] = await Promise.all([repository.articleById(websiteId, articleId), repository.slugOf(websiteId)]);
  if (!article) return null;
  return {
    id: article.id,
    language: article.language,
    title: article.title,
    summary: article.summary,
    bodyHtml: absoluteHelpHtml(article.bodyHtml, origin),
    url: slug ? `${origin}/help/${slug}/${helpLanguagePath(article.language)}/${encodeURIComponent(article.slug)}` : null,
  };
}
