/**
 * A workspace's websites: the list, and one website's settings in tabs. Every member sees the list and the code to
 * install; an installation admin also adds websites and changes them, here for their own workspace and on the
 * Workspaces page for any workspace.
 */
import type { Website } from '@openchat/api-client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../app-context';
import { intlLocale, t, tNode, type MessageKey } from '../i18n';
import { LANGUAGES } from '../i18n/locales';

const parseOrigins = (text: string) => text.split(/[\s,]+/).filter(Boolean);
const quiet = 'text-xs text-slate-600 dark:text-slate-400';

function Failure({ error }: { error: unknown }) {
  return error ? <p className="error" role="alert">{errorMessage(error)}</p> : null;
}

// Members and admins read the same websites through different routes, so both lists are refreshed.
const refreshWebsites = (client: QueryClient, workspaceId: string) =>
  Promise.all([client.invalidateQueries({ queryKey: ['admin-websites', workspaceId] }), client.invalidateQueries({ queryKey: ['websites', workspaceId] })]);

const snippetOf = (website: Website) => `<script src="${window.location.origin}/widget/widget.js" data-website-key="${website.websiteKey}" async></script>`;

export function CopyableSnippet({ website }: { website: Website }) {
  // It scrolls sideways, so it takes focus: a keyboard user can then scroll it with the arrow keys.
  return (
    <pre className="overflow-x-auto rounded-md bg-slate-100 p-3 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-slate-800" tabIndex={0}>
      {snippetOf(website)}
    </pre>
  );
}

function CopyCode({ website, primary = false }: { website: Website; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippetOf(website));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard here: the code is on the page to be selected by hand.
    }
  };
  return (
    <>
      <button type="button" className={primary ? 'button' : 'button-quiet'} onClick={() => void copy()}>{t(copied ? 'websiteCopied' : 'websiteCopyCode')}</button>
      <span className="sr-only" aria-live="polite">{copied ? t('websiteCopied') : ''}</span>
    </>
  );
}

/** The widget's languages are the dashboard's, each named in itself, as a visitor would look for it. */
const WIDGET_LANGUAGES = LANGUAGES;

/** What a colour input must show when nothing has been chosen. Saved only if someone chooses it. */
const DEFAULT_WIDGET_COLOR = '#0a57f5';

type OpeningHours = NonNullable<Website['settings']['openingHours']>;
type OpeningDay = { on: boolean; open: string; close: string };

/** The browser's list leaves out UTC, and may not know the zone this browser is in. */
const timeZones = (extra: string): string[] => {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, extra, ...all])].sort();
};
/** 5 January 2026 is a Monday, and the days are kept Monday first. */
const dayName = (index: number) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 5 + index));
/** A time field cannot show 24:00, so the end of the day is 00:00 there. */
const daysOf = (hours: OpeningHours | undefined): OpeningDay[] =>
  Array.from({ length: 7 }, (_, index) => {
    const day = hours?.days[index];
    if (hours) return day ? { on: true, open: day.open, close: day.close === '24:00' ? '00:00' : day.close } : { on: false, open: '09:00', close: '17:00' };
    return { on: index < 5, open: '09:00', close: '17:00' };
  });

