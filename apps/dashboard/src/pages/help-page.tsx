/**
 * The help centre (ADR-0023): a website's public address, its collections, its articles and their images. Every
 * member can read it, so that an agent can find an article to link; supervisors change it.
 *
 * The preview is the server's own renderer, from @openchat/shared, so what a writer sees is what a visitor gets. It
 * builds HTML from an allow-list and escapes everything else, which is why it may be set as HTML here.
 */
import type { HelpArticle, HelpArticleInput, HelpArticleSummary, HelpCentre, HelpDraftInput, HelpDraftRun } from '@openchat/api-client';
import { renderHelpMarkdown } from '@openchat/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../app-context';
import { applyHelpFormat, type HelpFormat } from '../help-format';
import { getLocale, intlLocale, t, type MessageKey } from '../i18n';
import { LANGUAGES } from '../i18n/locales';

const quiet = 'text-xs text-slate-600 dark:text-slate-400';
const languageName = (code: string) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code;

function Failure({ error }: { error: unknown }) {
  return error ? <p className="error" role="alert">{errorMessage(error)}</p> : null;
}

function StatusBadge({ status }: { status: HelpArticleSummary['status'] }) {
  return status === 'published' ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{t('helpStatusPublished')}</span>
  ) : (
    <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">{t('helpStatusDraft')}</span>
  );
}

function AiBadge() {
  return <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">{t('helpAiDrafted')}</span>;
}

const OPEN_RUN = new Set(['uploading', 'queued', 'reading', 'writing']);
export const draftRunning = (help: HelpCentre | undefined) => help?.drafting.runs.some((run) => OPEN_RUN.has(run.status) && run.status !== 'uploading') ?? false;

function runText(run: HelpDraftRun): string {
  if (run.status === 'queued' || run.status === 'reading') return t('helpDraftReading');
  if (run.status === 'writing') return t('helpDraftWriting', { written: String(run.written), planned: String(run.planned) });
  if (run.status === 'done') return `${t('helpDraftDone', { written: String(run.written) })}${run.failed > 0 ? ` · ${t('helpDraftSkipped', { failed: String(run.failed) })}` : ''}`;
  if (run.status === 'uploading' || run.errorCode === 'timed_out') return t('helpDraftTimedOut');
  return run.errorCode === 'no_outline' ? t('helpDraftNoOutline') : t('helpDraftNoMaterial');
}

const DRAFT_FILE_TYPES = '.pdf,.docx,.odt,.html,.htm,.md,.markdown,.txt';

