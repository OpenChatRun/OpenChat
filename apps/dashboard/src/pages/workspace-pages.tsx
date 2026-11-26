import type { Me } from '@openchat/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, preference, queryClient, session } from '../app-context';
import { InboxPanel } from '../inbox/inbox-panel';
import { FollowUpRulesPanel, SuppressionsPanel } from './email-panels';
import { AnalyticsPage } from './analytics-page';
import { AssistantPage } from './assistant-page';
import { ContactsPage } from './contacts-page';
import { HelpPage } from './help-page';
import { HomePage } from './home-page';
import { SettingsPage } from './settings-page';
import { AuditLogPage } from './audit-log-page';
import { FailedJobsPage } from './failed-jobs-page';
import { PeoplePage } from './people-page';
import { WebsitesManager } from './websites';
import { WorkspacesAdminPage } from './workspaces-admin-page';
import { SoftwareFooter } from '../software-footer';
import { UpdateNotice } from '../update-notice';
import { Icon, Initials, type IconName } from '../icons';
import { t, type MessageKey } from '../i18n';
import { useServerLanguage } from '../language-picker';
import { navigate, useRoute, type AdminPage, type Section } from '../routes';

type Membership = Me['memberships'][number];

async function signOut() {
  await api.logout().catch(() => undefined);
  // Nothing from this account may remain for whoever signs in next.
  queryClient.clear();
  session.signedOut();
}

function Failure({ error }: { error: unknown }) {
  return error ? <p className="error" role="alert">{errorMessage(error)}</p> : null;
}

/** The list of members changes rarely, and the inbox needs names and assignees. */
function InboxWithMembers({ membership, conversationId }: { membership: Membership; conversationId: string | null }) {
  const members = useQuery({ queryKey: ['members', membership.workspace.id], queryFn: () => api.listMembers(membership.workspace.id) });
  return (
    <InboxPanel
      membership={membership}
      members={members.data?.data ?? []}
      selected={conversationId}
      onSelect={(id) => navigate({ section: 'inbox', adminPage: null, conversationId: id })}
    />
  );
}

function MembersPanel({ membership }: { membership: Membership }) {
  const client = useQueryClient();
  const members = useQuery({ queryKey: ['members', membership.workspace.id], queryFn: () => api.listMembers(membership.workspace.id) });
  const setAway = useMutation({
    mutationFn: (away: boolean) => api.setAway(membership.workspace.id, away),
    onSettled: () => client.invalidateQueries({ queryKey: ['members', membership.workspace.id] }),
  });
  // What was just chosen, shown at once, until the list has been asked for again.
  const [wanted, setWanted] = useState<boolean | null>(null);
  return (
    <section className="space-y-4" aria-label={t('sectionMembers')}>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('membersIntro')}</p>
      <Failure error={members.error ?? setAway.error} />
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {members.data?.data.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="avatar" aria-hidden="true"><Initials name={member.name} /></span>
            <div className="min-w-40 flex-1">
              <div className="text-sm font-medium">{member.name}</div>
              <div className="text-xs break-all text-slate-600 dark:text-slate-400">{member.email}</div>
            </div>
            {member.status === 'suspended' && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('suspended')}</span>}
            {member.status === 'removed' && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('removed')}</span>}
            {member.id === membership.memberId ? (
              <label className="flex items-center gap-2 text-sm" title={t('awayHelp')}>
                <input type="checkbox" checked={wanted ?? member.away} disabled={setAway.isPending} onChange={(e) => { setWanted(e.target.checked); void setAway.mutateAsync(e.target.checked).catch(() => undefined).then(() => client.invalidateQueries({ queryKey: ['members', membership.workspace.id] })).finally(() => setWanted(null)); }} />
                {t('away')}
              </label>
            ) : (
              member.away && <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{t('away')}</span>
            )}
            <span className="text-sm">{t(member.role === 'supervisor' ? 'roleSupervisor' : 'roleAgent')}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600 dark:text-slate-400">{t('awayHelp')}</p>
      <p className="text-xs text-slate-600 dark:text-slate-400">{t('membersManagedBy')}</p>
    </section>
  );
}

