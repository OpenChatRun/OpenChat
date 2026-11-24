import { describe, expect, it } from 'vitest';
import { isTimeZone, openingState, type OpeningHours } from './opening-hours';

const weekdays = (open: string, close: string, timeZone = 'Europe/London'): OpeningHours => ({ timeZone, days: [0, 1, 2, 3, 4].map(() => ({ open, close })).concat([null, null] as never) });
const at = (iso: string) => Date.parse(iso);
const state = (hours: OpeningHours | null, iso: string) => {
  const { open, opensAt } = openingState(hours, at(iso));
  return { open, opensAt: opensAt === null ? null : new Date(opensAt).toISOString() };
};

describe('opening hours', () => {
  it('is always open with no hours, or a time zone nobody knows', () => {
    expect(state(null, '2026-11-24T03:00:00Z')).toEqual({ open: true, opensAt: null });
    expect(state({ timeZone: 'Mars/Olympus', days: [] }, '2026-11-24T03:00:00Z')).toEqual({ open: true, opensAt: null });
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });

  it('is open from the opening minute to the minute before closing', () => {
    const hours = weekdays('09:00', '17:00');
    // 24 November 2026 is a Tuesday, and London is on UTC.
    expect(state(hours, '2026-11-24T09:00:00Z').open).toBe(true);
    expect(state(hours, '2026-11-24T16:59:59Z').open).toBe(true);
    expect(state(hours, '2026-11-24T17:00:00Z')).toEqual({ open: false, opensAt: '2026-11-25T09:00:00.000Z' });
    expect(state(hours, '2026-11-24T08:59:30Z')).toEqual({ open: false, opensAt: '2026-11-24T09:00:00.000Z' });
  });

  it('skips closed days', () => {
    expect(state(weekdays('09:00', '17:00'), '2026-11-27T18:00:00Z')).toEqual({ open: false, opensAt: '2026-11-30T09:00:00.000Z' });
  });

  it("reads the clock in the website's time zone", () => {
    const hours = weekdays('09:00', '17:00', 'Asia/Tokyo');
    expect(state(hours, '2026-11-24T00:00:00Z').open).toBe(true);
    expect(state(hours, '2026-11-24T08:00:00Z')).toEqual({ open: false, opensAt: '2026-11-25T00:00:00.000Z' });
    // Friday evening in London is already Saturday in Tokyo.
    expect(state(hours, '2026-11-27T16:00:00Z')).toEqual({ open: false, opensAt: '2026-11-30T00:00:00.000Z' });
  });

  it('opens at the right hour after the clocks change', () => {
    // London goes forward on Sunday 28 March 2027, so Monday 09:00 is 08:00 UTC.
    expect(state(weekdays('09:00', '17:00'), '2027-03-26T18:00:00Z')).toEqual({ open: false, opensAt: '2027-03-29T08:00:00.000Z' });
    // And back on Sunday 31 October 2027.
    expect(state(weekdays('09:00', '17:00'), '2027-10-29T18:00:00Z')).toEqual({ open: false, opensAt: '2027-11-01T09:00:00.000Z' });
  });

  it('comes back to the same day a week later, and to nothing when no day has hours', () => {
    const monday: OpeningHours = { timeZone: 'Europe/London', days: [{ open: '09:00', close: '10:00' }, null, null, null, null, null, null] };
    expect(state(monday, '2026-11-23T11:00:00Z')).toEqual({ open: false, opensAt: '2026-11-30T09:00:00.000Z' });
    expect(state({ timeZone: 'Europe/London', days: [null, null, null, null, null, null, null] }, '2026-11-23T11:00:00Z')).toEqual({ open: false, opensAt: null });
  });

  it('stays open through midnight when one day closes at 24:00 and the next opens at 00:00', () => {
    const always: OpeningHours = { timeZone: 'Europe/London', days: Array.from({ length: 7 }, () => ({ open: '00:00', close: '24:00' })) };
    expect(state(always, '2026-11-24T00:00:00Z').open).toBe(true);
    expect(state(always, '2026-11-24T23:59:59Z').open).toBe(true);
  });
});
