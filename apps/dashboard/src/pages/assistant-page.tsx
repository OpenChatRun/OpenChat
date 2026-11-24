/**
 * The AI assistant, for supervisors (ADR-0022): its name, whether it answers visitors and learns, what it
 * answers from, what it has learned, and a place to try it.
 */
import type { Assistant, AssistantAnswer, AssistantSource, LearnedAnswer } from '@openchat/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../app-context';
import { intlLocale, t, type MessageKey } from '../i18n';

const READ_ERRORS: Record<string, MessageKey> = {
  unreachable: 'readUnreachable',
  blocked_by_robots: 'readBlocked',
  not_html: 'readNotHtml',
  empty: 'readEmpty',
  too_large: 'readTooLarge',
};

const OUTCOMES: Record<Exclude<AssistantAnswer['outcome'], 'answered'>, MessageKey> = {
  no_sources: 'outcomeNoSources',
  unsure: 'outcomeUnsure',
  limit_reached: 'outcomeLimit',
};

const quiet = 'text-xs text-slate-600 dark:text-slate-400';

function Failure({ error }: { error: unknown }) {
  return error ? <p className="error" role="alert">{errorMessage(error)}</p> : null;
}

function SettingsCard({ workspaceId, websiteId, assistant }: { workspaceId: string; websiteId: string; assistant: Assistant }) {
  const client = useQueryClient();
  const [name, setName] = useState(assistant.settings?.name ?? t('sectionAssistant'));
  const [enabled, setEnabled] = useState(assistant.settings?.enabled ?? false);
  const [learn, setLearn] = useState(assistant.settings?.learn ?? false);
  const save = useMutation({
    mutationFn: () => api.saveAssistantSettings(workspaceId, websiteId, { name: name.trim(), /* Chosen by whoever runs the installation: what is stored goes back as it is. */ model: assistant.settings?.model ?? null, enabled, learn }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['assistant', workspaceId, websiteId] }),
  });
  return (
    <section className="card space-y-3" aria-label={t('assistantSettings')}>
      <h2 className="font-medium">{t('assistantSettings')}</h2>
      <Failure error={save.error} />
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <label className="min-w-40 flex-1 text-sm">{t('assistantNameLabel')}
          <input className="field" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex w-full items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={enabled} disabled={!assistant.canReply && !enabled} onChange={(event) => setEnabled(event.target.checked)} aria-describedby="assistant-enabled-help" />
          <span>
            <span className="font-medium">{t('assistantEnabled')}</span>
            <span id="assistant-enabled-help" className={`block ${quiet}`}>
              {assistant.canReply ? t('assistantEnabledHelp', { count: String(assistant.limits.turnsPerConversation) }) : t('assistantCannotReply')}
            </span>
          </span>
        </label>
        <label className="flex w-full items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={learn} onChange={(event) => setLearn(event.target.checked)} aria-describedby="assistant-learn-help" />
          <span>
            <span className="font-medium">{t('assistantLearn')}</span>
            <span id="assistant-learn-help" className={`block ${quiet}`}>{t('assistantLearnHelp')}</span>
          </span>
        </label>
        <button className="button" disabled={save.isPending}>{t('saveSettings')}</button>
      </form>
      {save.isSuccess && <p className={quiet} role="status">{t('saved')}</p>}
    </section>
  );
}

function SourceStatus({ source }: { source: AssistantSource }) {
  if (source.status === 'pending') return <span className={quiet}>{t('sourcePending')}</span>;
  if (source.status === 'indexing') return <span className={quiet}>{t('sourceIndexing')}</span>;
  if (source.status === 'failed') {
    const reason = t(READ_ERRORS[source.errorCode ?? ''] ?? 'readUnreachable');
    return <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('sourceFailed', { reason })}</span>;
  }
  return (
    <span className={quiet}>
      {t('sourceReady')}
      {source.kind === 'page' && <> · {t('sourcePages', { count: String(source.pageCount) })}</>}
      {' · '}{t('sourcePassages', { count: String(source.chunkCount) })}
    </span>
  );
}

