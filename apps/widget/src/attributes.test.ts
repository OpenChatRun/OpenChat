import { describe, expect, it } from 'vitest';
import { cleanAttributes } from './attributes';

describe('cleanAttributes', () => {
  it('keeps text, numbers, and true or false', () => {
    expect(cleanAttributes({ customerId: 'C-1042', seats: 3, paying: false, balance: -1.5 })).toEqual({ customerId: 'C-1042', seats: 3, paying: false, balance: -1.5 });
  });

  it('is nothing for what is not a set of names and values, and empty for an empty one', () => {
    for (const input of [undefined, null, 'text', 3, true, [1, 2]]) expect(cleanAttributes(input)).toBeNull();
    expect(cleanAttributes({})).toEqual({});
  });

  it('leaves out values the API would refuse, without losing the rest', () => {
    expect(cleanAttributes({ plan: 'Pro', nested: { a: 1 }, list: [1], none: null, missing: undefined, nan: Number.NaN, huge: Infinity, when: new Date(0), '': 'no name' })).toEqual({ plan: 'Pro' });
  });

  it('cuts long names and values, and takes out control characters', () => {
    const clean = cleanAttributes({ ['k'.repeat(50)]: 'v'.repeat(300), 'a\tb': 'line\nbreak' })!;
    expect(clean['k'.repeat(40)]).toBe('v'.repeat(255));
    expect(clean['a b']).toBe('line break');
    expect(Object.keys(clean)).toHaveLength(2);
  });

  it('keeps the first 20, and the first of two names that end up the same', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`k${index}`, index]));
    expect(Object.keys(cleanAttributes(many)!)).toEqual(Array.from({ length: 20 }, (_, index) => `k${index}`));
    expect(cleanAttributes({ ' plan': 'first', plan: 'second' })).toEqual({ plan: 'first' });
  });
});
