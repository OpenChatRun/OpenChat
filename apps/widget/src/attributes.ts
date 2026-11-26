/**
 * What the page says about its visitor, such as a customer number, with `OpenChatConfig.attributes` or
 * `OpenChat.setAttributes()`. The API refuses a whole update for one bad entry, so what it would refuse is left out
 * or cut short here: a page's mistake with one value should not cost the team the rest.
 * The limits are VISITOR_ATTRIBUTE_LIMITS in the contract, which this bundle cannot import.
 */
export type Attributes = Record<string, string | number | boolean>;

const ENTRIES = 20;
const KEY_CHARS = 40;
const VALUE_CHARS = 255;
const CONTROL = /\p{Cc}/gu;

/** Null when the page gave nothing that is a set of names and values. An empty set is something: it clears. */
export function cleanAttributes(input: unknown): Attributes | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const clean: Attributes = {};
  let count = 0;
  for (const [name, value] of Object.entries(input)) {
    if (count === ENTRIES) break;
    const key = name.replace(CONTROL, ' ').trim().slice(0, KEY_CHARS);
    if (!key || key in clean) continue;
    if (typeof value === 'string') clean[key] = value.replace(CONTROL, ' ').slice(0, VALUE_CHARS);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) clean[key] = value;
    else continue;
    count += 1;
  }
  return clean;
}
