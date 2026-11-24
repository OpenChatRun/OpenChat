/** A member's own settings: who they are here, how the dashboard looks and reads, whether they are away, and their password. */
import type { Me } from '@openchat/api-client';
import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../app-context';
import { Initials } from '../icons';
import { t } from '../i18n';
import { LanguagePicker } from '../language-picker';
import { ThemePicker } from '../theme-picker';
import { AwaySetting } from './away-setting';

type Membership = Me['memberships'][number];
const quiet = 'text-xs text-slate-600 dark:text-slate-400';

export function SettingsPage({ me, membership, onSignOut }: { me: Me; membership: Membership | undefined; onSignOut: () => void }) {
  const link = useMutation({ mutationFn: () => api.requestPasswordReset(me.email) });
  return (
    <div className="space-y-6">
      <section className="card space-y-3" aria-label={t('settingsProfile')}>
        <h2 className="font-medium">{t('settingsProfile')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="avatar" aria-hidden="true"><Initials name={me.name} /></span>
          <div className="min-w-40 flex-1">
            <div className="text-sm font-medium">{me.name}</div>
            <div className="text-xs break-all text-slate-600 dark:text-slate-400">{me.email}</div>
          </div>
          {membership && <span className="text-sm">{membership.workspace.name} · {t(membership.role === 'supervisor' ? 'roleSupervisor' : 'roleAgent')}</span>}
        </div>
        <p className={quiet}>{t('settingsProfileHelp')}</p>
      </section>
      <section className="card space-y-3" aria-label={t('settingsAppearance')}>
        <h2 className="font-medium">{t('settingsAppearance')}</h2>
        <div className="flex flex-wrap gap-4">
          <label className="block text-sm">{t('theme')}
            <ThemePicker className="mt-1 block" />
          </label>
          <label className="block text-sm">{t('language')}
            <LanguagePicker className="mt-1 block" />
          </label>
        </div>
      </section>
      {membership && <AwaySetting membership={membership} headingClass="font-medium" />}
      <section className="card space-y-3" aria-label={t('settingsPassword')}>
        <h2 className="font-medium">{t('settingsPassword')}</h2>
        <p className={quiet}>{t('settingsPasswordHelp')}</p>
        {link.error ? <p className="error" role="alert">{errorMessage(link.error)}</p> : null}
        {link.isSuccess ? <p className="notice" role="status">{t('settingsLinkSent', { email: me.email })}</p> : <button type="button" className="button-quiet" disabled={link.isPending} onClick={() => link.mutate()}>{t('settingsSendLink')}</button>}
      </section>
      <button type="button" className="button-quiet" onClick={onSignOut}>{t('signOut')}</button>
    </div>
  );
}
