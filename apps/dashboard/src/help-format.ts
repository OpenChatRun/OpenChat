/**
 * The help centre editor's toolbar: each button changes the Markdown around the selection, and says what to select
 * afterwards. Pure, so that it can be tested without a text box. The Markdown is the subset in help-text.ts.
 */
export type HelpFormat = 'bold' | 'italic' | 'heading' | 'bullets' | 'numbers' | 'quote' | 'link' | 'code';

export interface Edit {
  text: string;
  /** The selection afterwards. */
  start: number;
  end: number;
}

const WRAPS: Partial<Record<HelpFormat, string>> = { bold: '**', italic: '_', code: '`' };
const HEADING = /^#{1,3}\s+/;
const BULLET = /^\s*[-*+]\s+/;
const NUMBER = /^\s*\d{1,3}[.)]\s+/;
const QUOTE = /^>\s?/;

/** Wraps the selection in a mark, or takes the mark away if it is already there, inside or just outside. */
function wrap(text: string, start: number, end: number, mark: string): Edit {
  const selected = text.slice(start, end);
  const n = mark.length;
  if (selected.length >= 2 * n && selected.startsWith(mark) && selected.endsWith(mark)) {
    return { text: text.slice(0, start) + selected.slice(n, -n) + text.slice(end), start, end: end - 2 * n };
  }
  if (text.slice(start - n, start) === mark && text.slice(end, end + n) === mark) {
    return { text: text.slice(0, start - n) + selected + text.slice(end + n), start: start - n, end: end - n };
  }
  return { text: text.slice(0, start) + mark + selected + mark + text.slice(end), start: start + n, end: end + n };
}

/** Changes the start of every line the selection touches. If they all have the prefix already, it is removed. */
function lines(text: string, start: number, end: number, has: RegExp, prefix: (index: number) => string, others: RegExp[]): Edit {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const found = text.indexOf('\n', end > start && text[end - 1] === '\n' ? end - 1 : end);
  const to = found === -1 ? text.length : found;
  const block = text.slice(from, to).split('\n');
  const all = block.some((line) => has.test(line)) && block.every((line) => has.test(line) || line.trim() === '');
  const changed = block.map((line, index) => {
    if (all) return line.replace(has, '');
    if (line.trim() === '' && block.length > 1) return line;
    let bare = line.replace(has, '');
    for (const other of others) bare = bare.replace(other, '');
    return prefix(index) + bare;
  });
  const out = changed.join('\n');
  return { text: text.slice(0, from) + out + text.slice(to), start: from, end: from + out.length };
}

export function applyHelpFormat(text: string, start: number, end: number, format: HelpFormat): Edit {
  const mark = WRAPS[format];
  if (mark) return wrap(text, start, end, mark);
  if (format === 'link') {
    const label = text.slice(start, end) || 'link';
    const before = `${text.slice(0, start)}[${label}](`;
    // The address is selected, ready to be typed over.
    return { text: `${before}https://)${text.slice(end)}`, start: before.length, end: before.length + 'https://'.length };
  }
  if (format === 'heading') return lines(text, start, end, HEADING, () => '## ', [BULLET, NUMBER, QUOTE]);
  if (format === 'bullets') return lines(text, start, end, BULLET, () => '- ', [NUMBER, HEADING]);
  if (format === 'numbers') {
    let n = 0;
    return lines(text, start, end, NUMBER, () => `${++n}. `, [BULLET, HEADING]);
  }
  return lines(text, start, end, QUOTE, () => '> ', []);
}
