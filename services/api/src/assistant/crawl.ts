/**
 * Reads a page source for the assistant (ADR-0022): the start page, then pages it links to on the same host and
 * under the same path, breadth first, up to a limit. robots.txt is respected, and so are `noindex` and `nofollow`.
 * Only text is kept: no scripts, styles, navigation, headers, footers or forms.
 */
import { AssistantReadError, type PageReader, type ReadPage } from '@openchat/core';

export const ASSISTANT_USER_AGENT = 'OpenChat-Assistant/1.0 (+https://openchat.run)';
/** The token a robots.txt group can name to address this reader alone. */
const ROBOTS_TOKEN = 'openchat-assistant';
const PAGE_TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_QUEUE = 1_000;
const SKIPPED_EXTENSIONS = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|css|js|mjs|json|xml|zip|gz|tar|mp[34]|mov|avi|webm|woff2?|ttf|eot|docx?|xlsx?|pptx?)$/i;

// ---------- robots.txt ----------

interface RobotsRule {
  allow: boolean;
  pattern: string;
}

/** The rules for this reader: from a group naming it, or else from the `*` group. */
export function robotsRules(text: string): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow allows everything, so it adds no rule.
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
    }
  }
  const mine = groups.filter((g) => g.agents.some((agent) => agent !== '*' && ROBOTS_TOKEN.startsWith(agent)));
  const chosen = mine.length > 0 ? mine : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function ruleMatches(pattern: string, path: string): number {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(`^${body.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return regex.test(path) ? body.length : -1;
}

/** The longest matching rule wins, and Allow wins a tie, as RFC 9309 says. */
export function robotsAllows(rules: RobotsRule[], path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const rule of rules) {
    const length = ruleMatches(rule.pattern, path);
    if (length > best || (length === best && rule.allow)) {
      best = length;
      allowed = rule.allow;
    }
  }
  return allowed;
}

// ---------- HTML to text ----------

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€', pound: '£', yen: '¥', middot: '·', bull: '•', laquo: '«', raquo: '»',
  aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', atilde: 'ã', aring: 'å', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', iacute: 'í', igrave: 'ì',
  icirc: 'î', iuml: 'ï', oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', otilde: 'õ', oslash: 'ø', uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  ccedil: 'ç', ntilde: 'ñ', szlig: 'ß', aelig: 'æ', oelig: 'œ', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', Eacute: 'É', Ccedil: 'Ç', Ntilde: 'Ñ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED[name] ?? NAMED[name.toLowerCase()] ?? match;
  });
}

const SKIPPED = ['head', 'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'nav', 'header', 'footer', 'form', 'aside', 'button', 'select'];
const BLOCKS = ['p', 'div', 'section', 'article', 'main', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'blockquote', 'pre', 'table', 'ul', 'ol'];

export interface ParsedPage {
  title: string;
  text: string;
  links: string[];
  noindex: boolean;
  nofollow: boolean;
}

/** Streams the page through HTMLRewriter, keeping text outside the skipped elements, and the links. */
export async function parseHtml(response: Response): Promise<ParsedPage> {
  let skipped = 0;
  let title = '';
  let text = '';
  let noindex = false;
  let nofollow = false;
  const links: string[] = [];
  const rewriter = new HTMLRewriter()
    .on('title', { text: (chunk) => void (title += chunk.text) })
    .on('meta[name="robots" i]', {
      element(element) {
        const content = (element.getAttribute('content') ?? '').toLowerCase();
        if (/\b(noindex|none)\b/.test(content)) noindex = true;
        if (/\b(nofollow|none)\b/.test(content)) nofollow = true;
      },
    })
    .on('a[href]', {
      element(element) {
        if (!/\bnofollow\b/i.test(element.getAttribute('rel') ?? '')) links.push(element.getAttribute('href')!);
      },
    })
    .on(SKIPPED.join(','), {
      element(element) {
        skipped += 1;
        element.onEndTag(() => void (skipped -= 1));
      },
    })
    .on(BLOCKS.join(','), {
      element(element) {
        text += '\n';
        if (element.tagName !== 'br') element.onEndTag(() => void (text += '\n'));
      },
    })
    .onDocument({
      text(chunk) {
        if (skipped === 0) text += chunk.text;
      },
    });
  await rewriter.transform(response).arrayBuffer();
  const clean = decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: decodeEntities(title).replace(/\s+/g, ' ').trim(), text: clean, links, noindex, nofollow };
}

// ---------- Fetching ----------

/** The body, or null if it is bigger than the limit. */
async function limitedBody(response: Response): Promise<Response | null> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_PAGE_BYTES) return null;
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_PAGE_BYTES) return null;
  return new Response(buffer, { headers: response.headers });
}

/** The directory of the start page: only pages under it are read. */
export function scopeOf(start: URL): string {
  return start.pathname.endsWith('/') ? start.pathname : start.pathname.slice(0, start.pathname.lastIndexOf('/') + 1);
}

/** The same host, give or take a leading www., over https. */
export function sameSite(a: URL, b: URL): boolean {
  const bare = (host: string) => host.replace(/^www\./, '');
  return a.protocol === 'https:' && b.protocol === 'https:' && !a.port && !b.port && bare(a.hostname) === bare(b.hostname);
}

export function pageReader(fetcher: typeof fetch = fetch): PageReader {
  const get = (url: string) => fetcher(url, { headers: { 'user-agent': ASSISTANT_USER_AGENT, accept: 'text/html, text/plain;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });

  async function rulesFor(origin: string): Promise<RobotsRule[]> {
    let response: Response;
    try {
      response = await get(`${origin}/robots.txt`);
    } catch {
      throw new AssistantReadError('unreachable');
    }
    // A server error means the site cannot say what it allows, so nothing is read (RFC 9309, 2.3.1.4).
    if (response.status >= 500) throw new AssistantReadError('unreachable');
    if (!response.ok) return [];
    const body = await limitedBody(response);
    return body ? robotsRules(await body.text()) : [];
  }

  return async (start, maxPages) => {
    let startUrl = new URL(start);
    let scope = scopeOf(startUrl);
    let rules = await rulesFor(startUrl.origin);
    if (!robotsAllows(rules, startUrl.pathname + startUrl.search)) throw new AssistantReadError('blocked_by_robots');

    const inScope = (url: URL) => url.origin === startUrl.origin && url.pathname.startsWith(scope) && !SKIPPED_EXTENSIONS.test(url.pathname) && robotsAllows(rules, url.pathname + url.search);
    const queue = [startUrl.href];
    const seen = new Set(queue);
    const pages: ReadPage[] = [];
    let first = true;

    while (queue.length > 0 && pages.length < maxPages) {
      const href = queue.shift()!;
      const isStart = first;
      first = false;
      let response: Response;
      try {
        response = await get(href);
      } catch {
        if (isStart) throw new AssistantReadError('unreachable');
        continue;
      }
      const final = new URL(response.url || href);
      // A website often sends its bare domain to www, or the other way. The start page may move so, and then the
      // site is read from where it went, under that host's robots.txt.
      if (isStart && response.ok && final.origin !== startUrl.origin && sameSite(final, startUrl)) {
        startUrl = final;
        scope = scopeOf(final);
        rules = await rulesFor(final.origin);
        if (!robotsAllows(rules, final.pathname + final.search)) throw new AssistantReadError('blocked_by_robots');
        seen.add(final.href);
      }
      // Any other redirect may lead off the site. Then the page is not read.
      if (!response.ok || (!isStart && !inScope(final)) || final.origin !== startUrl.origin) {
        if (isStart) throw new AssistantReadError('unreachable');
        continue;
      }
      const type = (response.headers.get('content-type') ?? '').toLowerCase();
      const html = type.includes('text/html') || type.includes('application/xhtml');
      if (!html && !type.includes('text/plain')) {
        if (isStart) throw new AssistantReadError('not_html');
        continue;
      }
      const body = await limitedBody(response);
      if (!body) {
        if (isStart) throw new AssistantReadError('too_large');
        continue;
      }
      const parsed: ParsedPage = html ? await parseHtml(body) : { title: '', text: await body.text(), links: [], noindex: false, nofollow: false };
      if (!parsed.noindex && parsed.text) pages.push({ url: final.href, title: parsed.title || final.pathname, text: parsed.text });
      if (parsed.nofollow) continue;
      for (const link of parsed.links) {
        let url: URL;
        try {
          url = new URL(link, final);
        } catch {
          continue;
        }
        url.hash = '';
        if (url.protocol !== 'https:' || seen.has(url.href) || seen.size >= MAX_QUEUE || !inScope(url)) continue;
        seen.add(url.href);
        queue.push(url.href);
      }
    }
    return pages;
  };
}
