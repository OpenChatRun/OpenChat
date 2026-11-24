import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../app-context';
import { t, tn, tNode, type MessageKey } from '../i18n';
import { WebsitesManager } from './websites';

/** The OpenChat project's own relay, whose terms an installation accepts by using it. Another relay has its own terms. */
// The managed relay answers at both addresses; relay.openchat.run is the new one.
const MANAGED_RELAY_URLS = new Set(['https://relay.openchat.run', 'https://openchat-relay.orangolabs.com']);
const RELAY_TERMS_URL = 'https://github.com/OrangoLabsLtd/OpenChat/blob/main/docs/legal/relay-terms.md';

function Failure({ error }: { error: unknown }) {
  return error ? <p className="error" role="alert">{errorMessage(error)}</p> : null;
}

/** The second key is what a member sees, in case this admin is also in the workspace. */
function RenameWorkspace({ workspace }: { workspace: { id: string; name: string } }) {
  const client = useQueryClient();
  const [name, setName] = useState(workspace.name);
  const rename = useMutation({
    mutationFn: () => api.updateWorkspace(workspace.id, { name }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['admin-workspaces'] }), client.invalidateQueries({ queryKey: ['me'] })]);
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        rename.mutate();
      }}
    >
      <label className="min-w-48 flex-1 text-sm font-medium">
        {t('workspaceName')}
        <input className="field mt-1 font-normal" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="button-quiet" disabled={rename.isPending}>{t('rename')}</button>
      <Failure error={rename.error} />
    </form>
  );
}

function NewWorkspace({ onCreated }: { onCreated: (id: string) => void }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.createWorkspace(name),
    onSuccess: async (workspace) => {
      setName('');
      await client.invalidateQueries({ queryKey: ['admin-workspaces'] });
      onCreated(workspace.id);
    },
  });
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <input className="field w-48" aria-label={t('newWorkspaceName')} placeholder={t('newWorkspace')} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      <button className="button-quiet" disabled={create.isPending}>{t('createWorkspace')}</button>
      <Failure error={create.error} />
    </form>
  );
}

const RETENTION_CHOICES = [30, 90, 180, 365, 730];

/** How long the workspace keeps closed conversations. See docs/architecture/data-model.md#retention. */
function RetentionPanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const current = useQuery({ queryKey: ['retention', workspaceId], queryFn: () => api.getRetention(workspaceId) });
  const [choice, setChoice] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (days: number | null) => api.setRetention(workspaceId, days),
    onSuccess: (data) => {
      client.setQueryData(['retention', workspaceId], data);
      setChoice(null);
    },
  });
  if (!current.data) return <Failure error={current.error} />;
  const saved = current.data.retentionDays;
  const value = choice ?? String(saved ?? '');
  const days = value === '' ? null : Number(value);
  const choices = saved === null || RETENTION_CHOICES.includes(saved) ? RETENTION_CHOICES : [...RETENTION_CHOICES, saved].sort((a, b) => a - b);
  const shorter = days !== null && (saved === null || days < saved);
  const submit = () => {
    if (shorter && !window.confirm(t('retentionConfirm', { days }))) return;
    save.mutate(days);
  };
  return (
    <section className="card space-y-2" aria-label={t('retention')}>
      <label className="block text-sm font-medium">
        {t('keepClosed')}
        <select className="field mt-1 font-normal" value={value} onChange={(e) => setChoice(e.target.value)}>
          <option value="">{t('forever')}</option>
          {choices.map((d) => <option key={d} value={String(d)}>{t('afterLastMessage', { period: d % 365 === 0 ? tn('years', d / 365) : t('days', { count: d }) })}</option>)}
        </select>
      </label>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {t('retentionHelp')}
      </p>
      <button className="button-quiet" disabled={days === saved || save.isPending} onClick={submit}>
        {t('saveRetention')}
      </button>
      <Failure error={save.error} />
    </section>
  );
}

type Tab = 'general' | 'websites';
const TABS: { tab: Tab; label: MessageKey }[] = [
  { tab: 'general', label: 'workspaceTabGeneral' },
  { tab: 'websites', label: 'sectionWebsites' },
];