function EmailPanels({ workspaceId, isSupervisor }: { workspaceId: string; isSupervisor: boolean }) {
  if (!isSupervisor) return <p className="card text-sm">{t('supervisorEmail')}</p>;
  return (
    <div className="space-y-6">
      <FollowUpRulesPanel workspaceId={workspaceId} />
      <SuppressionsPanel workspaceId={workspaceId} />
    </div>
  );
}

const WORKSPACE_PREFERENCE = 'openchat.workspace';

const SECTIONS = [
  ['inbox', 'sectionInbox', 'inbox'],
  ['contacts', 'sectionContacts', 'contacts'],
  ['analytics', 'sectionAnalytics', 'analytics'],
  ['websites', 'sectionWebsites', 'websites'],
  ['members', 'sectionMembers', 'members'],
  ['email', 'sectionEmail', 'email'],
  ['assistant', 'sectionAssistant', 'assistant'],
  ['help', 'sectionHelp', 'help'],
] as const satisfies readonly (readonly [Section, MessageKey, IconName])[];
/** Not in the rail's list: the mark at the top opens the dashboard, and the member's initials their settings. */
const SECTION_TITLES: Partial<Record<Section, MessageKey>> = { home: 'sectionHome', settings: 'sectionSettings' };
const ADMIN_PAGES = [
  ['people', 'adminPeople', 'people'],
  ['workspaces', 'adminWorkspaces', 'workspaces'],
  ['jobs', 'adminJobs', 'jobs'],
  ['audit', 'adminAudit', 'audit'],
] as const satisfies readonly (readonly [AdminPage, MessageKey, IconName])[];

function RailButton({ label, icon, current, onClick }: { label: string; icon: IconName; current: boolean; onClick: () => void }) {
  return (
    <button type="button" className="rail-item shrink-0" aria-current={current ? 'page' : undefined} onClick={onClick}>
      <Icon name={icon} />
      <span className="sr-only">{label}</span>
      <span className="rail-tip" aria-hidden="true">{label}</span>
    </button>
  );
}

