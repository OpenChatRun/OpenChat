/**
 * Saved replies: text the team wrote once, put into the reply box with a click. Every member uses them, and
 * supervisors add, change and delete them here, where they are used.
 */
import { matchSavedReplies } from '@openchat/api-client/inbox-state';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../app-context';
import { t } from '../i18n';

export const savedRepliesKey = (workspaceId: string) => ['saved-replies', workspaceId] as const;

export function SavedReplies(props: { workspaceId: string; supervisor: boolean; query: string; onQuery: (query: string) => void; onPick: (content: string) => void; onClose: () => void }) {
  const { workspaceId, supervisor, query } = props;
  const client = useQueryClient();
  const replies = useQuery({ queryKey: savedRepliesKey(workspaceId), queryFn: () => api.listSavedReplies(workspaceId), staleTime: 60_000 });
  // Null: nothing is being written. An empty ID: a new one.
  const [editing, setEditing] = useState<{ id: string; title: string; content: string } | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: savedRepliesKey(workspaceId) });
  const save = useMutation({
    mutationFn: (input: { id: string; title: string; content: string }) =>
      input.id ? api.updateSavedReply(workspaceId, input.id, { title: input.title, content: input.content }) : api.createSavedReply(workspaceId, { title: input.title, content: input.content }),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteSavedReply(workspaceId, id), onSuccess: refresh });
  const found = matchSavedReplies(replies.data?.data ?? [], query);
  const failure = replies.error ?? save.error ?? remove.error;

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900" aria-label={t('savedReplies')}>
      <div className="flex items-center gap-2">
        <input
          className="field"
          type="search"
          autoFocus
          aria-label={t('searchSavedReplies')}
          placeholder={t('searchSavedReplies')}
          value={query}
          onChange={(event) => props.onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') props.onClose();
            if (event.key === 'Enter') {
              event.preventDefault();
              if (found[0]) props.onPick(found[0].content);
            }
          }}
        />
        <button type="button" className="button-quiet" onClick={props.onClose}>{t('close')}</button>
      </div>
      {failure ? <p className="error" role="alert">{errorMessage(failure)}</p> : null}
      {replies.data && found.length === 0 && <p className="text-slate-600 dark:text-slate-400">{t(replies.data.data.length === 0 ? (supervisor ? 'noSavedRepliesYet' : 'noSavedRepliesAsk') : 'noSavedRepliesFound')}</p>}
      <ul className="max-h-56 divide-y divide-slate-200 overflow-y-auto dark:divide-slate-800">
        {found.map((reply) => (
          <li key={reply.id} className="flex items-start gap-2 py-1.5">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => props.onPick(reply.content)}>
              <span className="block truncate font-medium">{reply.title}</span>
              <span className="block truncate text-xs text-slate-600 dark:text-slate-400">{reply.content}</span>
            </button>
            {supervisor && (
              <>
                <button type="button" className="button-quiet" aria-label={t('editNamed', { name: reply.title })} onClick={() => setEditing({ id: reply.id, title: reply.title, content: reply.content })}>{t('edit')}</button>
                <button type="button" className="button-quiet" aria-label={t('deleteNamed', { name: reply.title })} disabled={remove.isPending} onClick={() => remove.mutate(reply.id)}>{t('delete')}</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {supervisor && !editing && <button type="button" className="button-quiet" onClick={() => setEditing({ id: '', title: '', content: '' })}>{t('newSavedReply')}</button>}
      {supervisor && editing && (
        // Not a form: this sits inside the reply form, and a form may not hold another.
        <div className="space-y-2 border-t border-slate-200 pt-2 dark:border-slate-800" role="group" aria-label={t(editing.id ? 'editSavedReply' : 'newSavedReply')}>
          <label className="block">{t('savedReplyTitle')}
            <input className="field" maxLength={100} value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
          </label>
          <label className="block">{t('savedReplyText')}
            <textarea className="field resize-none" rows={3} maxLength={4000} value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="button" disabled={save.isPending || !editing.title.trim() || !editing.content.trim()} onClick={() => save.mutate({ id: editing.id, title: editing.title.trim(), content: editing.content.trim() })}>{t('save')}</button>
            <button type="button" className="button-quiet" onClick={() => setEditing(null)}>{t('cancel')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