function SourcesCard({ workspaceId, websiteId, assistant }: { workspaceId: string; websiteId: string; assistant: Assistant }) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['assistant', workspaceId, websiteId] });
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const addPage = useMutation({ mutationFn: () => api.addAssistantSource(workspaceId, websiteId, { kind: 'page', url: url.trim() }), onSuccess: () => { setUrl(''); void refresh(); } });
  const addText = useMutation({ mutationFn: () => api.addAssistantSource(workspaceId, websiteId, { kind: 'text', title: title.trim(), content }), onSuccess: () => { setTitle(''); setContent(''); void refresh(); } });
  const reread = useMutation({ mutationFn: (source: AssistantSource) => api.updateAssistantSource(workspaceId, source.id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (source: AssistantSource) => api.deleteAssistantSource(workspaceId, source.id), onSuccess: refresh });
  const full = assistant.sources.length >= assistant.limits.sourcesPerWebsite;
  return (
    <section className="card space-y-3" aria-label={t('assistantSources')}>
      <h2 className="font-medium">{t('assistantSources')}</h2>
      <p className={quiet}>{t('assistantSourcesHelp', { count: String(assistant.limits.pagesPerSource) })}</p>
      <Failure error={addPage.error ?? addText.error ?? reread.error ?? remove.error} />
      {assistant.sources.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">{t('noneYet')}</p>}
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {assistant.sources.map((source) => (
          <li key={source.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <div className="min-w-48 flex-1">
              <div className="font-medium break-words">{source.title}</div>
              {source.url && <div className={`${quiet} break-all`}>{source.url}</div>}
              <SourceStatus source={source} />
            </div>
            <button className="button-quiet" disabled={reread.isPending || source.status === 'pending' || source.status === 'indexing'} onClick={() => reread.mutate(source)}>{t('readAgain')}</button>
            <button className="button-quiet" disabled={remove.isPending} onClick={() => { if (window.confirm(t('deleteSourceConfirm', { title: source.title }))) remove.mutate(source); }}>{t('delete')}</button>
          </li>
        ))}
      </ul>
      {assistant.helpArticles.published > 0 && (
        <p className="text-sm" role="status">
          {t(assistant.settings ? 'helpArticlesInUse' : 'helpArticlesNeedSettings', { inUse: String(assistant.helpArticles.inUse), published: String(assistant.helpArticles.published) })}
        </p>
      )}
      {!full && (
        <>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); addPage.mutate(); }}>
            <label className="min-w-48 flex-1 text-sm">{t('pageAddress')}
              <input className="field" type="url" required maxLength={2000} placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
            <button className="button" disabled={addPage.isPending}>{t('addPage')}</button>
          </form>
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); addText.mutate(); }}>
            <label className="block text-sm">{t('sourceTitle')}
              <input className="field" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="block text-sm">{t('sourceText')}
              <textarea className="field min-h-28" required maxLength={assistant.limits.textSourceChars} value={content} onChange={(event) => setContent(event.target.value)} />
            </label>
            <button className="button" disabled={addText.isPending}>{t('addText')}</button>
          </form>
        </>
      )}
    </section>
  );
}

type LearnedStatus = LearnedAnswer['status'];
const TABS: { status: LearnedStatus; label: MessageKey }[] = [
  { status: 'pending', label: 'learnedTabPending' },
  { status: 'approved', label: 'learnedTabApproved' },
  { status: 'rejected', label: 'learnedTabRejected' },
];