function DraftCard({ workspaceId, help, language }: { workspaceId: string; help: HelpCentre; language: string }) {
  const client = useQueryClient();
  const [readWebsite, setReadWebsite] = useState(true);
  const [links, setLinks] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const start = useMutation({
    mutationFn: async () => {
      const run = await api.createHelpDraftRun(workspaceId, help.websiteId, {
        language: language as HelpDraftInput['language'],
        collectionId: collectionId || null,
        readWebsite,
        links: links.split(/\s+/).map((l) => l.trim()).filter(Boolean),
      });
      for (const file of files) await api.uploadHelpDraftFile(workspaceId, run.id, file);
      return api.startHelpDraftRun(workspaceId, run.id);
    },
    onSuccess: () => { setLinks(''); setFiles([]); },
    onSettled: () => client.invalidateQueries({ queryKey: ['help', workspaceId, help.websiteId] }),
  });
  const running = draftRunning(help);
  const nothing = !readWebsite && !links.trim() && files.length === 0;
  return (
    <section className="card space-y-3" aria-label={t('helpDraftTitle')}>
      <h2 className="font-medium">{t('helpDraftTitle')}</h2>
      <p className={quiet}>{t('helpDraftIntro')}</p>
      <Failure error={start.error} />
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); start.mutate(); }}>
        <fieldset className="space-y-3" disabled={running || start.isPending}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={readWebsite} onChange={(event) => setReadWebsite(event.target.checked)} />
            {t('helpDraftReadWebsite')}
          </label>
          <label className="block text-sm">{t('helpDraftLinks')}
            <textarea className="field min-h-20 font-mono text-xs" value={links} onChange={(event) => setLinks(event.target.value)} placeholder="https://" />
          </label>
          <div className="space-y-1 text-sm">
            <div>{t('helpDraftFiles')}</div>
            <input ref={input} type="file" multiple className="sr-only" accept={DRAFT_FILE_TYPES} onChange={(event) => { setFiles([...(event.target.files ?? [])].slice(0, 10)); event.target.value = ''; }} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="button-quiet" onClick={() => input.current?.click()}>{t('helpDraftChooseFiles')}</button>
              {files.map((file) => <span key={file.name} className={quiet}>{file.name}</span>)}
            </div>
          </div>
          <label className="block text-sm">{t('helpCollection')}
            <select className="field" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
              <option value="">{t('helpDraftCollectionAuto')}</option>
              {help.collections.filter((c) => c.language === language).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <p className={quiet}>{t('helpDraftLanguageNote', { language: languageName(language) })}</p>
          <button className="button" disabled={nothing}>{t('helpDraftStart')}</button>
        </fieldset>
      </form>
      {help.drafting.runs.length > 0 && (
        <div className="space-y-1 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
          <div className="font-medium">{t('helpDraftRecent')}</div>
          <ul className="space-y-1" aria-live="polite">
            {help.drafting.runs.map((run) => (
              <li key={run.id} className="flex flex-wrap gap-2">
                <span className={quiet}>{new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(run.createdAt))} · {languageName(run.language)}</span>
                <span>{runText(run)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const publicUrl = (slug: string, language?: string, articleSlug?: string) =>
  `${location.origin}/help/${slug}${language ? `/${language.toLowerCase()}` : ''}${articleSlug ? `/${encodeURIComponent(articleSlug)}` : ''}`;

function AddressCard({ workspaceId, help, canEdit }: { workspaceId: string; help: HelpCentre; canEdit: boolean }) {
  const client = useQueryClient();
  const [slug, setSlug] = useState(help.slug ?? '');
  const [noindex, setNoindex] = useState(help.noindex);
  const save = useMutation({
    mutationFn: (next: string | null) => api.saveHelpSettings(workspaceId, help.websiteId, { slug: next, noindex }),
    onSuccess: (result) => {
      setSlug(result.slug ?? '');
      void client.invalidateQueries({ queryKey: ['help', workspaceId, help.websiteId] });
    },
  });
  return (
    <section className="card space-y-3" aria-label={t('helpAddress')}>
      <h2 className="font-medium">{t('helpAddress')}</h2>
      {help.slug ? (
        <p className="text-sm">
          <a className="font-medium text-brand-600 underline dark:text-brand-300" href={publicUrl(help.slug)} target="_blank" rel="noreferrer">{publicUrl(help.slug)}</a>
        </p>
      ) : (
        <p className={quiet}>{t('helpAddressOff')}</p>
      )}
      <Failure error={save.error} />
      {canEdit && (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save.mutate(slug.trim() || null); }}>
          <label className="block text-sm">
            <span className="sr-only">{t('helpAddress')}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1">
              <span className={`${quiet} min-w-0 break-all`}>{location.origin}/help/</span>
              <input className="field min-w-40 flex-1" required maxLength={50} pattern="[a-z0-9](?:[a-z0-9\-]{0,48}[a-z0-9])?" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} aria-describedby="help-address-help" />
            </span>
            <span id="help-address-help" className={`block ${quiet}`}>{t('helpAddressHelp')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noindex} onChange={(event) => setNoindex(event.target.checked)} />
            {t('helpNoindex')}
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="button" disabled={save.isPending}>{t('saveSettings')}</button>
            {help.slug && <button type="button" className="button-quiet" disabled={save.isPending} onClick={() => save.mutate(null)}>{t('helpTurnOff')}</button>}
          </div>
          {save.isSuccess && <p className={quiet} role="status">{t('saved')}</p>}
        </form>
      )}
    </section>
  );
}

function CollectionsCard({ workspaceId, help, language }: { workspaceId: string; help: HelpCentre; language: string }) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['help', workspaceId, help.websiteId] });
  const [name, setName] = useState('');
  const add = useMutation({ mutationFn: () => api.createHelpCollection(workspaceId, help.websiteId, { language, name: name.trim() }), onSuccess: () => { setName(''); void refresh(); } });
  const rename = useMutation({ mutationFn: (input: { id: string; name: string }) => api.updateHelpCollection(workspaceId, input.id, { name: input.name }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteHelpCollection(workspaceId, id), onSuccess: refresh });
  const collections = help.collections.filter((c) => c.language === language);
  return (
    <section className="card space-y-3" aria-label={t('helpCollections')}>
      <h2 className="font-medium">{t('helpCollections')}</h2>
      <p className={quiet}>{t('helpCollectionsHelp')}</p>
      <Failure error={add.error ?? rename.error ?? remove.error} />
      {collections.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">{t('noneYet')}</p>}
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {collections.map((collection) => (
          <li key={collection.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <input
              className="field min-w-40 flex-1"
              defaultValue={collection.name}
              maxLength={100}
              aria-label={t('helpCollectionName')}
              onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== collection.name) rename.mutate({ id: collection.id, name: next }); }}
            />
            <button className="button-quiet" disabled={remove.isPending} onClick={() => remove.mutate(collection.id)}>{t('delete')}</button>
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); add.mutate(); }}>
        <label className="min-w-40 flex-1 text-sm">{t('helpCollectionName')}
          <input className="field" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="button" disabled={add.isPending}>{t('helpAddCollection')}</button>
      </form>
    </section>
  );
}

