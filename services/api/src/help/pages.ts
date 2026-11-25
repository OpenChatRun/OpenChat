/**
 * The public help centre's HTML (ADR-0023). Server-rendered, with no script, no cookie and nothing loaded from
 * elsewhere. Everything a person wrote is escaped here, except an article's body, which was rendered from an
 * allow-list when it was saved (@openchat/shared help-text.ts).
 */
import { escapeHtml, type HelpLanguage } from '@openchat/shared';
import { helpLanguagePath, type HelpSite } from '@openchat/core';
import type { PublicHelpArticle, PublicHelpArticlePage } from '@openchat/database';

interface Strings {
  helpCentre: string;
  search: string;
  searchPlaceholder: string;
  resultsFor: string;
  noResults: string;
  otherArticles: string;
  alsoIn: string;
  allArticles: string;
  notFound: string;
  empty: string;
  updated: string;
  helpful: string;
  yes: string;
  no: string;
  thanks: string;
  backToArticle: string;
}

const STRINGS: Record<HelpLanguage, Strings> = {
  en: { helpCentre: 'Help centre', search: 'Search', searchPlaceholder: 'Search articles', resultsFor: 'Results for “{q}”', noResults: 'No articles match your search.', otherArticles: 'Other articles', alsoIn: 'Also in', allArticles: 'All articles', notFound: 'This page does not exist.', empty: 'There are no articles yet.', updated: 'Updated {date}', helpful: 'Was this article helpful?', yes: 'Yes', no: 'No', thanks: 'Thanks for your feedback.', backToArticle: 'Back to the article' },
  es: { helpCentre: 'Centro de ayuda', search: 'Buscar', searchPlaceholder: 'Buscar artículos', resultsFor: 'Resultados para «{q}»', noResults: 'Ningún artículo coincide con tu búsqueda.', otherArticles: 'Otros artículos', alsoIn: 'También en', allArticles: 'Todos los artículos', notFound: 'Esta página no existe.', empty: 'Todavía no hay artículos.', updated: 'Actualizado el {date}', helpful: '¿Te ha resultado útil este artículo?', yes: 'Sí', no: 'No', thanks: 'Gracias por tu opinión.', backToArticle: 'Volver al artículo' },
  fr: { helpCentre: "Centre d'aide", search: 'Rechercher', searchPlaceholder: 'Rechercher des articles', resultsFor: 'Résultats pour « {q} »', noResults: 'Aucun article ne correspond à votre recherche.', otherArticles: 'Autres articles', alsoIn: 'Aussi en', allArticles: 'Tous les articles', notFound: "Cette page n'existe pas.", empty: "Il n'y a pas encore d'articles.", updated: 'Mis à jour le {date}', helpful: 'Cet article vous a-t-il été utile ?', yes: 'Oui', no: 'Non', thanks: 'Merci pour votre avis.', backToArticle: "Retour à l'article" },
  de: { helpCentre: 'Hilfe-Center', search: 'Suchen', searchPlaceholder: 'Artikel durchsuchen', resultsFor: 'Ergebnisse für „{q}“', noResults: 'Keine Artikel passen zu Ihrer Suche.', otherArticles: 'Weitere Artikel', alsoIn: 'Auch verfügbar in', allArticles: 'Alle Artikel', notFound: 'Diese Seite gibt es nicht.', empty: 'Es gibt noch keine Artikel.', updated: 'Aktualisiert am {date}', helpful: 'War dieser Artikel hilfreich?', yes: 'Ja', no: 'Nein', thanks: 'Danke für Ihre Rückmeldung.', backToArticle: 'Zurück zum Artikel' },
  it: { helpCentre: 'Centro assistenza', search: 'Cerca', searchPlaceholder: 'Cerca negli articoli', resultsFor: 'Risultati per «{q}»', noResults: 'Nessun articolo corrisponde alla ricerca.', otherArticles: 'Altri articoli', alsoIn: 'Disponibile anche in', allArticles: 'Tutti gli articoli', notFound: 'Questa pagina non esiste.', empty: 'Non ci sono ancora articoli.', updated: 'Aggiornato il {date}', helpful: 'Questo articolo ti è stato utile?', yes: 'Sì', no: 'No', thanks: 'Grazie per il tuo parere.', backToArticle: "Torna all'articolo" },
  pt: { helpCentre: 'Central de ajuda', search: 'Pesquisar', searchPlaceholder: 'Pesquisar artigos', resultsFor: 'Resultados para “{q}”', noResults: 'Nenhum artigo corresponde à sua pesquisa.', otherArticles: 'Outros artigos', alsoIn: 'Também em', allArticles: 'Todos os artigos', notFound: 'Esta página não existe.', empty: 'Ainda não há artigos.', updated: 'Atualizado em {date}', helpful: 'Este artigo foi útil?', yes: 'Sim', no: 'Não', thanks: 'Obrigado pela sua opinião.', backToArticle: 'Voltar ao artigo' },
  nl: { helpCentre: 'Helpcentrum', search: 'Zoeken', searchPlaceholder: 'Artikelen doorzoeken', resultsFor: 'Resultaten voor ‘{q}’', noResults: 'Geen artikelen gevonden.', otherArticles: 'Andere artikelen', alsoIn: 'Ook beschikbaar in', allArticles: 'Alle artikelen', notFound: 'Deze pagina bestaat niet.', empty: 'Er zijn nog geen artikelen.', updated: 'Bijgewerkt op {date}', helpful: 'Was dit artikel nuttig?', yes: 'Ja', no: 'Nee', thanks: 'Bedankt voor je feedback.', backToArticle: 'Terug naar het artikel' },
  ja: { helpCentre: 'ヘルプセンター', search: '検索', searchPlaceholder: '記事を検索', resultsFor: '「{q}」の検索結果', noResults: '検索に一致する記事はありません。', otherArticles: 'その他の記事', alsoIn: 'ほかの言語', allArticles: 'すべての記事', notFound: 'このページは存在しません。', empty: 'まだ記事がありません。', updated: '更新日: {date}', helpful: 'この記事は役に立ちましたか？', yes: 'はい', no: 'いいえ', thanks: 'ご意見ありがとうございます。', backToArticle: '記事に戻る' },
  ko: { helpCentre: '도움말 센터', search: '검색', searchPlaceholder: '문서 검색', resultsFor: '‘{q}’ 검색 결과', noResults: '검색과 일치하는 문서가 없습니다.', otherArticles: '기타 문서', alsoIn: '다른 언어', allArticles: '모든 문서', notFound: '이 페이지는 존재하지 않습니다.', empty: '아직 문서가 없습니다.', updated: '업데이트: {date}', helpful: '이 문서가 도움이 되었나요?', yes: '예', no: '아니요', thanks: '의견을 보내 주셔서 감사합니다.', backToArticle: '문서로 돌아가기' },
  'zh-Hans': { helpCentre: '帮助中心', search: '搜索', searchPlaceholder: '搜索文章', resultsFor: '“{q}”的搜索结果', noResults: '没有与搜索匹配的文章。', otherArticles: '其他文章', alsoIn: '其他语言', allArticles: '所有文章', notFound: '此页面不存在。', empty: '还没有文章。', updated: '更新于 {date}', helpful: '这篇文章有帮助吗？', yes: '有', no: '没有', thanks: '感谢你的反馈。', backToArticle: '返回文章' },
  'zh-Hant': { helpCentre: '說明中心', search: '搜尋', searchPlaceholder: '搜尋文章', resultsFor: '「{q}」的搜尋結果', noResults: '沒有符合搜尋的文章。', otherArticles: '其他文章', alsoIn: '其他語言', allArticles: '所有文章', notFound: '此頁面不存在。', empty: '尚無文章。', updated: '更新於 {date}', helpful: '這篇文章有幫助嗎？', yes: '有', no: '沒有', thanks: '感謝你的意見。', backToArticle: '返回文章' },
};

