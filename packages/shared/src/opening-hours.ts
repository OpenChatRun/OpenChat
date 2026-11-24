/**
 * A website's opening hours: one period a day, in the website's own time zone. `days` starts on Monday. A day
 * that is null is closed. `close` may be 24:00.
 */
export interface OpeningHours {
  timeZone: string;
  days: ({ open: string; close: string } | null)[];
}

const MINUTE = 60_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const clockMinutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The day, Monday being 0, and the minute of that day, on a clock in this time zone. */
function localClock(timeZone: string, at: number): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: WEEKDAYS.indexOf(part('weekday')), minute: Number(part('hour')) * 60 + Number(part('minute')) };
}

/**
 * Whether the website is open now, and if not, when it next opens. With no hours it is always open. `opensAt` is
 * null when it is open, and when no day has hours.
 */
export function openingState(hours: OpeningHours | null | undefined, now: number): { open: boolean; opensAt: number | null } {
  if (!hours || !isTimeZone(hours.timeZone)) return { open: true, opensAt: null };
  const local = localClock(hours.timeZone, now);
  const today = hours.days[local.day];
  if (today && clockMinutes(today.open) <= local.minute && local.minute < clockMinutes(today.close)) return { open: true, opensAt: null };
  // Today again at the end, for a website open one day a week whose hours have passed.
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const day = hours.days[(local.day + ahead) % 7];
    if (!day) continue;
    const opens = clockMinutes(day.open);
    if (ahead === 0 && opens <= local.minute) continue;
    let at = Math.floor(now / MINUTE) * MINUTE + (ahead * 1440 + opens - local.minute) * MINUTE;
    // The clocks may change before then, which moves that moment by the size of the change.
    const drift = (((opens - localClock(hours.timeZone, at).minute) % 1440) + 1440) % 1440;
    at += (drift > 720 ? drift - 1440 : drift) * MINUTE;
    return { open: false, opensAt: at };
  }
  return { open: false, opensAt: null };
}