function ManagedWorkspace({ workspace }: { workspace: { id: string; name: string } }) {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={workspace.name} className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((item) => (
          <button
            key={item.tab}
            type="button"
            role="tab"
            aria-selected={tab === item.tab}
            className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium ${tab === item.tab ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300' : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}
            onClick={() => setTab(item.tab)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      {tab === 'general' && (
        <>
          <section className="card"><RenameWorkspace workspace={workspace} /></section>
          <RetentionPanel workspaceId={workspace.id} />
        </>
      )}
      {tab === 'websites' && <WebsitesManager workspaceId={workspace.id} canEdit />}
    </div>
  );
}

/**
 * Push for the whole installation. Disconnecting has the relay erase what it holds about this installation, which is
 * how its operator meets a request to erase. See docs/notification-relay/protocol.md#erasure.
 */
function RelayPanel() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['relay-status'], queryFn: () => api.getRelayStatus() });
  const onSuccess = (data: Awaited<ReturnType<typeof api.getRelayStatus>>) => client.setQueryData(['relay-status'], data);
  // A failed disconnect still turned push off here, so the status is read again either way.
  const disconnect = useMutation({ mutationFn: () => api.disconnectRelay(), onSuccess, onSettled: () => client.invalidateQueries({ queryKey: ['relay-status'] }) });
  const reconnect = useMutation({ mutationFn: () => api.reconnectRelay(), onSuccess });
  const relay = status.data;
  if (!relay) return <Failure error={status.error} />;
  return (
    <section className="card space-y-2" aria-label={t('push')}>
      <h2 className="font-medium">{t('push')}</h2>
      {relay.state === 'not_configured' && <p className="text-sm text-slate-600 dark:text-slate-400">{t('pushNone')}</p>}
      {relay.state === 'connected' && (
        <>
          <p className="text-sm">
            {t('pushThrough', { url: relay.relay?.url ?? '' })} {relay.registered ? tn('phones', relay.subscriptions) : t('noPhones')}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t('relayHolds')}
          </p>
          {MANAGED_RELAY_URLS.has(relay.relay?.url ?? '') && (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {tNode('relayTerms', {
                terms: (
                  <a className="underline" href={RELAY_TERMS_URL} target="_blank" rel="noreferrer">
                    {t('relayTermsLink')}
                  </a>
                ),
              })}
            </p>
          )}
          <button
            className="button-quiet"
            disabled={disconnect.isPending}
            onClick={() => window.confirm(t('disconnectConfirm')) && disconnect.mutate()}
          >
            {t('disconnectErase')}
          </button>
        </>
      )}
      {relay.state === 'disconnected' && (
        <>
          <p className="text-sm">{t('pushOff', { url: relay.relay?.url ?? '' })}</p>
          <button className="button-quiet" disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>
            {t('reconnect')}
          </button>
          {disconnect.isError && <p className="text-xs text-slate-600 dark:text-slate-400">{t('erasureUnconfirmed')}</p>}
          {disconnect.isError && (
            <button className="button-quiet" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
              {t('retryErasure')}
            </button>
          )}
        </>
      )}
      <Failure error={disconnect.error ?? reconnect.error} />
    </section>
  );
}

/** For installation admins, who need no membership for any of this. Conversations do need one. See ADR-0016. */
export function WorkspacesAdminPage() {
  const workspaces = useQuery({ queryKey: ['admin-workspaces'], queryFn: () => api.listAdminWorkspaces({ limit: 100 }) });
  const [chosen, setChosen] = useState('');
  const list = workspaces.data?.data ?? [];
  const workspace = list.find((w) => w.id === chosen) ?? list[0];
  return (
    <section className="space-y-6" aria-label={t('manageWorkspaces')}>
      <Failure error={workspaces.error} />
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {workspace && (
            <label className="block min-w-48 flex-1 text-sm font-medium">
              {t('workspaceToManage')}
              <select className="field mt-1 font-normal" value={workspace.id} onChange={(e) => setChosen(e.target.value)}>
                {list.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
          )}
          <NewWorkspace onCreated={setChosen} />
        </div>
        {workspace && <p className="text-xs text-slate-600 dark:text-slate-400">{t('manageHint')}</p>}
        {workspaces.data?.nextCursor && <p className="notice">{t('firstHundred')}</p>}
        {list.length === 0 && workspaces.data && <p className="text-sm text-slate-600 dark:text-slate-400">{t('noWorkspaces')}</p>}
      </div>
      {/* The key gives each workspace fresh form state, so nothing typed in one is saved to another. */}
      {workspace && <ManagedWorkspace key={workspace.id} workspace={workspace} />}
      <RelayPanel />
    </section>
  );
}
