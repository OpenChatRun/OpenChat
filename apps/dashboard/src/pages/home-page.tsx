/**
 * The dashboard: what is waiting in the inbox now, the last week for supervisors, and whether this member counts as
 * online. Everything here comes from what the inbox and Analytics already ask for.
 */
import type { Me } from '@openchat/api-client';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../app-context';
import { intlLocale, t } from '../i18n';
import { duration, percent } from './analytics-page';
import { AwaySetting } from './away-setting';

type Membership = Me['memberships'][number];

function Tile({ label, value, detail, onClick }: { label: string; value: string; detail?: string | undefined; onClick: () => void }) {
  return (
    <button type="button" className="card flex cursor-pointer flex-col items-start justify-start text-left transition-colors hover:border-brand-300 dark:hover:border-slate-600" onClick={onClick}>
      <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <span className="mt-1 block text-2xl font-semibold tabular-nums">{value}</span>
      {detail && <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">{detail}</span>}
    </button>
  );
}

export function HomePage({ membership, name, onOpenInbox, onOpenAnalytics }: { membership: Membership; name: string; onOpenInbox: () => void; onOpenAnalytics: () => void }) {
  const workspaceId = membership.workspace.id;
  const isSupervisor = membership.role === 'supervisor';
  const summary = useQuery({ queryKey: ['inbox-summary', workspaceId], queryFn: () => api.getInboxSummary(workspaceId), refetchInterval: 30_000 });
  const week = useQuery({
    queryKey: ['analytics', workspaceId, 7],
    queryFn: () => api.getAnalytics(workspaceId, { days: 7, utcOffsetMinutes: -new Date().getTimezoneOffset() }),
    enabled: isSupervisor,
  });
  const number = new Intl.NumberFormat(intlLocale());
  const error = summary.error ?? week.error;
  const rated = week.data ? week.data.ratedGood + week.data.ratedBad : 0;
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold tracking-tight">{t('homeGreeting', { name })}</h2>
      {error ? <p className="error" role="alert">{errorMessage(error)}</p> : null}
      <section className="space-y-3" aria-label={t('homeInbox')}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('homeInbox')}</h2>
          <button type="button" className="text-sm text-brand-600 underline dark:text-brand-300" onClick={onOpenInbox}>{t('homeOpenInbox')}</button>
        </div>
        {summary.data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label={t('homeOpen')} value={number.format(summary.data.open)} onClick={onOpenInbox} />
            <Tile label={t('homeUnread')} value={number.format(summary.data.unread)} onClick={onOpenInbox} />
            <Tile label={t('homeMine')} value={number.format(summary.data.mine)} onClick={onOpenInbox} />
            <Tile label={t('homeUnassigned')} value={number.format(summary.data.unassigned)} onClick={onOpenInbox} />
            <Tile label={t('homePending')} value={number.format(summary.data.pending)} onClick={onOpenInbox} />
          </div>
        )}
      </section>
      {isSupervisor && week.data && (
        <section className="space-y-3" aria-label={t('homeWeek')}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">{t('homeWeek')}</h2>
            <button type="button" className="text-sm text-brand-600 underline dark:text-brand-300" onClick={onOpenAnalytics}>{t('homeSeeAnalytics')}</button>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('analyticsStarted')} value={number.format(week.data.started)} onClick={onOpenAnalytics} />
            <Tile label={t('analyticsReplied')} value={number.format(week.data.replied)} detail={t('analyticsOfStarted', { percent: percent(week.data.replied, week.data.started) })} onClick={onOpenAnalytics} />
            <Tile label={t('analyticsFirstReply')} value={week.data.medianFirstReplySeconds === null ? '–' : duration(week.data.medianFirstReplySeconds)} onClick={onOpenAnalytics} />
            {rated > 0 ? (
              <Tile label={t('analyticsRatings')} value={percent(week.data.ratedGood, rated)} detail={t('analyticsRatingsDetail', { good: number.format(week.data.ratedGood), bad: number.format(week.data.ratedBad) })} onClick={onOpenAnalytics} />
            ) : (
              <Tile label={t('analyticsResolved')} value={number.format(week.data.resolved)} detail={t('analyticsOfStarted', { percent: percent(week.data.resolved, week.data.started) })} onClick={onOpenAnalytics} />
            )}
          </div>
        </section>
      )}
      <AwaySetting membership={membership} headingClass="text-sm font-semibold" />
    </div>
  );
}
