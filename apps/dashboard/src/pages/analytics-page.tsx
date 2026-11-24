import type { Analytics } from '@openchat/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../app-context';
import { Initials } from '../icons';
import { intlLocale, t, tn } from '../i18n';

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** A wait as people say it: seconds under a minute, then minutes, hours, and days from two days on. */
export function duration(seconds: number): string {
  const [value, unit] = seconds < 60 ? [seconds, 'second'] : seconds < 3600 ? [seconds / 60, 'minute'] : seconds < 172_800 ? [seconds / 3600, 'hour'] : [seconds / 86_400, 'day'];
  return new Intl.NumberFormat(intlLocale(), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: value < 10 && unit !== 'second' ? 1 : 0 }).format(value);
}

export const percent = (part: number, whole: number) => new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(whole === 0 ? 0 : part / whole);
// A date with no time is read as UTC, and shown as UTC, so that it stays the day the server named.
const dayLabel = (date: string, style: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(), { ...style, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

function Tile({ label, value, detail }: { label: string; value: string; detail?: string | undefined }) {
  return (
    <div className="card">
      <div className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {detail && <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{detail}</div>}
    </div>
  );
}

/** One bar a day. The whole column is the target, and the day under the pointer, or in focus, is named above. */
function DailyChart({ days }: { days: Analytics['days'] }) {
  const [active, setActive] = useState<number | null>(null);
  const top = Math.max(1, ...days.map((day) => day.started));
  const shown = active === null ? null : days[active];
  const number = new Intl.NumberFormat(intlLocale());
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('analyticsPerDay')}</h2>
        <p className="text-xs text-slate-600 tabular-nums dark:text-slate-400" aria-live="polite">
          {shown ? `${dayLabel(shown.date, { dateStyle: 'full' })}: ${number.format(shown.started)}` : ' '}
        </p>
      </div>
      <div className="flex gap-2">
        <div className="flex h-40 flex-col justify-between text-right text-xs text-slate-500 tabular-nums dark:text-slate-400" aria-hidden="true">
          <span>{number.format(top)}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex h-40 items-stretch border-b border-slate-200 dark:border-slate-800" onMouseLeave={() => setActive(null)}>
            {days.map((day, index) => (
              <button
                key={day.date}
                type="button"
                className={`group flex min-w-0 flex-1 cursor-default items-end justify-center px-px focus:outline-none ${active === index ? 'bg-slate-100 dark:bg-slate-900' : ''}`}
                aria-label={`${dayLabel(day.date, { dateStyle: 'long' })}: ${number.format(day.started)}`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <span
                  className={`w-full max-w-6 bg-brand-500 ${days.length > 31 ? 'rounded-t-xs' : 'rounded-t'} ${active === index ? 'opacity-100' : 'opacity-90'}`}
                  // A day with something always shows, however tall the tallest day is.
                  style={{ height: day.started === 0 ? 0 : `max(2px, ${(day.started / top) * 100}%)` }}
                />
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400" aria-hidden="true">
            <span>{dayLabel(days[0]!.date, { month: 'short', day: 'numeric' })}</span>
            <span>{dayLabel(days[days.length - 1]!.date, { month: 'short', day: 'numeric' })}</span>
          </div>
        </div>
      </div>
      <details className="text-sm">
        <summary className="link cursor-pointer text-xs">{t('analyticsShowTable')}</summary>
        <table className="mt-2 w-full max-w-sm text-left text-xs tabular-nums">
          <thead>
            <tr className="text-slate-600 dark:text-slate-400">
              <th scope="col" className="py-1 font-medium">{t('analyticsDate')}</th>
              <th scope="col" className="py-1 text-right font-medium">{t('analyticsStarted')}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date} className="border-t border-slate-200 dark:border-slate-800">
                <td className="py-1">{dayLabel(day.date, { dateStyle: 'medium' })}</td>
                <td className="py-1 text-right">{number.format(day.started)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** For supervisors: it names each member's replies. The API refuses anyone else. */
export function AnalyticsPage({ workspaceId, isSupervisor }: { workspaceId: string; isSupervisor: boolean }) {
  const [days, setDays] = useState<Period>(7);
  const analytics = useQuery({
    queryKey: ['analytics', workspaceId, days],
    queryFn: () => api.getAnalytics(workspaceId, { days, utcOffsetMinutes: -new Date().getTimezoneOffset() }),
    enabled: isSupervisor,
    placeholderData: keepPreviousData,
  });
  const members = useQuery({ queryKey: ['members', workspaceId], queryFn: () => api.listMembers(workspaceId), enabled: isSupervisor });
  if (!isSupervisor) return <p className="card text-sm">{t('supervisorAnalytics')}</p>;

  const data = analytics.data;
  const number = new Intl.NumberFormat(intlLocale());
  const nameOf = (memberId: string) => members.data?.data.find((member) => member.id === memberId)?.name ?? null;
  return (
    <section className="space-y-4" aria-label={t('sectionAnalytics')}>
      {analytics.error && <p className="error" role="alert">{errorMessage(analytics.error)}</p>}
      <div className="tabs" role="group" aria-label={t('analyticsPeriod')}>
        {PERIODS.map((period) => (
          <button key={period} type="button" className="tab" aria-pressed={days === period} onClick={() => setDays(period)}>
            {tn('analyticsLastDays', period)}
          </button>
        ))}
      </div>
      {analytics.isPending && <p className="text-sm" role="status">{t('loading')}</p>}
      {data && (
        <>
          {data.truncated && <p className="error">{t('analyticsTruncated')}</p>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('analyticsStarted')} value={number.format(data.started)} />
            <Tile label={t('analyticsReplied')} value={number.format(data.replied)} detail={t('analyticsOfStarted', { percent: percent(data.replied, data.started) })} />
            <Tile label={t('analyticsFirstReply')} value={data.medianFirstReplySeconds === null ? '–' : duration(data.medianFirstReplySeconds)} />
            <Tile label={t('analyticsResolved')} value={number.format(data.resolved)} detail={t('analyticsOfStarted', { percent: percent(data.resolved, data.started) })} />
            {data.ratedGood + data.ratedBad > 0 && (
              <Tile label={t('analyticsRatings')} value={percent(data.ratedGood, data.ratedGood + data.ratedBad)} detail={t('analyticsRatingsDetail', { good: number.format(data.ratedGood), bad: number.format(data.ratedBad) })} />
            )}
            {data.assistantAnswered > 0 && (
              <Tile label={t('analyticsAssistant')} value={number.format(data.assistantAnswered)} detail={t('analyticsAssistantOnly', { count: number.format(data.assistantOnly) })} />
            )}
          </div>
          <DailyChart days={data.days} />
          <div className="card space-y-2">
            <h2 className="text-sm font-semibold">{t('analyticsByMember')}</h2>
            {data.members.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('analyticsNoReplies')}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-slate-600 dark:text-slate-400">
                    <th scope="col" className="py-1 font-medium">{t('name')}</th>
                    <th scope="col" className="py-1 text-right font-medium">{t('analyticsReplies')}</th>
                    <th scope="col" className="py-1 text-right font-medium">{t('analyticsStarted')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((row) => (
                    <tr key={row.memberId} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <span className="avatar size-7" aria-hidden="true"><Initials name={nameOf(row.memberId)} /></span>
                          {nameOf(row.memberId) ?? t('analyticsFormerMember')}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{number.format(row.replies)}</td>
                      <td className="py-2 text-right tabular-nums">{number.format(row.conversations)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">{t('analyticsBasis')}</p>
        </>
      )}
    </section>
  );
}
