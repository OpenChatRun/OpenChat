/**
 * Language tags for automatic translation (ADR-0024). A visitor's language is whatever their widget or browser gave;
 * a member's is one of OpenChat's own.
 */

/** The tag in its usual spelling, such as `pt-BR` for `PT_br`, or null if it is not a well-formed BCP 47 tag. */
export function canonicalLanguage(tag: string): string | null {
  const trimmed = tag.trim().replace(/_/g, '-');
  if (trimmed.length === 0 || trimmed.length > 35) return null;
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether two tags are the same language for a reader, so that nothing need be translated: the primary subtag
 * decides, so `en-GB` and `en-US` match, except that Chinese in Simplified and in Traditional script do not.
 */
export function sameLanguage(a: string, b: string): boolean {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  const primary = (tag: string) => tag.split('-')[0];
  if (primary(x) !== primary(y)) return false;
  return primary(x) !== 'zh' || chineseScript(x) === chineseScript(y);
}

/** Traditional for the script by name, and for Taiwan, Hong Kong and Macau, as the widget picks its strings. */
const chineseScript = (tag: string) => (/^zh-(hant|tw|hk|mo)\b/.test(tag) ? 'hant' : 'hans');
