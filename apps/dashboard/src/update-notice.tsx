import type { SoftwareUpdate } from '@openchat/api-client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, preference } from './app-context';
import { t } from './i18n';

const CHECKED_PREFERENCE = 'oc.update-check';
const DISMISSED_PREFERENCE = 'oc.update-dismissed';
const DAY_MS = 24 * 60 * 60 * 1000;

/** At most one question a day from this browser: the server asks the project's repository each time it is asked. */
async function softwareUpdate(): Promise<SoftwareUpdate> {
  try {
    const kept = JSON.parse(preference.get(CHECKED_PREFERENCE) ?? 'null') as { at: number; update: SoftwareUpdate } | null;
    if (kept && Date.now() - kept.at < DAY_MS && typeof kept.update?.updateAvailable === 'boolean') return kept.update;
  } catch {
    // Unreadable: ask again.
  }
  const update = await api.getSoftwareUpdate();
  preference.set(CHECKED_PREFERENCE, JSON.stringify({ at: Date.now(), update }));
  return update;
}

/**
 * Tells an installation admin that a newer release exists, until they dismiss that release. Only admins can
 * upgrade, so nobody else is asked. Says nothing when the check is off, fails, or finds nothing newer.
 * See docs/operations/deployment.md.
 */
export function UpdateNotice() {
  const update = useQuery({ queryKey: ['software-update'], queryFn: softwareUpdate, staleTime: Infinity, retry: false });
  const [dismissed, setDismissed] = useState(() => preference.get(DISMISSED_PREFERENCE));
  const data = update.data;
  // The server may have been upgraded since this browser last asked.
  if (!data?.updateAvailable || !data.latest || !data.releaseUrl || data.latest === dismissed) return null;
  const latest = data.latest;
  return (
    <section className="notice flex flex-wrap items-center gap-x-3 gap-y-1" aria-label={t('updateNotice')}>
      <span>{t('updateAvailable', { latest, current: data.current ?? '' })}</span>
      <a className="underline" href={data.releaseUrl} target="_blank" rel="noreferrer">
        {t('updateSeeRelease')}
      </a>
      <button
        type="button"
        className="ml-auto underline"
        onClick={() => {
          preference.set(DISMISSED_PREFERENCE, latest);
          setDismissed(latest);
        }}
      >
        {t('dismiss')}
      </button>
    </section>
  );
}