export function WorkspaceApp() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.getMe });
  useServerLanguage(me.data);
  const [selectedId, setSelectedId] = useState(() => preference.get(WORKSPACE_PREFERENCE));
  const route = useRoute();
  const isAdmin = me.data?.isInstallationAdmin === true;
  // The address is the page. Someone who is not an admin, given an admin page's address, sees the inbox.
  const adminPage = me.data && !isAdmin ? null : route.adminPage;
  const tab: Section = route.section ?? 'inbox';
  const openSection = (section: Section) => navigate({ section, adminPage: null, conversationId: null });

  const memberships = me.data?.memberships ?? [];
  // A remembered workspace may be gone, or belong to someone else who used this browser.
  const current = memberships.find((m) => m.workspace.id === selectedId) ?? memberships[0];
  const select = (id: string) => {
    preference.set(WORKSPACE_PREFERENCE, id);
    setSelectedId(id);
    // An open conversation belongs to the workspace being left.
    if (route.conversationId) navigate({ section: 'inbox', adminPage: null, conversationId: null }, { replace: true });
  };
  const title = adminPage ? t(ADMIN_PAGES.find(([page]) => page === adminPage)![1]) : current ? t(SECTION_TITLES[tab] ?? SECTIONS.find(([name]) => name === tab)![1]) : tab === 'settings' ? t('sectionSettings') : 'OpenChat';
  const wide = tab === 'inbox' && !adminPage;
  // Lists of people and their workspaces read better with more room than a form page.
  const width = wide ? '' : adminPage === 'people' || adminPage === 'audit' || (!adminPage && (tab === 'help' || tab === 'home')) ? 'mx-auto max-w-5xl' : 'mx-auto max-w-3xl';

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 items-center gap-2 bg-navy-deep px-3 py-2 dark:border-b dark:border-white/10 md:sticky md:top-0 md:h-dvh md:w-[72px] md:flex-col md:px-0 md:py-4 md:dark:border-r md:dark:border-b-0">
        <button type="button" className="shrink-0 cursor-pointer rounded-xl md:mb-4" aria-current={!adminPage && tab === 'home' ? 'page' : undefined} onClick={() => openSection('home')}>
          <img className="size-9 md:size-10" src="/brand/mark-96.png" width={40} height={40} alt={t('sectionHome')} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto md:flex-col md:overflow-visible">
          {current && (
            <nav className="flex shrink-0 gap-1 md:flex-col" aria-label={t('navSections')}>
              {SECTIONS.map(([name, label, icon]) => (
                <RailButton key={name} label={t(label)} icon={icon} current={!adminPage && tab === name} onClick={() => openSection(name)} />
              ))}
            </nav>
          )}
          {isAdmin && (
            <nav className="flex shrink-0 gap-1 md:mt-3 md:flex-col md:border-t md:border-white/10 md:pt-3" aria-label={t('navAdministration')}>
              {ADMIN_PAGES.map(([page, label, icon]) => (
                <RailButton key={page} label={t(label)} icon={icon} current={adminPage === page} onClick={() => (adminPage === page ? openSection('inbox') : navigate({ section: null, adminPage: page, conversationId: null }))} />
              ))}
            </nav>
          )}
        </div>
        <button type="button" className={`avatar relative cursor-pointer ring-2 ${!adminPage && tab === 'settings' ? 'ring-white' : 'ring-white/20 hover:ring-white/60'}`} aria-current={!adminPage && tab === 'settings' ? 'page' : undefined} onClick={() => openSection('settings')}>
          <span aria-hidden="true"><Initials name={me.data?.name} /></span>
          <span className="sr-only">{t('sectionSettings')}</span>
        </button>
        <button type="button" className="rail-item shrink-0" onClick={() => void signOut()}>
          <Icon name="signOut" />
          <span className="sr-only">{t('signOut')}</span>
          <span className="rail-tip" aria-hidden="true">{t('signOut')}</span>
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-6 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="flex-1 text-lg font-semibold tracking-tight">{title}</h1>
          {memberships.length > 0 && current && (
            <select className="field w-auto max-w-56" aria-label={t('workspace')} value={current.workspace.id} onChange={(e) => select(e.target.value)}>
              {memberships.map((m) => <option key={m.workspace.id} value={m.workspace.id}>{m.workspace.name}</option>)}
            </select>
          )}
        </header>
        <main className={`w-full flex-1 space-y-6 px-4 py-6 md:px-6 ${width}`}>
          <Failure error={me.error} />
          {isAdmin && <UpdateNotice />}
          {isAdmin && adminPage === 'people' && <PeoplePage myId={me.data?.id} />}
          {isAdmin && adminPage === 'workspaces' && <WorkspacesAdminPage />}
          {isAdmin && adminPage === 'jobs' && <FailedJobsPage />}
          {isAdmin && adminPage === 'audit' && <AuditLogPage />}
          {me.data && !adminPage && tab === 'settings' && <SettingsPage me={me.data} membership={current} onSignOut={() => void signOut()} />}
          {me.data && !current && !adminPage && tab !== 'settings' && (
            <p className="card text-sm">{t(isAdmin ? 'notInWorkspaceAdmin' : 'notInWorkspace')}</p>
          )}
          {current && !adminPage && tab !== 'settings' && (
            // The key gives each workspace fresh component state, so nothing typed in one appears in another.
            <div key={current.workspace.id}>
              {tab === 'home' ? <HomePage membership={current} name={me.data?.name ?? ''} onOpenInbox={() => openSection('inbox')} onOpenAnalytics={() => openSection('analytics')} /> : tab === 'inbox' ? <InboxWithMembers membership={current} conversationId={route.conversationId} /> : tab === 'contacts' ? <ContactsPage workspaceId={current.workspace.id} /> : tab === 'analytics' ? <AnalyticsPage workspaceId={current.workspace.id} isSupervisor={current.role === 'supervisor'} /> : tab === 'websites' ? <section aria-label={t('sectionWebsites')}><WebsitesManager key={current.workspace.id} workspaceId={current.workspace.id} canEdit={isAdmin} /></section> : tab === 'email' ? <EmailPanels workspaceId={current.workspace.id} isSupervisor={current.role === 'supervisor'} /> : tab === 'assistant' ? <AssistantPage workspaceId={current.workspace.id} isSupervisor={current.role === 'supervisor'} /> : tab === 'help' ? <HelpPage workspaceId={current.workspace.id} isSupervisor={current.role === 'supervisor'} /> : <MembersPanel membership={current} />}
            </div>
          )}
        </main>
        <div className="px-4 pb-4 md:px-6">
          <SoftwareFooter />
        </div>
      </div>
    </div>
  );
}
