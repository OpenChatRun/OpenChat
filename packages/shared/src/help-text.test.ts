import { describe, expect, it } from 'vitest';
import { helpMarkdownToText, helpSearchTerms, helpSlug, normalizeSearchText, renderHelpMarkdown, safeHelpLink } from './help-text';

describe('help article Markdown', () => {
  it('renders the subset', () => {
    expect(renderHelpMarkdown('# Title\n\nOne **two** _three_ `four`\nnext line')).toBe('<h2>Title</h2>\n<p>One <strong>two</strong> <em>three</em> <code>four</code><br>next line</p>');
    expect(renderHelpMarkdown('- a\n- b\n  more\n\n1. c\n2) d')).toBe('<ul><li>a</li><li>b more</li></ul>\n<ol><li>c</li><li>d</li></ol>');
    expect(renderHelpMarkdown('> said\n> twice\n\n---\n\n```\nx < y\n```')).toBe('<blockquote><p>said<br>twice</p></blockquote>\n<hr>\n<pre><code>x &lt; y</code></pre>');
  });

  it('never lets HTML, scripts or outside images through', () => {
    const html = renderHelpMarkdown('<script>alert(1)</script> <a href="x" onclick="y">a</a> [x](javascript:alert(1)) [y](data:text/html,hi) ![t](https://tracker.example/p.gif) **<b>**');
    expect(html).not.toMatch(/<(script|a |img|b>)/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps only links that are safe', () => {
    expect(['https://ex.com/a', 'mailto:help@ex.com', '/help/shop/en/returns'].every(safeHelpLink)).toBe(true);
    expect(['http://ex.com', 'javascript:alert(1)', '//evil.example/x', '/help//evil.example', 'https://user:pw@ex.com', '/api/v1/x'].some(safeHelpLink)).toBe(false);
    expect(renderHelpMarkdown('[Returns](/help/shop/en/returns)')).toBe('<p><a href="/help/shop/en/returns">Returns</a></p>');
  });

  it('allows images from the help centre only', () => {
    expect(renderHelpMarkdown('![Step 1](/help-assets/hast_01M7VTX8YWFXA951NQCYVSQ5Z5)')).toBe('<p><img src="/help-assets/hast_01M7VTX8YWFXA951NQCYVSQ5Z5" alt="Step 1" loading="lazy"></p>');
    expect(renderHelpMarkdown('![x](/help-assets/../api)')).not.toContain('<img');
  });

  it('leaves underscores inside words alone', () => {
    expect(renderHelpMarkdown('use snake_case_names')).toBe('<p>use snake_case_names</p>');
  });

  it('gives the plain text', () => {
    expect(helpMarkdownToText('# Hi\n\n- **bold** [link](https://x.example) ![alt](/help-assets/x)')).toBe('Hi\nbold link alt');
  });
});

describe('help search', () => {
  it('folds case, accents and full-width letters, but not Japanese marks', () => {
    expect(normalizeSearchText('Crème BRÛLÉE  Ｗｉｆｉ')).toBe('creme brulee wifi');
    expect(normalizeSearchText('が')).toBe('が');
  });

  it('splits words, and Chinese, Japanese and Korean into pairs', () => {
    expect(helpSearchTerms('Où est mon colis ?')).toEqual(['ou', 'est', 'mon', 'colis']);
    expect(helpSearchTerms('返品できますか')).toEqual(['返品', '品で', 'でき', 'きま', 'ます', 'すか']);
    expect(helpSearchTerms('반품 정책')).toEqual(['반품', '정책']);
    expect(helpSearchTerms('a % _ 返')).toEqual(['返']);
    expect(helpSearchTerms('x '.repeat(5) + 'one two three four five six seven eight nine ten eleven twelve thirteen')).toHaveLength(12);
  });

  it('makes slugs in any script', () => {
    expect(helpSlug('How do I return an item?')).toBe('how-do-i-return-an-item');
    expect(helpSlug('返品について')).toBe('返品について');
    expect(helpSlug('Café & Crème')).toBe('cafe-creme');
    expect(helpSlug('!!!')).toBe('');
  });
});