function ImagesCard({ workspaceId, help, onInsert }: { workspaceId: string; help: HelpCentre; onInsert: ((markdown: string) => void) | null }) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['help', workspaceId, help.websiteId] });
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({ mutationFn: (file: File) => api.uploadHelpAsset(workspaceId, help.websiteId, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteHelpAsset(workspaceId, id), onSuccess: refresh });
  return (
    <section className="card space-y-3" aria-label={t('helpImages')}>
      <h2 className="font-medium">{t('helpImages')}</h2>
      <p className={quiet}>{t('helpImagesHelp')}</p>
      <Failure error={upload.error ?? remove.error} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {help.assets.map((asset) => (
          <li key={asset.id} className="space-y-1 text-xs">
            <img className="aspect-video w-full rounded-md border border-slate-200 object-cover dark:border-slate-800" src={asset.url} alt={asset.filename} loading="lazy" />
            <div className="truncate">{asset.filename}</div>
            <div className="flex gap-2">
              {onInsert && <button type="button" className="button-quiet" onClick={() => onInsert(`![${asset.filename.replace(/\.[a-z]+$/i, '').replace(/[[\]]/g, '')}](${asset.url})`)}>{t('helpInsert')}</button>}
              <button type="button" className="button-quiet" disabled={remove.isPending} onClick={() => remove.mutate(asset.id)}>{t('delete')}</button>
            </div>
          </li>
        ))}
      </ul>
      <input ref={input} type="file" className="sr-only" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ''; }} />
      <button type="button" className="button-quiet" disabled={upload.isPending} onClick={() => input.current?.click()}>{t('helpUpload')}</button>
    </section>
  );
}

/** The toolbar's buttons, in order: what each shows, its name, and its key with Ctrl or ⌘. */
const FORMATS: { format: HelpFormat; glyph: string; label: MessageKey; key?: string; className?: string }[] = [
  { format: 'heading', glyph: 'H', label: 'helpFormatHeading' },
  { format: 'bold', glyph: 'B', label: 'helpFormatBold', key: 'b', className: 'font-bold' },
  { format: 'italic', glyph: 'I', label: 'helpFormatItalic', key: 'i', className: 'italic' },
  { format: 'bullets', glyph: '•', label: 'helpFormatBullets' },
  { format: 'numbers', glyph: '1.', label: 'helpFormatNumbers' },
  { format: 'quote', glyph: '”', label: 'helpFormatQuote' },
  { format: 'link', glyph: '🔗', label: 'helpFormatLink', key: 'k' },
  { format: 'code', glyph: '</>', label: 'helpFormatCode', className: 'font-mono text-xs' },
];

