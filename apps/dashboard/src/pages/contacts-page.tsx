import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../app-context';
import { Initials } from '../icons';
import { intlLocale, t, tn } from '../i18n';
import { navigate } from '../routes';

const SEARCH_DELAY_MS = 250;

/**
 * Everyone who has written to this workspace, the most recently active first. A row opens their latest conversation,
 * where the contact card is. For every member: it shows nothing the inbox does not.
 */
export function ContactsPage({ workspaceId }: { workspaceId: string }) {
  const [search, setSearch] = useState('');
  // Once typing has stopped for a moment, so that a name sends one request, not one a letter.
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const contacts = useInfiniteQuery({
    queryKey: ['contacts', workspaceId, q],
    queryFn: ({ pageParam }) => api.listContacts(workspaceId, { cursor: pageParam, ...(q ? { q } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = contacts.data?.pages.flatMap((page) => page.data);
  const date = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className="space-y-4" aria-label={t('sectionContacts')}>
      {contacts.error && <p className="error" role="alert">{errorMessage(contacts.error)}</p>}
      <input className="field w-full" type="search" aria-label={t('peopleSearch')} placeholder={t('peopleSearch')} value={search} onChange={(e) => setSearch(e.target.value)} />
      {contacts.isPending && <p className="text-sm" role="status">{t('loading')}</p>}
      {rows && rows.length === 0 && <p className="card text-center text-sm text-slate-600 dark:text-slate-400">{t(q ? 'noPeopleMatch' : 'noContactsYet')}</p>}
      {rows && rows.length > 0 && (
        <ul className="card divide-y divide-slate-200 p-0 dark:divide-slate-800">
          {rows.map((contact) => (
            <li key={contact.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-neutral-900"
                onClick={() => navigate({ section: 'inbox', adminPage: null, conversationId: contact.lastConversationId })}
              >
                <span className="avatar" aria-hidden="true"><Initials name={contact.name} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{contact.name || t('visitor')}</span>
                  {contact.email && <span className="block truncate text-xs text-slate-600 dark:text-slate-400">{contact.email}</span>}
                </span>
                <span className="shrink-0 text-right text-xs text-slate-600 dark:text-slate-400">
                  <span className="block tabular-nums">{tn('contactConversations', contact.conversationCount)}</span>
                  <time className="block" dateTime={contact.lastActivityAt}>{t('contactLastActive', { when: date.format(new Date(contact.lastActivityAt)) })}</time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {contacts.hasNextPage && (
        <button type="button" className="button-quiet" disabled={contacts.isFetchingNextPage} onClick={() => void contacts.fetchNextPage()}>
          {t('loadMore')}
        </button>
      )}
    </section>
  );
}