/** Each language's name in itself. */
export const LANGUAGE_NAMES: Record<HelpLanguage, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
  ja: '日本語',
  ko: '한국어',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
};

export const helpStrings = (language: string): Strings => STRINGS[language as HelpLanguage] ?? STRINGS.en;
const languageName = (language: string) => LANGUAGE_NAMES[language as HelpLanguage] ?? language;

/** No script at all; styles are inline; images only from here; forms only to here. */
export const HELP_PAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const DEFAULT_ACCENT = '#0a57f5';

/** Black or white, whichever reads better on the website's colour. */
function onAccent(hex: string): string {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4 ? '#000000' : '#ffffff';
}

export const helpBase = (site: Pick<HelpSite, 'helpSlug'>) => `/help/${encodeURIComponent(site.helpSlug)}`;
export const helpHomePath = (site: Pick<HelpSite, 'helpSlug'>, language: string) => `${helpBase(site)}/${helpLanguagePath(language)}`;
export const helpArticlePath = (site: Pick<HelpSite, 'helpSlug'>, language: string, slug: string) => `${helpHomePath(site, language)}/${encodeURIComponent(slug)}`;

interface Frame {
  site: HelpSite;
  language: string;
  title: string;
  description?: string | undefined;
  canonical?: string | undefined;
  languages: string[];
  query?: string | undefined;
  /** Links to this page in other languages, if there are any. */
  alternates?: { language: string; href: string }[] | undefined;
  body: string;
}

