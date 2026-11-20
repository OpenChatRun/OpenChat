/**
 * The AI assistant, for supervisors (ADR-0022, step 1): its name and model, what it answers from, and a place to
 * try it. No visitor sees it yet.
 */
import type { Assistant, AssistantAnswer, AssistantSource } from '@openchat/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../app-context';
import { t, type MessageKey } from '../i18n';

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
  const [model, setModel] = useState(assistant.settings?.model ?? '');
  const [enabled, setEnabled] = useState(assistant.settings?.enabled ?? false);
  const save = useMutation({
    mutationFn: () => api.saveAssistantSettings(workspaceId, websiteId, { name: name.trim(), model: model || null, enabled }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['assistant', workspaceId, websiteId] }),
  });
  const defaultLabel = assistant.models.find((m) => m.id === assistant.defaultModel)?.label ?? assistant.defaultModel;
  return (
    <section className="card space-y-3" aria-label={t('assistantSettings')}>
      <h2 className="font-medium">{t('assistantSettings')}</h2>
      <Failure error={save.error} />
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <label className="min-w-40 flex-1 text-sm">{t('assistantNameLabel')}
          <input className="field" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="min-w-40 flex-1 text-sm">{t('assistantModel')}
          <select className="field" value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="">{t('assistantDefaultModel', { model: defaultLabel })}</option>
            {assistant.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
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
    refetchInterval: (query) => (query.state.data?.sources.some((s) => s.status === 'pending' || s.status === 'indexing') ? 3000 : false),
  });
  if (!isSupervisor) return <p className="card text-sm">{t('supervisorAssistant')}</p>;
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('assistantIntro')}</p>
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
          <TestCard workspaceId={workspaceId} websiteId={current.id} />
        </div>
      )}
    </div>
  );
}
