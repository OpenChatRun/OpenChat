import { describe, expect, it } from 'vitest';
import { applyHelpFormat, type HelpFormat } from './help-format';

/** `[` and `]` mark the selection, before and after. */
function run(marked: string, format: HelpFormat): string {
  const start = marked.indexOf('[');
  const end = marked.indexOf(']') - 1;
  const text = marked.replace('[', '').replace(']', '');
  const edit = applyHelpFormat(text, start, end, format);
  return `${edit.text.slice(0, edit.start)}[${edit.text.slice(edit.start, edit.end)}]${edit.text.slice(edit.end)}`;
}

describe('the help editor toolbar', () => {
  it('wraps the selection, and unwraps it again', () => {
    expect(run('a [word] here', 'bold')).toBe('a **[word]** here');
    expect(run('a **[word]** here', 'bold')).toBe('a [word] here');
    expect(run('a [**word**] here', 'bold')).toBe('a [word] here');
    expect(run('a [word] here', 'italic')).toBe('a _[word]_ here');
    expect(run('a [word] here', 'code')).toBe('a `[word]` here');
  });

  it('with nothing selected, leaves the caret between the marks', () => {
    expect(run('ab[]', 'bold')).toBe('ab**[]**');
    expect(run('[]', 'italic')).toBe('_[]_');
  });

  it('makes a link, with the address ready to type over', () => {
    const chosen = applyHelpFormat('see our prices now', 4, 14, 'link');
    expect(chosen.text).toBe('see [our prices](https://) now');
    expect(chosen.text.slice(chosen.start, chosen.end)).toBe('https://');
    const edit = applyHelpFormat('see', 3, 3, 'link');
    expect(edit.text).toBe('see[link](https://)');
    expect(edit.text.slice(edit.start, edit.end)).toBe('https://');
  });

  it('turns whole lines into a heading, whatever part is selected', () => {
    expect(run('one\ntw[]o\nthree', 'heading')).toBe('one\n[## two]\nthree');
    expect(run('one\n## tw[]o\nthree', 'heading')).toBe('one\n[two]\nthree');
    expect(run('- tw[]o', 'heading')).toBe('[## two]');
  });

  it('lists every line the selection touches, and skips blank ones', () => {
    expect(run('o[ne\n\ntw]o', 'bullets')).toBe('[- one\n\n- two]');
    expect(run('[- one\n- two]', 'bullets')).toBe('[one\ntwo]');
    expect(run('[one\ntwo\n]three', 'numbers')).toBe('[1. one\n2. two]\nthree');
    expect(run('[- one\n- two]', 'numbers')).toBe('[1. one\n2. two]');
    expect(run('[1. one\n2. two]', 'bullets')).toBe('[- one\n- two]');
  });

  it('quotes, and unquotes', () => {
    expect(run('[one\ntwo]', 'quote')).toBe('[> one\n> two]');
    expect(run('[> one\n> two]', 'quote')).toBe('[one\ntwo]');
    expect(run('[]', 'quote')).toBe('[> ]');
  });
});
