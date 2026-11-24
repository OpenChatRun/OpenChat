/**
 * The Analytics page: what happened to the conversations started in the last days. Everything is counted from those
 * conversations, so the numbers agree with each other. For supervisors, because it shows each member's replies.
 */
import { analyticsRepository, type Database, type WorkspaceContext } from '@openchat/database';
import { requireCapability } from './workspaces';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const median = (sorted: number[]) => (sorted.length === 0 ? null : sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2);

/**
 * `days` whole days ending today, where a day is the viewer's: `utcOffsetMinutes` is how far their clock is ahead of
 * UTC now. One offset for the whole period, so a clock change inside it moves that boundary by an hour.
 */
export async function getAnalytics(db: Database, ctx: WorkspaceContext, input: { days: number; utcOffsetMinutes: number }, now = Date.now()) {
  requireCapability(ctx, 'analytics.view');
  const offset = input.utcOffsetMinutes * MINUTE_MS;
  const firstDay = Math.floor((now + offset) / DAY_MS) * DAY_MS - (input.days - 1) * DAY_MS;
  const from = firstDay - offset;
  const { conversations, members, truncated } = await analyticsRepository(db, ctx).period(from, now + 1);

  const days = Array.from({ length: input.days }, (_, n) => ({ date: new Date(firstDay + n * DAY_MS).toISOString().slice(0, 10), started: 0 }));
  const waits: number[] = [];
  let replied = 0;
  let resolved = 0;
  let assistantAnswered = 0;
  let assistantOnly = 0;
  let ratedGood = 0;
  let ratedBad = 0;
  for (const row of conversations) {
    const day = days[Math.floor((row.createdAt + offset - firstDay) / DAY_MS)];
    if (day) day.started += 1;
    if (row.firstReplyAt !== null) {
      replied += 1;
      waits.push(Math.max(0, row.firstReplyAt - row.createdAt));
    }
    if (row.status === 'resolved' || row.status === 'archived') resolved += 1;
    if (row.rating === 'good') ratedGood += 1;
    else if (row.rating === 'bad') ratedBad += 1;
    if (row.assistant) {
      assistantAnswered += 1;
      if (row.firstReplyAt === null) assistantOnly += 1;
    }
  }
  const wait = median(waits.sort((a, b) => a - b));
  return {
    from: new Date(from).toISOString(),
    to: new Date(now).toISOString(),
    truncated,
    started: conversations.length,
    replied,
    resolved,
    medianFirstReplySeconds: wait === null ? null : Math.round(wait / 1000),
    assistantAnswered,
    assistantOnly,
    ratedGood,
    ratedBad,
    days,
    members,
  };
}