function Editor({ workspaceId, help, articleId, canEdit, onClose }: { workspaceId: string; help: HelpCentre; articleId: string; canEdit: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const article = useQuery({ queryKey: ['help-article', workspaceId, articleId], queryFn: () => api.getHelpArticle(workspaceId, articleId) });
  const [draft, setDraft] = useState<{ title: string; summary: string; bodyMarkdown: string; collectionId: string | null } | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  // What to select once the text a toolbar button changed is in the box.
  const select = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    if (!select.current || !body.current) return;
    body.current.focus();
    body.current.setSelectionRange(select.current.start, select.current.end);
    select.current = null;
  });
  useEffect(() => {
    if (article.data && !draft) setDraft({ title: article.data.title, summary: article.data.summary, bodyMarkdown: article.data.bodyMarkdown, collectionId: article.data.collectionId });
  }, [article.data, draft]);

  const settle = (saved: HelpArticle) => {
    client.setQueryData(['help-article', workspaceId, articleId], saved);
    void client.invalidateQueries({ queryKey: ['help', workspaceId, help.websiteId] });
  };
  const save = useMutation({
    mutationFn: () => api.updateHelpArticle(workspaceId, articleId, { expectedVersion: article.data!.version, ...draft! }),
    onSuccess: settle,
  });
  const status = useMutation({
    mutationFn: async (next: 'draft' | 'published') => {
      if (dirty) await save.mutateAsync();
      return api.setHelpArticleStatus(workspaceId, articleId, next);
    },
    onSuccess: settle,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteHelpArticle(workspaceId, articleId),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['help', workspaceId, help.websiteId] }); onClose(); },
  });
  const translate = useMutation({
    mutationFn: (language: string) => api.createHelpArticle(workspaceId, help.websiteId, { language: language as HelpArticleInput['language'], title: draft!.title, summary: draft!.summary, bodyMarkdown: draft!.bodyMarkdown, translationOf: articleId }),
    onSuccess: (created) => { void client.invalidateQueries({ queryKey: ['help', workspaceId, help.websiteId] }); window.dispatchEvent(new CustomEvent('oc-help-open', { detail: created.id })); },
  });

  if (!article.data || !draft) return <section className="card"><Failure error={article.error} /></section>;
  const current = article.data;
  const dirty = draft.title !== current.title || draft.summary !== current.summary || draft.bodyMarkdown !== current.bodyMarkdown || draft.collectionId !== current.collectionId;
  const translations = help.articles.filter((a) => a.translationGroupId === current.translationGroupId && a.id !== current.id);
  const missing = help.languages.filter((l) => l !== current.language && !translations.some((a) => a.language === l));
  const insert = (text: string) => {
    const area = body.current;
    const at = area?.selectionStart ?? draft.bodyMarkdown.length;
    setDraft({ ...draft, bodyMarkdown: `${draft.bodyMarkdown.slice(0, at)}${text}${draft.bodyMarkdown.slice(area?.selectionEnd ?? at)}` });
  };

  const format = (kind: HelpFormat) => {
    const area = body.current;
    if (!area) return;
    const edit = applyHelpFormat(draft.bodyMarkdown, area.selectionStart, area.selectionEnd, kind);
    if (edit.text.length > help.limits.bodyChars) return;
    select.current = { start: edit.start, end: edit.end };
    setDraft({ ...draft, bodyMarkdown: edit.text });
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-3" aria-label={draft.title || t('helpTitle')}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="button-quiet" onClick={onClose}>← {t('helpAllArticles')}</button>
          <span className="flex-1" />
          <span className={quiet}>{languageName(current.language)}</span>
          {current.aiDrafted && <AiBadge />}
          <StatusBadge status={current.status} />
          {current.status === 'published' && help.slug && (
            <a className="text-sm text-brand-600 underline dark:text-brand-300" href={publicUrl(help.slug, current.language, current.slug)} target="_blank" rel="noreferrer">{t('helpView')}</a>
          )}
        </div>
        <Failure error={save.error ?? status.error ?? remove.error ?? translate.error} />
        {current.aiDrafted && (
          <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/40">
            <p>{t('helpAiCheck')}</p>
            <ul className="mt-1 list-disc pl-5">
              {current.aiSources.map((source) => (
                <li key={`${source.title}-${source.url ?? ''}`} className="break-words">
                  {source.url ? <a className="underline" href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a> : source.title}
                </li>
              ))}
            </ul>
          </div>
        )}
        <fieldset className="space-y-3" disabled={!canEdit}>
          <label className="block text-sm">{t('helpTitle')}
            <input className="field" required maxLength={help.limits.titleChars} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="block text-sm">{t('helpSummary')}
            <input className="field" maxLength={help.limits.summaryChars} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} aria-describedby="help-summary-help" />
            <span id="help-summary-help" className={`block ${quiet}`}>{t('helpSummaryHelp')}</span>
          </label>
          <label className="block text-sm">{t('helpCollection')}
            <select className="field" value={draft.collectionId ?? ''} onChange={(event) => setDraft({ ...draft, collectionId: event.target.value || null })}>
              <option value="">{t('helpNoCollection')}</option>
              {help.collections.filter((c) => c.language === current.language).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="text-sm">
              <label htmlFor="help-body">{t('helpBody')}</label>
              <div role="toolbar" aria-label={t('helpFormatting')} aria-controls="help-body" className="mt-1 flex flex-wrap gap-1 rounded-t-lg border border-b-0 border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
                {FORMATS.map((item) => (
                  <button
                    key={item.format}
                    type="button"
                    className={`h-8 min-w-8 cursor-pointer rounded px-2 text-sm text-slate-700 hover:bg-slate-200 disabled:cursor-default disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800 ${item.className ?? ''}`}
                    aria-label={t(item.label)}
                    title={item.key ? `${t(item.label)} (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}${item.key.toUpperCase()})` : t(item.label)}
                    // Keeps the selection in the text box, which a click would otherwise take.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => format(item.format)}
                  >
                    <span aria-hidden="true">{item.glyph}</span>
                  </button>
                ))}
              </div>
              <textarea
                id="help-body"
                ref={body}
                className="field mt-0 min-h-80 rounded-t-none font-mono text-sm"
                maxLength={help.limits.bodyChars}
                value={draft.bodyMarkdown}
                onChange={(event) => setDraft({ ...draft, bodyMarkdown: event.target.value })}
                onKeyDown={(event) => {
                  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
                  const item = FORMATS.find((f) => f.key === event.key.toLowerCase());
                  if (!item) return;
                  event.preventDefault();
                  format(item.format);
                }}
                aria-describedby="help-body-help"
              />
              <span id="help-body-help" className={`block ${quiet}`}>{t('helpBodyHelp')}</span>
            </div>
            <div className="text-sm">
              <div className="mb-1">{t('helpPreview')}</div>
              {/* The renderer escapes everything and builds tags from an allow-list: see help-text.ts. */}
              <div className="help-preview min-h-80 rounded-md border border-slate-200 p-3 dark:border-slate-800" dangerouslySetInnerHTML={{ __html: renderHelpMarkdown(draft.bodyMarkdown) }} />
            </div>
          </div>
        </fieldset>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="button" disabled={!dirty || save.isPending || !draft.title.trim()} onClick={() => save.mutate()}>{t('helpSave')}</button>
            {current.status === 'draft' ? (
              <button className="button-quiet" disabled={status.isPending || !draft.title.trim()} onClick={() => status.mutate('published')}>{t('helpPublish')}</button>
            ) : (
              <button className="button-quiet" disabled={status.isPending} onClick={() => status.mutate('draft')}>{t('helpUnpublish')}</button>
            )}
            {dirty && <span className={quiet} role="status">{t('helpUnsaved')}</span>}
            <span className="flex-1" />
            <button className="button-quiet" disabled={remove.isPending} onClick={() => { if (confirm(t('helpDeleteConfirm', { title: current.title }))) remove.mutate(); }}>{t('helpDeleteArticle')}</button>
          </div>
        )}
        {(translations.length > 0 || (canEdit && missing.length > 0)) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
            {translations.length > 0 && (
              <span>
                {t('helpTranslations')}:{' '}
                {translations.map((a, index) => (
                  <span key={a.id}>{index > 0 && ' · '}<button type="button" className="underline" onClick={() => window.dispatchEvent(new CustomEvent('oc-help-open', { detail: a.id }))}>{languageName(a.language)}</button></span>
                ))}
              </span>
            )}
            {canEdit && missing.length > 0 && (
              <label className="ml-auto flex items-center gap-2">{t('helpTranslate')}
                <select className="field w-auto" value="" disabled={translate.isPending} onChange={(event) => event.target.value && translate.mutate(event.target.value)}>
                  <option value="">…</option>
                  {missing.map((l) => <option key={l} value={l}>{languageName(l)}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
      </section>
      {canEdit && <ImagesCard workspaceId={workspaceId} help={help} onInsert={insert} />}
    </div>
  );
}

function ArticlesCard({ workspaceId, help, language, canEdit, onOpen }: { workspaceId: string; help: HelpCentre; language: string; canEdit: boolean; onOpen: (id: string) => void }) {
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: () => api.createHelpArticle(workspaceId, help.websiteId, { language: language as HelpArticleInput['language'], title: title.trim() }),
    onSuccess: (article) => { setTitle(''); void client.invalidateQueries({ queryKey: ['help', workspaceId, help.websiteId] }); onOpen(article.id); },
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | HelpArticleSummary['status']>('all');
  const inLanguage = help.articles.filter((a) => a.language === language);
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const articles = inLanguage.filter((a) => (status === 'all' || a.status === status) && words.every((word) => a.title.toLocaleLowerCase().includes(word)));
  const collections = new Map(help.collections.map((c) => [c.id, c.name]));
  const date = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' });
  return (
    <section className="card space-y-3" aria-label={t('helpArticles')}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="flex-1 font-medium">{t('helpArticles')}</h2>
        <span className={quiet}>{t('helpArticleCount', { count: String(help.articles.length), limit: String(help.limits.articlesPerWebsite) })}</span>
      </div>
      <Failure error={create.error} />
      {canEdit && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <label className="min-w-48 flex-1 text-sm">{t('helpTitle')}
            <input className="field" required maxLength={help.limits.titleChars} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button className="button" disabled={create.isPending}>{t('helpNewArticle')}</button>
        </form>
      )}
      {inLanguage.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <input type="search" className="field mt-0 min-w-48 flex-1" aria-label={t('helpSearchArticles')} placeholder={t('helpSearchArticles')} value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className="field mt-0 w-auto" aria-label={t('helpFilterStatus')} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">{t('helpStatusAll', { count: String(inLanguage.length) })}</option>
            <option value="published">{t('helpStatusPublished')} ({inLanguage.filter((a) => a.status === 'published').length})</option>
            <option value="draft">{t('helpStatusDraft')} ({inLanguage.filter((a) => a.status === 'draft').length})</option>
          </select>
        </div>
      )}
      {inLanguage.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">{t('helpEmptyLanguage')}</p>}
      {inLanguage.length > 0 && articles.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">{t('helpNoMatch')}</p>}
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {articles.map((article) => (
          <li key={article.id}>
            <button type="button" className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-900" onClick={() => onOpen(article.id)}>
              <span className="min-w-48 flex-1">
                <span className="block font-medium break-words">{article.title}</span>
                <span className={quiet}>{article.collectionId ? collections.get(article.collectionId) : t('helpNoCollection')} · {date.format(new Date(article.updatedAt))}</span>
              </span>
              {article.aiDrafted && <AiBadge />}
              <StatusBadge status={article.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type HelpTab = 'articles' | 'collections' | 'images' | 'settings';
const HELP_TABS: { tab: HelpTab; label: MessageKey }[] = [
  { tab: 'articles', label: 'helpArticles' },
  { tab: 'collections', label: 'helpCollections' },
  { tab: 'images', label: 'helpImages' },
  { tab: 'settings', label: 'sectionSettings' },
];

export function HelpPage({ workspaceId, isSupervisor }: { workspaceId: string; isSupervisor: boolean }) {
  const websites = useQuery({ queryKey: ['websites', workspaceId], queryFn: () => api.listWebsites(workspaceId) });
  const [websiteId, setWebsiteId] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>(getLocale());
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<HelpTab>('articles');
  const current = websites.data?.data.find((w) => w.id === websiteId) ?? websites.data?.data[0];
  useEffect(() => { setWebsiteId(null); setOpen(null); }, [workspaceId]);
  useEffect(() => {
    const listener = (event: Event) => setOpen((event as CustomEvent<string>).detail);
    window.addEventListener('oc-help-open', listener);
    return () => window.removeEventListener('oc-help-open', listener);
  }, []);
  const help = useQuery({
    queryKey: ['help', workspaceId, current?.id],
    queryFn: () => api.getHelpCentre(workspaceId, current!.id),
    enabled: current !== undefined,
    // While Draft with AI writes, its articles appear as they come.
    refetchInterval: (query) => (draftRunning(query.state.data) ? 4000 : false),
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('helpIntro')}</p>
      {!isSupervisor && <p className="card text-sm">{t('helpSupervisorOnly')}</p>}
      <Failure error={websites.error ?? help.error} />
      {websites.data?.data.length === 0 && <p className="card text-sm">{t('noWebsitesMember')}</p>}
      {!open && (
        <div className="flex flex-wrap items-end gap-3">
          {websites.data && websites.data.data.length > 1 && current && (
            <label className="block min-w-48 text-sm">{t('assistantWebsite')}
              <select className="field" value={current.id} onChange={(event) => setWebsiteId(event.target.value)}>
                {websites.data.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
          )}
          {help.data && (
            <label className="block min-w-48 text-sm">{t('helpLanguage')}
              <select className="field" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {help.data.languages.map((l) => (
                  <option key={l} value={l}>{languageName(l)} ({help.data.articles.filter((a) => a.language === l).length})</option>
                ))}
              </select>
            </label>
          )}
          {help.data?.slug && (
            <a className="button-quiet ml-auto self-end" href={publicUrl(help.data.slug)} target="_blank" rel="noreferrer">{t('helpOpenPublic')} ↗</a>
          )}
        </div>
      )}
      {help.data && current && (
        <div key={current.id} className="space-y-6">
          {open ? (
            <Editor key={open} workspaceId={workspaceId} help={help.data} articleId={open} canEdit={isSupervisor} onClose={() => setOpen(null)} />
          ) : (
            <>
              {help.data.slug === null && tab !== 'settings' && (
                <p className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <span className="min-w-48 flex-1">{t('helpNotPublic')}</span>
                  {isSupervisor && <button type="button" className="button-quiet" onClick={() => setTab('settings')}>{t('helpChooseAddress')}</button>}
                </p>
              )}
              <div role="tablist" aria-label={t('sectionHelp')} className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
                {HELP_TABS.filter((item) => isSupervisor || item.tab === 'articles' || item.tab === 'settings').map((item) => (
                  <button
                    key={item.tab}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.tab}
                    className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium ${tab === item.tab ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300' : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}
                    onClick={() => setTab(item.tab)}
                  >
                    {t(item.label)}
                  </button>
                ))}
              </div>
              {tab === 'articles' && <ArticlesCard workspaceId={workspaceId} help={help.data} language={language} canEdit={isSupervisor} onOpen={setOpen} />}
              {tab === 'articles' && isSupervisor && help.data.drafting.available && <DraftCard key={language} workspaceId={workspaceId} help={help.data} language={language} />}
              {tab === 'collections' && isSupervisor && <CollectionsCard key={language} workspaceId={workspaceId} help={help.data} language={language} />}
              {tab === 'images' && isSupervisor && <ImagesCard workspaceId={workspaceId} help={help.data} onInsert={null} />}
              {tab === 'settings' && <AddressCard workspaceId={workspaceId} help={help.data} canEdit={isSupervisor} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
