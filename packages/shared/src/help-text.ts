/**
 * Help centre text (ADR-0023): the Markdown subset articles are written in, rendered to HTML by construction from
 * an allow-list, and the plain text that search reads. Shared, so that the dashboard's preview is the server's
 * own rendering.
 *
 * Nothing in the source reaches the HTML unescaped. There is no raw HTML. Links are https, mailto, or a path on
 * this installation's help centre. Images come only from /help-assets/, so a page never loads anything from
 * elsewhere.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

export const HELP_ASSET_PATH = /^\/help-assets\/hast_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Where a link may go. Anything else is shown as its text. */
export function safeHelpLink(url: string): boolean {
  if (url.startsWith('/help/')) return !url.includes('//') && !/[\\\s]/.test(url);
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  if (parsed.protocol === 'mailto:') return true;
  return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
}

const INLINE =
  /`([^`\n]+)`|!\[([^\]\n]*)\]\(([^()\s]+)\)|\[([^\]\n]+)\]\(([^()\s]+)\)|\*\*(?=\S)([^*\n]+?)\*\*|\*(?=\S)([^*\n]+?)\*|(?<![\p{L}\p{N}])_(?=\S)([^_\n]+?)_(?![\p{L}\p{N}])/gu;

function inline(text: string): string {
  let out = '';
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    out += escapeHtml(text.slice(at, match.index));
    at = match.index + match[0].length;
    const [whole, code, alt, src, label, href, bold, italic, underscored] = match;
    if (code !== undefined) out += `<code>${escapeHtml(code)}</code>`;
    else if (src !== undefined) out += HELP_ASSET_PATH.test(src) ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt ?? '')}" loading="lazy">` : escapeHtml(whole);
    else if (href !== undefined) {
      out += safeHelpLink(href)
        ? `<a href="${escapeHtml(href)}"${href.startsWith('/') ? '' : ' target="_blank" rel="noopener nofollow ugc"'}>${inline(label!)}</a>`
        : inline(label!);
    } else if (bold !== undefined) out += `<strong>${inline(bold)}</strong>`;
    else out += `<em>${inline((italic ?? underscored)!)}</em>`;
  }
  return out + escapeHtml(text.slice(at));
}

type Block = { kind: 'p' | 'quote'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```/;

/** Article Markdown to HTML. `#` is the first heading level inside an article, shown as h2: h1 is its title. */
export function renderHelpMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let open: Block | null = null;
  const close = () => {
    const block = open as Block | null;
    if (!block) return;
    if ('lines' in block) {
      const text = block.lines.map(inline).join('<br>');
      html.push(block.kind === 'quote' ? `<blockquote><p>${text}</p></blockquote>` : `<p>${text}</p>`);
    } else html.push(`<${block.kind}>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${block.kind}>`);
    open = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      close();
      const code: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]!); i++) code.push(lines[i]!);
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.trim() === '') {
      close();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      const level = heading[1]!.length + 1;
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    if (RULE.test(line)) {
      close();
      html.push('<hr>');
      continue;
    }
    const quote = QUOTE.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const kind = quote ? 'quote' : bullet ? 'ul' : numbered ? 'ol' : 'p';
    const content = (quote ?? bullet ?? numbered)?.[1] ?? line.trim();
    const current = open as Block | null;
    if (current && current.kind === kind) {
      if ('items' in current) current.items.push(content);
      else current.lines.push(content);
      continue;
    }
    // A line after a list item, without a marker, continues it.
    if (current && 'items' in current && kind === 'p' && /^\s/.test(line)) {
      current.items[current.items.length - 1] += ` ${content}`;
      continue;
    }
    close();
    open = kind === 'ul' || kind === 'ol' ? { kind, items: [content] } : { kind, lines: [content] };
  }
  close();
  return html.join('\n');
}

/** What a person reads, without the Markdown: for search, and for a summary nobody wrote. */
export function helpMarkdownToText(source: string): string {
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```.*$/gm, '')
    .replace(/!\[([^\]\n]*)\]\([^()\s]+\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^()\s]+\)/g, '$1')
    .replace(/^(?:#{1,3}\s+|>\s?|\s*[-*+]\s+|\s*\d{1,3}[.)]\s+)/gm, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/[*`]|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Text as search compares it: compatibility forms folded (full-width letters become ASCII), accents removed from
 * Latin, Greek and Cyrillic letters, lower case. Japanese and Korean keep theirs: a mark there changes the word.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+/gu;
export const MAX_SEARCH_TERMS = 12;

/**
 * What to look for. Words in languages that space them; overlapping pairs of characters in Chinese, Japanese and
 * Korean, which do not, so that 返品 matches 返品について. Every term must match.
 */
export function helpSearchTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const token of normalizeSearchText(query).split(/[^\p{L}\p{N}ー]+/u)) {
    for (const run of token.match(CJK_RUN) ?? []) {
      if (CJK.test(run)) {
        if (run.length <= 2) terms.add(run);
        else for (let i = 0; i + 2 <= run.length; i++) terms.add(run.slice(i, i + 2));
      } else if (run.length >= 2) terms.add(run);
    }
  }
  return [...terms].slice(0, MAX_SEARCH_TERMS);
}

/** A slug from a title: letters and digits in any script, joined by hyphens. Empty if there are none. */
export function helpSlug(title: string): string {
  return normalizeSearchText(title)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

export const HELP_SLUG_PATTERN = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u;

/** The languages a help centre can be written in: the dashboard's and the widget's. */
export const HELP_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh-Hans', 'zh-Hant'] as const;
export type HelpLanguage = (typeof HELP_LANGUAGES)[number];