function LearnedItem({ workspaceId, item, onChanged }: { workspaceId: string; item: LearnedAnswer; onChanged: () => void }) {
  const [question, setQuestion] = useState(item.question);
  const [answer, setAnswer] = useState(item.answer);
  const decide = useMutation({
    mutationFn: (status: 'approved' | 'rejected') =>
      api.decideLearnedAnswer(workspaceId, item.id, { status, ...(question.trim() !== item.question ? { question: question.trim() } : {}), ...(answer.trim() !== item.answer ? { answer: answer.trim() } : {}) }),
    onSuccess: onChanged,
  });
  const remove = useMutation({ mutationFn: () => api.deleteLearnedAnswer(workspaceId, item.id), onSuccess: onChanged });
  const busy = decide.isPending || remove.isPending;
  const edited = question.trim() !== item.question || answer.trim() !== item.answer;
  return (
    <li className="space-y-2 py-3 text-sm">
      <Failure error={decide.error ?? remove.error} />
      <label className="block">{t('learnedQuestion')}
        <input className="field" required maxLength={300} value={question} onChange={(event) => setQuestion(event.target.value)} />
      </label>
      <label className="block">{t('learnedAnswer')}
        <textarea className="field min-h-20" required maxLength={1200} value={answer} onChange={(event) => setAnswer(event.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${quiet} flex-1`}>
          {t('learnedWhen', { date: new Date(item.createdAt).toLocaleDateString(intlLocale()) })}
          {item.status === 'approved' && <> · {t(item.inUse ? 'learnedInUse' : 'learnedPreparing')}</>}
        </span>
        {(item.status !== 'approved' || edited) && (
          <button className="button" disabled={busy || !question.trim() || !answer.trim()} onClick={() => decide.mutate('approved')}>{t('approve')}</button>
        )}
        {item.status !== 'rejected' && <button className="button-quiet" disabled={busy} onClick={() => decide.mutate('rejected')}>{t('reject')}</button>}
        <button className="button-quiet" disabled={busy} onClick={() => { if (window.confirm(t('learnedDeleteConfirm'))) remove.mutate(); }}>{t('delete')}</button>
      </div>
    </li>
  );
}

function LearnedCard({ workspaceId, websiteId, assistant }: { workspaceId: string; websiteId: string; assistant: Assistant }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<LearnedStatus>('pending');
  const learned = useQuery({
    queryKey: ['assistant-learned', workspaceId, websiteId, status],
    queryFn: () => api.listLearnedAnswers(workspaceId, websiteId, status),
    // An approved answer becomes "in use" when its indexing finishes, without anyone doing anything here.
    refetchInterval: (query) => (query.state.data?.data.some((item) => item.status === 'approved' && !item.inUse) ? 3000 : false),
  });
  const changed = () => {
    void client.invalidateQueries({ queryKey: ['assistant-learned', workspaceId, websiteId] });
    void client.invalidateQueries({ queryKey: ['assistant', workspaceId, websiteId] });
  };
  const autoApprove = useMutation({ mutationFn: (value: boolean) => api.setLearnedAutoApprove(workspaceId, value), onSuccess: changed });
  const counts = assistant.learning;
  return (
    <section className="card space-y-3" aria-label={t('learnedAnswers')}>
      <h2 className="font-medium">{t('learnedAnswers')}</h2>
      <p className={quiet}>{t('learnedHelp')}</p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={autoApprove.isPending ? autoApprove.variables : counts.autoApprove} disabled={autoApprove.isPending} onChange={(event) => autoApprove.mutate(event.target.checked)} aria-describedby="learned-auto-help" />
        <span>
          <span className="font-medium">{t('learnedAutoApprove')}</span>
          <span id="learned-auto-help" className={`block ${quiet}`}>{t('learnedAutoApproveHelp')}</span>
        </span>
      </label>
      <Failure error={autoApprove.error ?? learned.error} />
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button key={tab.status} role="tab" aria-selected={status === tab.status} className={status === tab.status ? 'button' : 'button-quiet'} onClick={() => setStatus(tab.status)}>
            {t(tab.label, { count: String(counts[tab.status]) })}
          </button>
        ))}
      </div>
      {learned.data?.data.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">{t('learnedNone')}</p>}
      <ul role="tabpanel" className="divide-y divide-slate-200 dark:divide-slate-800">
        {/* Keyed by the words too, so that a list refreshed after a change starts from what was saved. */}
        {learned.data?.data.map((item) => <LearnedItem key={`${item.id}:${item.updatedAt}`} workspaceId={workspaceId} item={item} onChanged={changed} />)}
      </ul>
    </section>
  );
}

/** Automatic translation of visitors' messages, for the whole workspace (ADR-0024). */
function TranslationCard({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['translation', workspaceId], queryFn: () => api.getTranslationSettings(workspaceId) });
  const save = useMutation({
    mutationFn: (input: { enabled: boolean; model: string }) => api.updateTranslationSettings(workspaceId, input),
    onSuccess: (data) => client.setQueryData(['translation', workspaceId], data),
  });
  const data = settings.data;
  if (!data) return <Failure error={settings.error} />;
  const value = save.isPending ? save.variables : { enabled: data.enabled, model: data.model };
  return (
    <section className="card space-y-3" aria-label={t('translationTitle')}>
      <h2 className="font-medium">{t('translationTitle')}</h2>
      <p className={quiet}>{t('translationIntro')}</p>
      {!data.available ? (
        <p className="text-sm">{t('translationUnavailable')}</p>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={value.enabled} disabled={save.isPending} onChange={(event) => save.mutate({ ...value, enabled: event.target.checked })} aria-describedby="translation-privacy" />
            <span>
              <span className="font-medium">{t('translationEnable')}</span>
              <span id="translation-privacy" className={`block ${quiet}`}>{t('translationPrivacy')}</span>
            </span>
          </label>
          <p className={quiet}>{t('translationUsage', { count: data.usage.characters.toLocaleString(intlLocale()), limit: data.usage.limit.toLocaleString(intlLocale()) })}</p>
        </>
      )}
      <Failure error={save.error} />
    </section>
  );
}

function TestCard({ workspaceId, websiteId }: { workspaceId: string; websiteId: string }) {
  const [question, setQuestion] = useState('');
  const ask = useMutation({ mutationFn: () => api.testAssistant(workspaceId, websiteId, question.trim()) });
  const answer = ask.data;
  return (
    <section className="card space-y-3" aria-label={t('assistantTest')}>
      <h2 className="font-medium">{t('assistantTest')}</h2>
      <p className={quiet}>{t('assistantTestHelp')}</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); ask.mutate(); }}>
        <label className="min-w-48 flex-1 text-sm">{t('question')}
          <input className="field" required maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} />
        </label>
        <button className="button" disabled={ask.isPending}>{t('ask')}</button>
      </form>
      <Failure error={ask.error} />
      {ask.isPending && <p className={quiet} role="status">{t('loading')}</p>}
      {answer && (
        <div className="space-y-2" role="status">
          {answer.outcome === 'answered' ? (
            <p className="text-sm whitespace-pre-wrap">
              <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium dark:bg-slate-800">{t('aiLabel')}</span>
              {answer.answer}
            </p>
          ) : (
            <p className="text-sm">{t(OUTCOMES[answer.outcome])}</p>
          )}
          {answer.sources.length > 0 && (
            <div>
              <h3 className={`${quiet} font-medium`}>{t('usedSources')}</h3>
              <ul className={`${quiet} list-disc pl-5`}>
                {answer.sources.map((source, i) => (
                  <li key={i}>
                    {source.url ? <a className="underline" href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a> : source.title} ({source.score.toFixed(2)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function AssistantPage({ workspaceId, isSupervisor }: { workspaceId: string; isSupervisor: boolean }) {
  const websites = useQuery({ queryKey: ['websites', workspaceId], queryFn: () => api.listWebsites(workspaceId), enabled: isSupervisor });
  const [websiteId, setWebsiteId] = useState<string | null>(null);
  const current = websites.data?.data.find((w) => w.id === websiteId) ?? websites.data?.data[0];
  useEffect(() => setWebsiteId(null), [workspaceId]);
  const assistant = useQuery({
    queryKey: ['assistant', workspaceId, current?.id],
    queryFn: () => api.getAssistant(workspaceId, current!.id),
    enabled: isSupervisor && current !== undefined,
    // While a source is being read, its status changes without anyone doing anything here.
    refetchInterval: (query) => {
      const data = query.state.data;
      const reading = data?.sources.some((s) => s.status === 'pending' || s.status === 'indexing') || (data?.settings && data.helpArticles.inUse < data.helpArticles.published);
      return reading ? 3000 : false;
    },
  });
  if (!isSupervisor) return <p className="card text-sm">{t('supervisorAssistant')}</p>;
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('assistantIntro')}</p>
      <TranslationCard workspaceId={workspaceId} />
      <Failure error={websites.error ?? assistant.error} />
      {websites.data?.data.length === 0 && <p className="card text-sm">{t('noWebsitesMember')}</p>}
      {websites.data && websites.data.data.length > 1 && current && (
        <label className="block max-w-sm text-sm">{t('assistantWebsite')}
          <select className="field" value={current.id} onChange={(event) => setWebsiteId(event.target.value)}>
            {websites.data.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
      )}
      {assistant.data && current && !assistant.data.available && <p className="card text-sm">{t('assistantUnavailable')}</p>}
      {assistant.data && current && assistant.data.available && (
        // Keyed, so that the forms start fresh for each website.
        <div key={current.id} className="space-y-6">
          <SettingsCard workspaceId={workspaceId} websiteId={current.id} assistant={assistant.data} />
          <SourcesCard workspaceId={workspaceId} websiteId={current.id} assistant={assistant.data} />
          <LearnedCard workspaceId={workspaceId} websiteId={current.id} assistant={assistant.data} />
          <TestCard workspaceId={workspaceId} websiteId={current.id} />
        </div>
      )}
    </div>
  );
}
