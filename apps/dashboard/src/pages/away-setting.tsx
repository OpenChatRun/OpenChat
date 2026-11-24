/** A member's own Away switch, for the workspace they are in, as on the Members page. */
import type { Me, Member } from '@openchat/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../app-context';
import { t } from '../i18n';

type Membership = Me['memberships'][number];

export function AwaySetting({ membership, headingClass }: { membership: Membership; headingClass: string }) {
  const client = useQueryClient();
  const workspaceId = membership.workspace.id;
  const key = ['members', workspaceId];
  const members = useQuery({ queryKey: key, queryFn: () => api.listMembers(workspaceId) });
  const setAway = useMutation({
    mutationFn: (away: boolean) => api.setAway(workspaceId, away),
    // The answer is the member as saved, so the switch does not go back while the list is asked for again.
    onSuccess: (saved) => client.setQueryData<{ data: Member[] }>(key, (list) => (list ? { ...list, data: list.data.map((member) => (member.id === saved.id ? saved : member)) } : list)),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  // What was just chosen, shown at once, until the saved member is in the list.
  const [wanted, setWanted] = useState<boolean | null>(null);
  const mine = members.data?.data.find((member) => member.id === membership.memberId);
  if (!mine) return null;
  return (
    <section className="card space-y-2" aria-label={t('homeAvailability')}>
      <h2 className={headingClass}>{t('homeAvailability')}</h2>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={wanted ?? mine.away} disabled={setAway.isPending} onChange={(event) => { setWanted(event.target.checked); setAway.mutate(event.target.checked, { onSettled: () => setWanted(null) }); }} aria-describedby="away-setting-help" />
        {t('away')}
      </label>
      <p id="away-setting-help" className="text-xs text-slate-600 dark:text-slate-400">{t('awayHelp')}</p>
      {setAway.error ? <p className="error" role="alert">{errorMessage(setAway.error)}</p> : null}
    </section>
  );
}
