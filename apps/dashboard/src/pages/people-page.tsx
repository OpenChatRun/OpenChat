import type { Person } from '@openchat/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../app-context';
import { Initials } from '../icons';
import { intlLocale, t, tn } from '../i18n';

const ROLES = ['agent', 'supervisor'] as const;
type Role = (typeof ROLES)[number];
const roleLabel = (role: Role) => t(role === 'supervisor' ? 'roleSupervisor' : 'roleAgent');

const FILTERS = [
  ['all', 'filterAll'],
  ['admins', 'filterAdmins'],
  ['deactivated', 'filterDeactivated'],
] as const;
type Filter = (typeof FILTERS)[number][0];

const matchesFilter = (person: Person, filter: Filter) =>
  filter === 'admins' ? person.isInstallationAdmin && !person.deactivated : filter === 'deactivated' ? person.deactivated : true;

/** Case- and accent-insensitive, so that "jose" finds "José". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();

function Failure({ error }: { error: unknown }) {
  return error ? <p className="error" role="alert">{errorMessage(error)}</p> : null;
}

/** For installation admins. The API answers 404 to anyone else, so hiding this page is only a convenience. */
export function PeoplePage({ myId }: { myId: string | undefined }) {
  const people = useQuery({ queryKey: ['people'], queryFn: () => api.listPeople({ limit: 100 }) });
  const workspaces = useQuery({ queryKey: ['admin-workspaces'], queryFn: () => api.listAdminWorkspaces({ limit: 100 }) });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);

  const all = people.data?.data;
  const sorted = useMemo(() => {
    const collator = new Intl.Collator(intlLocale(), { sensitivity: 'base' });
    // Yourself first, then active people before deactivated ones, each by name.
    return [...(all ?? [])].sort((a, b) => Number(b.id === myId) - Number(a.id === myId) || Number(a.deactivated) - Number(b.deactivated) || collator.compare(a.name, b.name));
  }, [all, myId]);
  const needle = fold(search.trim());
  const shown = sorted.filter((person) => matchesFilter(person, filter) && (!needle || fold(`${person.name} ${person.email}`).includes(needle)));
  const counts = Object.fromEntries(FILTERS.map(([name]) => [name, sorted.filter((person) => matchesFilter(person, name)).length])) as Record<Filter, number>;

  return (
    <section className="space-y-4" aria-label={t('adminPeople')}>
      <Failure error={people.error ?? workspaces.error} />
      <AddPerson onAdded={(id) => setOpen(id)} />
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="field min-w-48 flex-1"
          type="search"
          aria-label={t('peopleSearch')}
          placeholder={t('peopleSearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="tabs" role="group" aria-label={t('filterPeople')}>
          {FILTERS.map(([name, label]) => (
            <button key={name} type="button" className="tab" aria-pressed={filter === name} onClick={() => setFilter(name)}>
              {t(label)} <span className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">{counts[name]}</span>
            </button>
          ))}
        </div>
      </div>
      {people.isPending && <p className="text-sm" role="status">{t('loading')}</p>}
      {all && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {t('peopleShown', { shown: shown.length, total: all.length })}
        </p>
      )}
      {all && shown.length === 0 && <p className="card text-center text-sm text-slate-600 dark:text-slate-400">{t('noPeopleMatch')}</p>}
      {shown.length > 0 && (
        <ul className="card divide-y divide-slate-200 p-0 dark:divide-slate-800">
          {shown.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              isMe={person.id === myId}
              workspaces={workspaces.data?.data ?? []}
              expanded={open === person.id}
              onToggle={() => setOpen(open === person.id ? null : person.id)}
            />
          ))}
        </ul>
      )}
      {(people.data?.nextCursor || workspaces.data?.nextCursor) && <p className="notice">{t('firstHundred')}</p>}
    </section>
  );
}

