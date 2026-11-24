/**
 * The AI assistant, for supervisors (ADR-0022), in tabs: an overview with its switch, what it answers from and has
 * learned, a place to try it, its settings, and the workspace's automatic translation.
 */
import type { Assistant, AssistantAnswer, AssistantSource, LearnedAnswer, UnansweredQuestion } from '@openchat/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../app-context';
import { intlLocale, t, type MessageKey } from '../i18n';
import { navigate } from '../routes';

type Tab = 'overview' | 'knowledge' | 'test' | 'settings' | 'translation';
const PAGE_TABS: { tab: Tab; label: MessageKey }[] = [
  { tab: 'overview', label: 'assistantTabOverview' },
  { tab: 'knowledge', label: 'assistantTabKnowledge' },
  { tab: 'test', label: 'assistantTest' },
  { tab: 'settings', label: 'assistantSettings' },
  { tab: 'translation', label: 'assistantTabTranslation' },
];

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

function Tile({ label, value, detail }: { label: string; value: string; detail?: string | undefined }) {
  return (
    <div className="card">
      <div className={`${quiet} font-medium`}>{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {detail && <div className={`mt-0.5 ${quiet}`}>{detail}</div>}
    </div>
  );
}

/** Whether it answers visitors, with the switch, and what it has to answer from. */
function OverviewCard({ workspaceId, websiteId, assistant, onOpen }: { workspaceId: string; websiteId: string; assistant: Assistant; onOpen: (tab: Tab) => void }) {
  const client = useQueryClient();
  const settings = assistant.settings;
  const enabled = settings?.enabled ?? false;
  const toggle = useMutation({
    mutationFn: () => api.saveAssistantSettings(workspaceId, websiteId, { name: settings?.name ?? t('sectionAssistant'), model: settings?.model ?? null, enabled: !enabled, learn: settings?.learn ?? false }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['assistant', workspaceId, websiteId] }),
  });
  // For the whole workspace: Analytics does not count by website.
  const month = useQuery({ queryKey: ['analytics', workspaceId, 30], queryFn: () => api.getAnalytics(workspaceId, { days: 30, utcOffsetMinutes: -new Date().getTimezoneOffset() }) });
  const number = new Intl.NumberFormat(intlLocale());
  const ready = assistant.sources.filter((source) => source.status === 'ready').length;
  const empty = assistant.sources.length === 0 && assistant.helpArticles.published === 0 && assistant.learning.approved === 0;
  return (
    <div className="space-y-6">
      <section className="card space-y-3" aria-label={t('assistantTabOverview')}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-48 flex-1">
            <h2 className="font-medium">{settings?.name ?? t('sectionAssistant')}</h2>
            <p className="flex items-center gap-2 text-sm" role="status">
              <span className={`size-2 rounded-full ${enabled ? 'bg-green-500' : 'bg-slate-400'}`} aria-hidden="true" />
              {t(enabled ? 'assistantOn' : 'assistantOff')}
            </p>
          </div>
          <button type="button" className={enabled ? 'button-quiet' : 'button'} disabled={toggle.isPending || (!assistant.canReply && !enabled)} onClick={() => toggle.mutate()}>{t(enabled ? 'assistantTurnOff' : 'assistantTurnOn')}</button>
        </div>
        <Failure error={toggle.error} />
        <p className={quiet}>{assistant.canReply || enabled ? t('assistantEnabledHelp', { count: String(assistant.limits.turnsPerConversation) }) : t('assistantCannotReply')}</p>
        {empty && (
          <p className="flex flex-wrap items-center gap-3 text-sm">
            <span className="min-w-48 flex-1">{t('assistantNeedsKnowledge')}</span>
            <button type="button" className="button-quiet" onClick={() => onOpen('knowledge')}>{t('assistantTabKnowledge')}</button>
          </p>
        )}
      </section>
      <section className="space-y-3" aria-label={t('assistantTabKnowledge')}>
        <h2 className="text-sm font-semibold">{t('assistantTabKnowledge')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile label={t('assistantSources')} value={`${number.format(ready)} / ${number.format(assistant.sources.length)}`} />
          <Tile label={t('helpArticlesTile')} value={`${number.format(assistant.helpArticles.inUse)} / ${number.format(assistant.helpArticles.published)}`} />
          <Tile label={t('learnedAnswers')} value={number.format(assistant.learning.approved)} detail={assistant.learning.pending > 0 ? t('assistantPendingReview', { count: number.format(assistant.learning.pending) }) : undefined} />
        </div>
      </section>
      {month.data && month.data.assistantAnswered > 0 && (
        <section className="space-y-3" aria-label={t('assistantLast30')}>
          <h2 className="text-sm font-semibold">{t('assistantLast30')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile label={t('analyticsAssistant')} value={number.format(month.data.assistantAnswered)} />
            <Tile label={t('assistantNoPerson')} value={number.format(month.data.assistantOnly)} />
          </div>
        </section>
      )}
    </div>
  );
}

function SettingsCard({ workspaceId, websiteId, assistant }: { workspaceId: string; websiteId: string; assistant: Assistant }) {
  const client = useQueryClient();
  const [name, setName] = useState(assistant.settings?.name ?? t('sectionAssistant'));
  const [learn, setLearn] = useState(assistant.settings?.learn ?? false);
  const save = useMutation({
    // The model is whoever runs the installation's choice, and answering visitors is the overview's switch: both go back as they are.
    mutationFn: () => api.saveAssistantSettings(workspaceId, websiteId, { name: name.trim(), model: assistant.settings?.model ?? null, enabled: assistant.settings?.enabled ?? false, learn }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['assistant', workspaceId, websiteId] }),
  });
  return (
    <section className="card space-y-3" aria-label={t('assistantSettings')}>
      <h2 className="font-medium">{t('assistantSettings')}</h2>
      <Failure error={save.error} />
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <label className="block max-w-sm text-sm">{t('assistantNameLabel')}
          <input className="field" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
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
  const addPage = useMutation({ mutationFn: () => api.addAssistantSource(workspaceId, websiteId, { kind: 'page', url: url.trim() }), onSuccess: () => { setUrl(''); setAdding(null); void refresh(); } });
  const addText = useMutation({ mutationFn: () => api.addAssistantSource(workspaceId, websiteId, { kind: 'text', title: title.trim(), content }), onSuccess: () => { setTitle(''); setContent(''); setAdding(null); void refresh(); } });
  const reread = useMutation({ mutationFn: (source: AssistantSource) => api.updateAssistantSource(workspaceId, source.id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (source: AssistantSource) => api.deleteAssistantSource(workspaceId, source.id), onSuccess: refresh });
  const full = assistant.sources.length >= assistant.limits.sourcesPerWebsite;
  const [adding, setAdding] = useState<'page' | 'text' | null>(null);
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
      {!full && adding === null && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button" onClick={() => setAdding('page')}>{t('addPage')}</button>
          <button type="button" className="button-quiet" onClick={() => setAdding('text')}>{t('addText')}</button>
        </div>
      )}
      {!full && adding === 'page' && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); addPage.mutate(); }}>
          <label className="min-w-48 flex-1 text-sm">{t('pageAddress')}
            <input className="field" type="url" required autoFocus maxLength={2000} placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>
          <button className="button" disabled={addPage.isPending}>{t('addPage')}</button>
          <button type="button" className="button-quiet" onClick={() => setAdding(null)}>{t('cancel')}</button>
        </form>
      )}
      {!full && adding === 'text' && (
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); addText.mutate(); }}>
          <label className="block text-sm">{t('sourceTitle')}
            <input className="field" required autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="block text-sm">{t('sourceText')}
            <textarea className="field min-h-28" required maxLength={assistant.limits.textSourceChars} value={content} onChange={(event) => setContent(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="button" disabled={addText.isPending}>{t('addText')}</button>
            <button type="button" className="button-quiet" onClick={() => setAdding(null)}>{t('cancel')}</button>
          </div>
        </form>
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

function UnansweredItem({ workspaceId, item, onChanged }: { workspaceId: string; item: UnansweredQuestion; onChanged: () => void }) {
  const [answering, setAnswering] = useState(false);
  const [question, setQuestion] = useState(item.question.slice(0, 300));
  const [answer, setAnswer] = useState('');
  const save = useMutation({ mutationFn: () => api.answerUnansweredQuestion(workspaceId, item.id, { question: question.trim(), answer: answer.trim() }), onSuccess: onChanged });
  const dismiss = useMutation({ mutationFn: () => api.dismissUnansweredQuestion(workspaceId, item.id), onSuccess: onChanged });
  const busy = save.isPending || dismiss.isPending;
  return (
    <li className="space-y-2 py-3 text-sm">
      <Failure error={save.error ?? dismiss.error} />
      {!answering && <p className="whitespace-pre-wrap break-words">{item.question.length > 300 ? `${item.question.slice(0, 300)}…` : item.question}</p>}
      {answering && (
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <label className="block">{t('learnedQuestion')}
            <input className="field" required maxLength={300} value={question} onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <label className="block">{t('learnedAnswer')}
            <textarea className="field min-h-20" required maxLength={1200} autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="button" disabled={busy || !question.trim() || !answer.trim()}>{t('unansweredSave')}</button>
            <button type="button" className="button-quiet" disabled={busy} onClick={() => setAnswering(false)}>{t('cancel')}</button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${quiet} flex-1`}>
          {t('unansweredWhen', { date: new Date(item.askedAt).toLocaleDateString(intlLocale()) })} · {t(item.reason === 'no_sources' ? 'unansweredNoSources' : 'unansweredUnsure')}
        </span>
        {!answering && <button className="button" disabled={busy} onClick={() => setAnswering(true)}>{t('unansweredAdd')}</button>}
        <button className="button-quiet" disabled={busy} onClick={() => navigate({ section: 'inbox', adminPage: null, conversationId: item.conversationId })}>{t('unansweredOpen')}</button>
        <button className="button-quiet" disabled={busy} onClick={() => dismiss.mutate()}>{t('unansweredDismiss')}</button>
      </div>
    </li>
  );
}

/** What the assistant handed to the team for want of an answer, each with a place to write one. */
function UnansweredCard({ workspaceId, websiteId }: { workspaceId: string; websiteId: string }) {
  const client = useQueryClient();
  const questions = useQuery({ queryKey: ['assistant-unanswered', workspaceId, websiteId], queryFn: () => api.listUnansweredQuestions(workspaceId, websiteId) });
  const changed = () => {
    void client.invalidateQueries({ queryKey: ['assistant-unanswered', workspaceId, websiteId] });
    void client.invalidateQueries({ queryKey: ['assistant-learned', workspaceId, websiteId] });
    void client.invalidateQueries({ queryKey: ['assistant', workspaceId, websiteId] });
  };
  return (
    <section className="card space-y-3" aria-label={t('unansweredTitle')}>
      <h2 className="font-medium">{t('unansweredTitle')}</h2>
      <p className={quiet}>{t('unansweredHelp')}</p>
      <Failure error={questions.error} />
      {questions.data?.data.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">{t('unansweredNone')}</p>}
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {questions.data?.data.map((item) => <UnansweredItem key={item.id} workspaceId={workspaceId} item={item} onChanged={changed} />)}
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
  const [tab, setTab] = useState<Tab>('overview');
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
  const data = assistant.data;
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('assistantIntro')}</p>
      <div role="tablist" aria-label={t('sectionAssistant')} className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {PAGE_TABS.map((item) => (
          <button
            key={item.tab}
            type="button"
            role="tab"
            id={`assistant-tab-${item.tab}`}
            aria-selected={tab === item.tab}
            aria-controls="assistant-panel"
            className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium ${tab === item.tab ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300' : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}
            onClick={() => setTab(item.tab)}
          >
            {t(item.label)}
            {item.tab === 'knowledge' && data && data.learning.pending + data.unanswered > 0 && <span className="ml-2 rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">{data.learning.pending + data.unanswered}</span>}
          </button>
        ))}
      </div>
      <div id="assistant-panel" role="tabpanel" aria-labelledby={`assistant-tab-${tab}`} className="space-y-6">
        {tab === 'translation' ? (
          <TranslationCard workspaceId={workspaceId} />
        ) : (
          <>
            <Failure error={websites.error ?? assistant.error} />
            {websites.data?.data.length === 0 && <p className="card text-sm">{t('noWebsitesMember')}</p>}
            {websites.data && websites.data.data.length > 1 && current && (
              <label className="block max-w-sm text-sm">{t('assistantWebsite')}
                <select className="field" value={current.id} onChange={(event) => setWebsiteId(event.target.value)}>
                  {websites.data.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
            )}
            {data && current && !data.available && <p className="card text-sm">{t('assistantUnavailable')}</p>}
            {data && current && data.available && (
              // Keyed, so that the forms start fresh for each website.
              <div key={current.id} className="space-y-6">
                {tab === 'overview' && <OverviewCard workspaceId={workspaceId} websiteId={current.id} assistant={data} onOpen={setTab} />}
                {tab === 'knowledge' && (
                  <>
                    <SourcesCard workspaceId={workspaceId} websiteId={current.id} assistant={data} />
                    <UnansweredCard workspaceId={workspaceId} websiteId={current.id} />
                    <LearnedCard workspaceId={workspaceId} websiteId={current.id} assistant={data} />
                  </>
                )}
                {tab === 'test' && <TestCard workspaceId={workspaceId} websiteId={current.id} />}
                {tab === 'settings' && <SettingsCard workspaceId={workspaceId} websiteId={current.id} assistant={data} />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