function OpeningHoursFields({ zone, setZone, days, setDays }: { zone: string; setZone: (zone: string) => void; days: OpeningDay[]; setDays: (days: OpeningDay[]) => void }) {
  const change = (index: number, patch: Partial<OpeningDay>) => setDays(days.map((day, at) => (at === index ? { ...day, ...patch } : day)));
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">
        {t('timeZone')}
        <select className="field mt-1 w-auto font-normal" value={zone} onChange={(e) => setZone(e.target.value)}>
          {timeZones(zone).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <ul className="space-y-1">
        {days.map((day, index) => {
          const name = dayName(index);
          return (
            <li key={index} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex w-36 items-center gap-2">
                <input type="checkbox" checked={day.on} onChange={(e) => change(index, { on: e.target.checked })} />
                {name}
              </label>
              <input className="field w-auto py-1" type="time" required={day.on} disabled={!day.on} value={day.open} aria-label={t('dayOpens', { day: name })} onChange={(e) => change(index, { open: e.target.value })} />
              <span aria-hidden="true">–</span>
              <input className="field w-auto py-1" type="time" required={day.on} disabled={!day.on} value={day.close} aria-label={t('dayCloses', { day: name })} onChange={(e) => change(index, { close: e.target.value })} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Roughly what a visitor sees, from what is in the form now. Decoration: the fields beside it say the same. */
function WidgetPreview({ name, color, welcome }: { name: string; color: string; welcome: string }) {
  return (
    <div aria-hidden="true" className="flex flex-col items-end gap-3">
      <div className="w-full max-w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <div className="px-4 py-3 text-sm font-semibold text-white" style={{ background: color }}>{name}</div>
        <div className="min-h-32 space-y-2 p-3">
          {welcome.trim() && <p className="w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-sm whitespace-pre-wrap break-words dark:bg-slate-800">{welcome.trim()}</p>}
        </div>
        <div className="mx-3 mb-3 h-9 rounded-full border border-slate-200 dark:border-slate-800" />
      </div>
      <div className="size-12 rounded-full shadow-lg" style={{ background: color }} />
    </div>
  );
}

type Tab = 'install' | 'appearance' | 'chat' | 'hours' | 'details';
const TABS: { tab: Tab; label: MessageKey }[] = [
  { tab: 'install', label: 'websiteTabInstall' },
  { tab: 'appearance', label: 'websiteTabAppearance' },
  { tab: 'chat', label: 'websiteTabChat' },
  { tab: 'hours', label: 'openingHours' },
  { tab: 'details', label: 'websiteTabDetails' },
];

/** One website. Everything is one form, saved together, whichever tab is showing. */
function WebsiteEditor({ website, workspaceId, onClose }: { website: Website; workspaceId: string; onClose: () => void }) {
  const client = useQueryClient();
  const initial = website.settings;
  const [tab, setTab] = useState<Tab>('install');
  const [name, setName] = useState(website.name);
  const [origins, setOrigins] = useState(website.allowedOrigins.join('\n'));
  const [welcomeMessage, setWelcome] = useState(initial.welcomeMessage ?? '');
  const [primaryColor, setColor] = useState(initial.primaryColor ?? DEFAULT_WIDGET_COLOR);
  const [collectEmail, setCollectEmail] = useState(initial.collectEmail ?? 'never');
  const [showAgentNames, setShowNames] = useState(initial.showAgentNames ?? false);
  const [requireTurnstile, setTurnstile] = useState(initial.requireTurnstile ?? false);
  const [askForRating, setAskForRating] = useState(initial.askForRating ?? true);
  const [language, setLanguage] = useState(initial.language ?? 'auto');
  const [hasHours, setHasHours] = useState(initial.openingHours !== undefined);
  const [zone, setZone] = useState(initial.openingHours?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [days, setDays] = useState(() => daysOf(initial.openingHours));
  const openingHours = hasHours ? { timeZone: zone, days: days.map((day) => (day.on ? { open: day.open, close: day.close === '00:00' ? '24:00' : day.close } : null)) } : undefined;
  const save = useMutation({
    mutationFn: () =>
      api.updateWebsite(workspaceId, website.id, {
        name,
        allowedOrigins: parseOrigins(origins),
        settings: { ...initial, ...(primaryColor === DEFAULT_WIDGET_COLOR && !initial.primaryColor ? {} : { primaryColor }), collectEmail, showAgentNames, requireTurnstile, askForRating, language, openingHours, ...(welcomeMessage.trim() ? { welcomeMessage: welcomeMessage.trim() } : { welcomeMessage: undefined }) },
      }),
    onSuccess: () => refreshWebsites(client, workspaceId),
  });
  return (
    <section className="card space-y-4" aria-label={website.name}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="button-quiet" onClick={onClose}>← {t('websiteAll')}</button>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">{website.name}</h3>
      </div>
      <div role="tablist" aria-label={website.name} className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((item) => (
          <button
            key={item.tab}
            type="button"
            role="tab"
            aria-selected={tab === item.tab}
            className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium ${tab === item.tab ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300' : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}
            onClick={() => { setTab(item.tab); save.reset(); }}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {tab === 'install' && (
          <div className="space-y-3">
            <p className="text-sm">{t('websiteInstallStep')}</p>
            <CopyableSnippet website={website} />
            <CopyCode website={website} primary />
            <p className={quiet}>{t('snippetHelp')}</p>
          </div>
        )}
        {tab === 'appearance' && (
          <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
            <div className="space-y-4">
              <label className="block text-sm font-medium">
                {t('colour')}
                <input className="field mt-1 block h-10 w-20 p-1" type="color" value={primaryColor} onChange={(e) => setColor(e.target.value)} />
              </label>
              <label className="block text-sm font-medium">
                {t('welcomeMessage')}
                <textarea className="field mt-1 font-normal" rows={3} maxLength={500} value={welcomeMessage} onChange={(e) => setWelcome(e.target.value)} />
              </label>
              <label className="block text-sm font-medium">
                {t('widgetLanguage')}
                <select className="field mt-1 font-normal" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)} aria-describedby={`${website.id}-language-help`}>
                  <option value="auto">{t('widgetLanguageAuto')}</option>
                  {WIDGET_LANGUAGES.map(([code, label]) => <option key={code} value={code} lang={code}>{label}</option>)}
                </select>
              </label>
              <p id={`${website.id}-language-help`} className={`-mt-3 ${quiet}`}>{tNode('widgetLanguageHint', { attribute: <code>data-locale</code> })}</p>
            </div>
            <WidgetPreview name={name} color={primaryColor} welcome={welcomeMessage} />
          </div>
        )}
        {tab === 'chat' && (
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              {t('askEmail')}
              <select className="field mt-1 w-auto font-normal" value={collectEmail} onChange={(e) => setCollectEmail(e.target.value as typeof collectEmail)}>
                <option value="never">{t('askNever')}</option>
                <option value="optional">{t('askOptional')}</option>
                <option value="required">{t('askRequired')}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showAgentNames} onChange={(e) => setShowNames(e.target.checked)} />
              {t('showAgentNames')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={askForRating} onChange={(e) => setAskForRating(e.target.checked)} />
              {t('askForRating')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={requireTurnstile} onChange={(e) => setTurnstile(e.target.checked)} />
              {t('turnstile')}
            </label>
          </div>
        )}
        {tab === 'hours' && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasHours} onChange={(e) => setHasHours(e.target.checked)} />
              {t('openingHoursSet')}
            </label>
            {hasHours && <OpeningHoursFields zone={zone} setZone={setZone} days={days} setDays={setDays} />}
            <p className={quiet}>{t('openingHoursHint')}</p>
          </div>
        )}
        {tab === 'details' && (
          <div className="space-y-4">
            <label className="block text-sm font-medium">
              {t('name')}
              <input className="field mt-1 font-normal" value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block text-sm font-medium">
              {t('allowedOrigins')}
              <textarea className="field mt-1 font-normal" rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} />
            </label>
          </div>
        )}
        {tab !== 'install' && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <button className="button" disabled={save.isPending}>{t('saveChanges')}</button>
            {save.isSuccess && <p className="text-sm text-slate-600 dark:text-slate-400" role="status">{t('widgetSaved')}</p>}
            <Failure error={save.error} />
          </div>
        )}
      </form>
    </section>
  );
}

function AddWebsite({ workspaceId, onDone }: { workspaceId: string; onDone: (id: string | null) => void }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const create = useMutation({
    mutationFn: () => api.createWebsite(workspaceId, { name, allowedOrigins: parseOrigins(origins) }),
    onSuccess: async (website) => {
      await refreshWebsites(client, workspaceId);
      onDone(website.id);
    },
  });
  return (
    <form
      className="card space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h3 className="font-medium">{t('addWebsiteTitle')}</h3>
      <label className="block text-sm font-medium">
        {t('name')}
        <input className="field mt-1 font-normal" autoFocus value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-sm font-medium">
        {t('allowedOrigins')}
        <textarea className="field mt-1 font-normal" rows={2} placeholder="https://www.example.com" value={origins} onChange={(e) => setOrigins(e.target.value)} />
      </label>
      <Failure error={create.error} />
      <div className="flex flex-wrap gap-2">
        <button className="button" disabled={create.isPending}>{t('addWebsite')}</button>
        <button type="button" className="button-quiet" onClick={() => onDone(null)}>{t('cancel')}</button>
      </div>
    </form>
  );
}

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/**
 * `canEdit` is for installation admins: they read through the admin route, which needs no membership, and can add
 * and change. Everyone else reads their own workspace's websites and copies the code.
 */
export function WebsitesManager({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const websites = useQuery({
    queryKey: [canEdit ? 'admin-websites' : 'websites', workspaceId],
    queryFn: () => (canEdit ? api.listAdminWebsites(workspaceId) : api.listWebsites(workspaceId)),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = websites.data?.data ?? [];
  const current = canEdit ? list.find((website) => website.id === open) : undefined;
  if (current) return <WebsiteEditor key={current.id} website={current} workspaceId={workspaceId} onClose={() => setOpen(null)} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-48 flex-1 text-sm text-slate-600 dark:text-slate-400">{t(canEdit ? 'websitesIntroAdmin' : 'websitesIntro')}</p>
        {canEdit && !adding && <button type="button" className="button" onClick={() => setAdding(true)}>{t('addWebsite')}</button>}
      </div>
      <Failure error={websites.error} />
      {adding && <AddWebsite workspaceId={workspaceId} onDone={(id) => { setAdding(false); if (id) setOpen(id); }} />}
      {websites.data && list.length === 0 && !adding && <p className="card text-sm text-slate-600 dark:text-slate-400">{t(canEdit ? 'noWebsites' : 'noWebsitesMember')}</p>}
      <ul className="space-y-3">
        {list.map((website) => (
          <li key={website.id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white" style={{ background: website.settings.primaryColor ?? DEFAULT_WIDGET_COLOR }}>
                {website.name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-40 flex-1">
                <h3 className="font-medium break-words">{website.name}</h3>
                <p className={`${quiet} break-words`}>{website.allowedOrigins.length > 0 ? website.allowedOrigins.map(hostOf).join(', ') : t('websiteNoOrigins')}</p>
              </div>
              <CopyCode website={website} />
              {canEdit && <button type="button" className="button-quiet" aria-label={t('websiteSettingsFor', { name: website.name })} onClick={() => setOpen(website.id)}>{t('sectionSettings')}</button>}
            </div>
            {!canEdit && <CopyableSnippet website={website} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
