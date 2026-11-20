import { describe, expect, it } from 'vitest';
import { canonicalLanguage, sameLanguage } from './language';

describe('language tags', () => {
  it('spells a tag the usual way, and refuses what is not one', () => {
    expect(canonicalLanguage('PT_br')).toBe('pt-BR');
    expect(canonicalLanguage('zh-hant')).toBe('zh-Hant');
    expect(canonicalLanguage(' de ')).toBe('de');
    expect(canonicalLanguage('not a language')).toBeNull();
    expect(canonicalLanguage('')).toBeNull();
  });

  it('compares by language, keeping the two Chinese scripts apart', () => {
    expect(sameLanguage('en-GB', 'en-US')).toBe(true);
    expect(sameLanguage('de', 'en')).toBe(false);
    expect(sameLanguage('zh-Hans', 'zh-CN')).toBe(true);
    expect(sameLanguage('zh-Hant', 'zh-TW')).toBe(true);
    expect(sameLanguage('zh-Hans', 'zh-Hant')).toBe(false);
  });
});