function page(frame: Frame): string {
  const { site, language } = frame;
  const s = helpStrings(language);
  const accent = site.primaryColor ?? DEFAULT_ACCENT;
  const home = helpHomePath(site, language);
  const alternates = frame.alternates ?? [];
  const switcher =
    alternates.length > 0
      ? `<nav class="languages" aria-label="${escapeHtml(s.alsoIn)}">${escapeHtml(s.alsoIn)}: ${alternates
          .map((a) => `<a href="${escapeHtml(a.href)}" hreflang="${escapeHtml(a.language)}" lang="${escapeHtml(a.language)}">${escapeHtml(languageName(a.language))}</a>`)
          .join(' · ')}</nav>`
      : '';
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(frame.title)}</title>
${frame.description ? `<meta name="description" content="${escapeHtml(frame.description)}">` : ''}
${frame.canonical ? `<link rel="canonical" href="${escapeHtml(frame.canonical)}">` : ''}
${site.helpNoindex ? '<meta name="robots" content="noindex">' : ''}
${alternates.map((a) => `<link rel="alternate" hreflang="${escapeHtml(a.language)}" href="${escapeHtml(a.href)}">`).join('\n')}
<style>
:root{--accent:${accent};--on-accent:${onAccent(accent)};--bg:#ffffff;--fg:#0f172a;--muted:#5b6474;--line:#e3e6eb;--card:#ffffff;--code:#f3f4f6}
@media (prefers-color-scheme:dark){:root{--bg:#000000;--fg:#f2f2f2;--muted:#a1a1aa;--line:#27272a;--card:#0a0a0a;--code:#18181b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans CJK JP",sans-serif}
a{color:var(--accent)}
@media (prefers-color-scheme:dark){a{color:color-mix(in srgb,var(--accent) 60%,#ffffff)}}
header{background:var(--accent);color:var(--on-accent);padding:28px 16px 32px}
header .inner,main{max-width:760px;margin:0 auto}
header a{color:inherit;text-decoration:none}
header .site{font-size:14px;opacity:.85}
header h1{margin:2px 0 18px;font-size:28px;line-height:1.25}
form{display:flex;gap:8px}
input[type=search]{flex:1;min-width:0;padding:12px 14px;border:0;border-radius:10px;font:inherit;background:#ffffff;color:#0f172a}
button{padding:12px 16px;border:0;border-radius:10px;font:inherit;font-weight:600;background:rgba(0,0,0,.25);color:inherit;cursor:pointer}
main{padding:24px 16px 48px}
h2{font-size:20px;margin:28px 0 8px}
ul.list{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:12px;background:var(--card)}
ul.list li{border-top:1px solid var(--line)}
ul.list li:first-child{border-top:0}
ul.list a{display:block;padding:14px 16px;text-decoration:none;color:var(--fg)}
ul.list a:hover{background:var(--code)}
ul.list .summary{display:block;color:var(--muted);font-size:14px;margin-top:2px}
.muted{color:var(--muted)}
.languages{font-size:14px;color:var(--muted);margin:0 0 16px}
article{overflow-wrap:anywhere}
article h1{font-size:30px;line-height:1.25;margin:8px 0 4px}
article img{max-width:100%;height:auto;border-radius:8px}
article pre{background:var(--code);padding:12px;border-radius:8px;overflow-x:auto}
article code{background:var(--code);padding:1px 4px;border-radius:4px}
article pre code{padding:0}
article blockquote{margin:16px 0;padding:4px 16px;border-left:4px solid var(--line);color:var(--muted)}
article hr{border:0;border-top:1px solid var(--line);margin:24px 0}
.back{display:inline-block;margin-bottom:8px;font-size:14px}
.helpful{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);align-items:center;flex-wrap:wrap}
.helpful p{margin:0 8px 0 0}
.helpful button{padding:8px 18px;background:var(--card);color:var(--fg);border:1px solid var(--line)}
.helpful button:hover{background:var(--code)}
footer{max-width:760px;margin:0 auto;padding:0 16px 32px;font-size:13px;color:var(--muted)}
</style>
</head>
<body>
<header><div class="inner">
<a class="site" href="${escapeHtml(home)}">${escapeHtml(site.name)}</a>
<h1><a href="${escapeHtml(home)}">${escapeHtml(s.helpCentre)}</a></h1>
<form method="get" action="${escapeHtml(home)}/search" role="search">
<input type="search" name="q" maxlength="200" value="${escapeHtml(frame.query ?? '')}" placeholder="${escapeHtml(s.searchPlaceholder)}" aria-label="${escapeHtml(s.searchPlaceholder)}">
<button type="submit">${escapeHtml(s.search)}</button>
</form>
</div></header>
<main>
${switcher}
${frame.body}
</main>
<footer>${frame.languages.length > 1 ? frame.languages.map((l) => `<a href="${escapeHtml(helpHomePath(site, l))}" lang="${escapeHtml(l)}">${escapeHtml(languageName(l))}</a>`).join(' · ') : ''}</footer>
</body>
</html>`;
}

const articleList = (site: HelpSite, articles: PublicHelpArticle[]) =>
  `<ul class="list">${articles
    .map(
      (a) =>
        `<li><a href="${escapeHtml(helpArticlePath(site, a.language, a.slug))}">${escapeHtml(a.title)}${a.summary ? `<span class="summary">${escapeHtml(a.summary)}</span>` : ''}</a></li>`,
    )
    .join('')}</ul>`;

export function homePage(input: {
  site: HelpSite;
  language: string;
  languages: string[];
  origin: string;
  collections: { id: string; name: string }[];
  articles: PublicHelpArticle[];
}): string {
  const { site, language } = input;
  const s = helpStrings(language);
  const sections: string[] = [];
  for (const collection of input.collections) {
    const inIt = input.articles.filter((a) => a.collectionId === collection.id);
    if (inIt.length) sections.push(`<section><h2>${escapeHtml(collection.name)}</h2>${articleList(site, inIt)}</section>`);
  }
  const known = new Set(input.collections.map((c) => c.id));
  const rest = input.articles.filter((a) => a.collectionId === null || !known.has(a.collectionId));
  if (rest.length) sections.push(`<section>${sections.length ? `<h2>${escapeHtml(s.otherArticles)}</h2>` : ''}${articleList(site, rest)}</section>`);
  return page({
    site,
    language,
    languages: input.languages,
    title: `${s.helpCentre} · ${site.name}`,
    canonical: `${input.origin}${helpHomePath(site, language)}`,
    alternates: input.languages.filter((l) => l !== language).map((l) => ({ language: l, href: `${input.origin}${helpHomePath(site, l)}` })),
    body: sections.length ? sections.join('\n') : `<p class="muted">${escapeHtml(s.empty)}</p>`,
  });
}

export function articlePage(input: { site: HelpSite; language: string; languages: string[]; origin: string; article: PublicHelpArticlePage }): string {
  const { site, language, article } = input;
  const s = helpStrings(language);
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(article.updatedAt));
  return page({
    site,
    language,
    languages: input.languages,
    title: `${article.title} · ${site.name}`,
    description: article.summary || undefined,
    canonical: `${input.origin}${helpArticlePath(site, language, article.slug)}`,
    alternates: article.translations.map((t) => ({ language: t.language, href: `${input.origin}${helpArticlePath(site, t.language, t.slug)}` })),
    body: `<a class="back" href="${escapeHtml(helpHomePath(site, language))}">← ${escapeHtml(s.allArticles)}</a>
<article>
<h1>${escapeHtml(article.title)}</h1>
<p class="muted">${escapeHtml(s.updated.replace('{date}', date))}</p>
${article.bodyHtml}
</article>
<form class="helpful" method="post" action="${escapeHtml(helpArticlePath(site, language, article.slug))}/feedback">
<p id="helpful-q">${escapeHtml(s.helpful)}</p>
<button type="submit" name="helpful" value="yes" aria-describedby="helpful-q">${escapeHtml(s.yes)}</button>
<button type="submit" name="helpful" value="no" aria-describedby="helpful-q">${escapeHtml(s.no)}</button>
</form>`,
  });
}

/** Where an answer to "Was this article helpful?" lands. It says the same whether or not the answer was counted. */
export function thanksPage(input: { site: HelpSite; language: string; languages: string[]; articleSlug: string }): string {
  const s = helpStrings(input.language);
  return page({
    site: { ...input.site, helpNoindex: 1 },
    language: input.language,
    languages: input.languages,
    title: `${s.helpCentre} · ${input.site.name}`,
    body: `<p role="status">${escapeHtml(s.thanks)}</p><p><a href="${escapeHtml(helpArticlePath(input.site, input.language, input.articleSlug))}">${escapeHtml(s.backToArticle)}</a> · <a href="${escapeHtml(helpHomePath(input.site, input.language))}">${escapeHtml(s.allArticles)}</a></p>`,
  });
}

export function searchPage(input: { site: HelpSite; language: string; languages: string[]; query: string; results: PublicHelpArticle[] }): string {
  const { site, language } = input;
  const s = helpStrings(language);
  const heading = s.resultsFor.replace('{q}', input.query);
  return page({
    site: { ...site, helpNoindex: 1 },
    language,
    languages: input.languages,
    query: input.query,
    title: `${heading} · ${site.name}`,
    body: `<h2>${escapeHtml(heading)}</h2>${input.results.length ? articleList(site, input.results) : `<p class="muted">${escapeHtml(s.noResults)}</p>`}`,
  });
}

export function notFoundPage(input: { site: HelpSite; language: string; languages: string[] }): string {
  const s = helpStrings(input.language);
  return page({ ...input, site: { ...input.site, helpNoindex: 1 }, title: `${s.helpCentre} · ${input.site.name}`, body: `<p>${escapeHtml(s.notFound)}</p><p><a href="${escapeHtml(helpHomePath(input.site, input.language))}">${escapeHtml(s.allArticles)}</a></p>` });
}

export function sitemapXml(origin: string, site: HelpSite, articles: PublicHelpArticle[], languages: string[]): string {
  const urls = [
    ...languages.map((l) => `<url><loc>${escapeHtml(`${origin}${helpHomePath(site, l)}`)}</loc></url>`),
    ...articles.map((a) => `<url><loc>${escapeHtml(`${origin}${helpArticlePath(site, a.language, a.slug)}`)}</loc><lastmod>${new Date(a.updatedAt).toISOString()}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`;
}