function AddPerson({ onAdded }: { onAdded: (id: string) => void }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const create = useMutation({
    mutationFn: () => api.createPerson({ name: name.trim(), email: email.trim() }),
    onSuccess: async (person) => {
      setName('');
      setEmail('');
      await client.invalidateQueries({ queryKey: ['people'] });
      // Opened, because the next step is adding them to a workspace.
      onAdded(person.id);
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
      <h2 className="font-medium">{t('addSomeone')}</h2>
      <div className="flex flex-wrap gap-3">
        <input className="field min-w-40 flex-1" aria-label={t('name')} required maxLength={100} placeholder={t('name')} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="field min-w-56 flex-1" aria-label={t('email')} type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="button" disabled={create.isPending}>{t('add')}</button>
      </div>
      <Failure error={create.error} />
      {create.isSuccess && <p className="notice" role="status">{t('invited', { email: create.data.email })}</p>}
    </form>
  );
}

function Badge({ tone, children }: { tone: 'brand' | 'amber' | 'slate'; children: ReactNode }) {
  const colours = {
    brand: 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
    amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${colours}`}>{children}</span>;
}

function PersonRow(props: { person: Person; isMe: boolean; workspaces: { id: string; name: string }[]; expanded: boolean; onToggle: () => void }) {
  const { person, isMe, expanded } = props;
  const panelId = useId();
  const current = person.memberships.filter((m) => m.status !== 'removed');
  return (
    <li aria-label={person.name} className={person.deactivated ? 'bg-slate-50/70 dark:bg-slate-950/40' : undefined}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={props.onToggle}
      >
        <span className={`avatar ${person.deactivated ? 'opacity-50 grayscale' : ''}`} aria-hidden="true"><Initials name={person.name} /></span>
        {/* On a phone the badges go under the email, so the chevron keeps its place. */}
        <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
          <span className="block min-w-0 sm:flex-1">
            <span className={`block text-sm font-medium ${person.deactivated ? 'text-slate-600 dark:text-slate-400' : ''}`}>
              {person.name}
              {isMe && <span className="font-normal text-slate-600 dark:text-slate-400"> · {t('you')}</span>}
            </span>
            <span className="block text-xs break-all text-slate-600 dark:text-slate-400">{person.email}</span>
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:mt-0 sm:justify-end">
            {person.isInstallationAdmin && !person.deactivated && <Badge tone="brand">{t('adminBadge')}</Badge>}
            {person.deactivated && <Badge tone="amber">{t('filterDeactivated')}</Badge>}
            <Badge tone="slate">{current.length === 0 ? t('inNoWorkspace') : tn('workspaces', current.length)}</Badge>
          </span>
        </span>
        <svg className={`size-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.2l3.9-3.9a1 1 0 1 1 1.4 1.4l-4.6 4.6a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4z" />
        </svg>
        <span className="sr-only">{t('manage')}</span>
      </button>
      {expanded && <PersonDetails id={panelId} {...props} />}
    </li>
  );
}

function PersonDetails({ id, person, isMe, workspaces }: { id: string; person: Person; isMe: boolean; workspaces: { id: string; name: string }[] }) {
  const client = useQueryClient();
  // 'me' too, because adding yourself to a workspace puts it in your workspace list.
  const refreshed = {
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['people'] }), client.invalidateQueries({ queryKey: ['me'] })]);
    },
  };
  const deactivate = useMutation({ mutationFn: () => api.deactivatePerson(person.id), ...refreshed });
  const reactivate = useMutation({ mutationFn: () => api.reactivatePerson(person.id), ...refreshed });
  const setAdmin = useMutation({ mutationFn: (isInstallationAdmin: boolean) => api.updatePerson(person.id, { isInstallationAdmin }), ...refreshed });
  const assign = useMutation({ mutationFn: ({ workspaceId, role }: { workspaceId: string; role: Role }) => api.assignPerson(person.id, workspaceId, { role }), ...refreshed });
  const unassign = useMutation({ mutationFn: (workspaceId: string) => api.unassignPerson(person.id, workspaceId), ...refreshed });
  const busy = deactivate.isPending || reactivate.isPending || setAdmin.isPending || assign.isPending || unassign.isPending;

  const current = person.memberships.filter((m) => m.status !== 'removed');
  const available = workspaces.filter((workspace) => !current.some((m) => m.workspaceId === workspace.id));
  const [chosen, setChosen] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const target = available.some((workspace) => workspace.id === chosen) ? chosen : available[0]?.id;

  const toggleAdmin = () => {
    const next = !person.isInstallationAdmin;
    const question = next ? t('makeAdminConfirm', { name: person.name }) : isMe ? t('removeOwnAdminConfirm') : null;
    if (question === null || window.confirm(question)) setAdmin.mutate(next);
  };

  return (
    <div id={id} className="space-y-4 border-t border-slate-100 px-4 pt-3 pb-4 dark:border-slate-800">
      <Failure error={deactivate.error ?? reactivate.error ?? setAdmin.error ?? assign.error ?? unassign.error} />
      <div className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-400 uppercase">{t('adminWorkspaces')}</h3>
        {current.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {current.map((membership) => (
              <li key={membership.memberId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-40 flex-1 text-sm">{membership.workspaceName}</span>
                {membership.status === 'suspended' && <Badge tone="amber">{t('suspended')}</Badge>}
                <select
                  aria-label={t('roleFor', { name: person.name, workspace: membership.workspaceName })}
                  className="field w-auto"
                  value={membership.role}
                  disabled={person.deactivated || busy}
                  onChange={(e) => assign.mutate({ workspaceId: membership.workspaceId, role: e.target.value as Role })}
                >
                  {ROLES.map((option) => <option key={option} value={option}>{roleLabel(option)}</option>)}
                </select>
                <button
                  type="button"
                  className="button-quiet"
                  disabled={busy}
                  onClick={() => window.confirm(t('removeFromConfirm', { name: person.name, workspace: membership.workspaceName })) && unassign.mutate(membership.workspaceId)}
                >
                  {t('remove')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('inNoWorkspace')}</p>
        )}
        {!person.deactivated && target && (
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              assign.mutate({ workspaceId: target, role });
            }}
          >
            <select aria-label={t('workspaceToAdd', { name: person.name })} className="field min-w-40 flex-1" value={target} onChange={(e) => setChosen(e.target.value)}>
              {available.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
            <select aria-label={t('roleToGive', { name: person.name })} className="field w-auto" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((option) => <option key={option} value={option}>{roleLabel(option)}</option>)}
            </select>
            <button className="button" disabled={busy}>{t('addToWorkspace')}</button>
          </form>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-400 uppercase">{t('accessSection')}</h3>
        <div className="flex flex-wrap gap-2">
          {person.deactivated ? (
            <button type="button" className="button-quiet" disabled={busy} onClick={() => reactivate.mutate()}>{t('reactivate')}</button>
          ) : (
            <>
              <button type="button" className="button-quiet" disabled={busy} onClick={toggleAdmin}>{t(person.isInstallationAdmin ? 'removeAdmin' : 'makeAdmin')}</button>
              {!isMe && (
                <button
                  type="button"
                  className="button-quiet text-red-700 dark:text-red-400"
                  disabled={busy}
                  onClick={() => window.confirm(t('deactivateConfirm', { name: person.name })) && deactivate.mutate()}
                >
                  {t('deactivate')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
