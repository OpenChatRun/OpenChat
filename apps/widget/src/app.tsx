/**
 * The panel. Message content is only ever a text node. The one HTML set here is a help article's body, which the
 * server rendered from an allow-list when it was saved, escaping everything else (ADR-0023, help-text.ts).
 */
import { createContext } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { HelpArticle, HelpList } from './api';
import type { ChatState, Controller } from './controller';
import { hasOlder, unreadCount, type ChatMessage } from './state';
import { pickLocale, visitorLanguage, type Locale } from './locale';
import { awayText, formatSize, TRANSLATIONS, type Strings } from './strings';

/** The language every part of the panel speaks, chosen once in App. */
const Language = createContext<{ locale: Locale; S: Strings }>({ locale: 'en', S: TRANSLATIONS.en });

function useChat(controller: Controller): ChatState {
  const [state, setState] = useState(controller.getState());
  useEffect(() => {
    setState(controller.getState());
    return controller.subscribe(() => setState(controller.getState()));
  }, [controller]);
  return state;
}

const PREVIEW_LIMIT_BYTES = 5 * 1024 * 1024;

/**
 * A page's CSP may refuse a blob: picture. Then the picture goes away and the download stays. The link is put in
 * the panel, so that the host page's listeners do not see the click.
 */
function Attachment({ file, controller }: { file: ChatMessage['attachments'][number]; controller: Controller }) {
  const { locale, S } = useContext(Language);
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const self = useRef<HTMLDivElement>(null);
  const previewable = file.contentType.startsWith('image/') && file.size <= PREVIEW_LIMIT_BYTES;
  useEffect(() => {
    if (!previewable) return undefined;
    let url: string | null = null;
    let gone = false;
    controller
      .fetchAttachment(file.url)
      .then((blob) => {
        if (gone) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [controller, file.url, previewable]);
  const download = () => {
    setFailed(false);
    controller
      .fetchAttachment(file.url)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.filename;
        self.current?.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      })
      .catch(() => setFailed(true));
  };
  return (
    <div class="oc-file" ref={self}>
      {preview && <img class="oc-image" src={preview} alt={file.filename} onError={() => setPreview(null)} />}
      <button type="button" class="oc-link" onClick={download}>{S.download(file.filename, formatSize(file.size, locale, S))}</button>
      {failed && <span class="oc-state bad" role="alert"> {S.downloadFailed}</span>}
    </div>
  );
}

const kindOf = (message: ChatMessage) => (message.system ? 'system' : message.mine ? 'mine' : 'theirs');

/** `first` starts a run of messages from one sender, which shows who sent them. */
function Message({ message, first, state, onRetry, controller }: { message: ChatMessage; first: boolean; state: string | null; onRetry: () => void; controller: Controller }) {
  const { S } = useContext(Language);
  const kind = kindOf(message);
  const who = message.senderName ?? S.team;
  const [shownOriginal, setShownOriginal] = useState(false);
  return (
    <div class={`oc-msg ${kind} ${message.status}${first ? ' first' : ''}`}>
      {kind === 'theirs' && first && (
        <>
          <span class="oc-ava" aria-hidden="true">{Array.from(who.trim())[0] ?? ''}</span>
          <p class="oc-who">
            {who}
            {message.assistant && (
              <span class="oc-ai" title={S.aiTitle}>
                <span aria-hidden="true">{S.ai}</span>
                <span class="oc-sr">{S.aiTitle}</span>
              </span>
            )}
          </p>
        </>
      )}
      {message.content && <div class="oc-bubble" dir="auto" lang={shownOriginal && message.original ? message.original.language : undefined}>{message.assistant === 'handover' ? S.handover : shownOriginal && message.original ? message.original.content : message.content}</div>}
      {message.original && (
        <span class="oc-state">
          {S.translated} · <button type="button" class="oc-link" onClick={() => setShownOriginal(!shownOriginal)}>{shownOriginal ? S.showTranslation : S.showOriginal}</button>
        </span>
      )}
      {message.pendingFile && <div class="oc-file oc-state" dir="auto">{message.pendingFile}</div>}
      {message.attachments.map((file) => <Attachment key={file.id} file={file} controller={controller} />)}
      {message.status === 'failed' ? (
        <span class="oc-state bad">
          {S.failed} <button type="button" class="oc-link" onClick={onRetry}>{S.retry}</button>
        </span>
      ) : (
        state && <span class="oc-state">{state}</span>
      )}
    </div>
  );
}

/** Asked once a conversation is resolved. A thumb saves at once; a comment is a second, optional step. */
function Rating({ controller, rating }: { controller: Controller; rating: 'good' | 'bad' | null }) {
  const { S } = useContext(Language);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = (value: 'good' | 'bad', text?: string) => {
    setBusy(true);
    setFailed(false);
    return controller
      .rate(value, text)
      .then(() => true)
      .catch(() => {
        setFailed(true);
        return false;
      })
      .finally(() => setBusy(false));
  };
  return (
    <form
      class="oc-form oc-rate"
      onSubmit={(event) => {
        event.preventDefault();
        if (rating && comment.trim()) void save(rating, comment.trim()).then((ok) => setSent(ok));
      }}
    >
      <p id="oc-rate-q">{S.rateQuestion}</p>
      <div class="oc-thumbs" role="group" aria-labelledby="oc-rate-q">
        {(['good', 'bad'] as const).map((value) => (
          <button key={value} type="button" class="oc-thumb" aria-pressed={rating === value} disabled={busy} onClick={() => void save(value, sent ? comment.trim() : undefined)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style={value === 'bad' ? 'transform:rotate(180deg)' : undefined}>
              <path d="M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7" />
            </svg>
            {value === 'good' ? S.rateGood : S.rateBad}
          </button>
        ))}
      </div>
      {rating && !sent && (
        <>
          <label>
            {S.rateComment}
            <textarea class="oc-input" rows={2} maxLength={500} value={comment} onInput={(e) => setComment(e.currentTarget.value)} />
          </label>
          <div class="oc-actions">
            <button class="oc-send" disabled={busy || !comment.trim()}>{S.send}</button>
          </div>
        </>
      )}
      {failed ? <span class="oc-state bad" role="alert">{S.profileFailed}</span> : rating && <span class="oc-state" role="status">{S.rateThanks}</span>}
    </form>
  );
}

function ProfileForm({ controller, required }: { controller: Controller; required: boolean }) {
  const { S } = useContext(Language);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <form
      class="oc-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setFailed(false);
        controller
          .saveProfile({ ...(name.trim() ? { name: name.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), followUpConsent: consent })
          .catch(() => setFailed(true))
          .finally(() => setBusy(false));
      }}
    >
      <p>{required ? S.profileTitleRequired : S.profileTitleOffered}</p>
      <label>
        {S.name}
        <input class="oc-input" autocomplete="name" maxLength={100} value={name} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        {S.email}
        <input class="oc-input" type="email" autocomplete="email" required maxLength={254} value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
      </label>
      <label class="oc-check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.currentTarget.checked)} />
        <span>{S.followUpConsent}</span>
      </label>
      {failed && <span class="oc-state bad" role="alert">{S.profileFailed}</span>}
      <div class="oc-actions">
        <button class="oc-send" disabled={busy}>{required ? S.start : S.save}</button>
        {!required && <button type="button" class="oc-link" onClick={() => controller.dismissProfile()}>{S.notNow}</button>}
      </div>
    </form>
  );
}

function Composer({ controller, canAttach, maxChars }: { controller: Controller; canAttach: boolean; maxChars: number }) {
  const { S } = useContext(Language);
  const [text, setText] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const submit = () => {
    if (!text.trim()) return;
    void controller.send(text);
    setText('');
  };
  return (
    <form
      class="oc-compose"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        class="oc-input"
        rows={1}
        aria-label={S.compose}
        placeholder={S.placeholder}
        maxLength={maxChars}
        value={text}
        onInput={(event) => {
          setText(event.currentTarget.value);
          controller.typed();
        }}
        onKeyDown={(event) => {
          // Not while an input method is composing, where Enter chooses a word.
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {canAttach && (
        <>
          <button type="button" class="oc-attach" aria-label={S.attach} onClick={() => picker.current?.click()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 6v11.5a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6H9v9.5a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v12.5a6 6 0 0 0 12 0V6z" /></svg>
          </button>
          <input
            ref={picker}
            type="file"
            hidden
            aria-label={S.fileToAttach}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void controller.sendFile(file);
              event.currentTarget.value = '';
            }}
          />
        </>
      )}
      <button class="oc-send" aria-label={S.send} disabled={!text.trim()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
      </button>
    </form>
  );
}

/** The Help tab: published articles of this website, searchable, read inside the panel. */
function HelpView({ controller, language }: { controller: Controller; language: string }) {
  const { S } = useContext(Language);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [list, setList] = useState<HelpList | null>(null);
  const [article, setArticle] = useState<HelpArticle | null>(null);
  const [failed, setFailed] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let gone = false;
    setFailed(false);
    controller
      .help(language, searched)
      .then((result) => !gone && setList(result))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [controller, language, searched]);
  useEffect(() => {
    if (article) body.current?.focus();
  }, [article]);
  const open = (id: string) => {
    setFailed(false);
    controller
      .helpArticle(id)
      .then(setArticle)
      .catch(() => setFailed(true));
  };

  if (article) {
    return (
      <div class="oc-help">
        <button type="button" class="oc-link oc-back" onClick={() => setArticle(null)}>← {S.helpBack}</button>
        <article lang={article.language} tabIndex={-1} ref={body} class="oc-article">
          <h3>{article.title}</h3>
          <div dangerouslySetInnerHTML={{ __html: article.bodyHtml }} />
        </article>
        {article.url && <a class="oc-link oc-small" href={article.url} target="_blank" rel="noopener">{S.helpOpen}</a>}
        <div class="oc-still">
          <p>{S.helpStill}</p>
          <button type="button" class="oc-send" onClick={() => controller.needHelp(article.id)}>{S.helpChat}</button>
        </div>
      </div>
    );
  }
  const groups = list ? [...list.collections.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: '' }] : [];
  return (
    <div class="oc-help">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearched(query.trim());
        }}
      >
        <input class="oc-input" type="search" aria-label={S.helpSearch} placeholder={S.helpSearch} maxLength={200} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </form>
      {failed && <p class="oc-state bad" role="alert">{S.helpFailed}</p>}
      {list && list.articles.length === 0 && <p class="oc-state" role="status">{searched ? S.helpNoResults : S.helpEmpty}</p>}
      {list &&
        groups.map((group) => {
          const articles = list.articles.filter((a) => (searched ? group.id === null : a.collectionId === group.id || (group.id === null && !list.collections.some((c) => c.id === a.collectionId))));
          if (articles.length === 0) return null;
          return (
            <section key={group.id ?? ''} aria-label={group.name || undefined}>
              {group.name && <h3 class="oc-group">{group.name}</h3>}
              <ul class="oc-articles" lang={list.language ?? undefined}>
                {articles.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => open(a.id)}>
                      <strong>{a.title}</strong>
                      {a.summary && <span>{a.summary}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      <div class="oc-still">
        <p>{S.helpStill}</p>
        <button type="button" class="oc-send" onClick={() => controller.setView('chat')}>{S.helpChat}</button>
      </div>
    </div>
  );
}

/**
 * `pageLocale` is what the host page asked for, and wins. Then the website's setting, then the page's and the
 * browser's languages. See docs/architecture/widget.md#languages.
 */
export function App({
  controller,
  button,
  challengeHost,
  pageLocale,
  pageLanguages,
}: {
  controller: Controller;
  button: HTMLButtonElement;
  challengeHost: HTMLElement;
  pageLocale?: string | undefined;
  pageLanguages: readonly string[];
}) {
  const state = useChat(controller);
  const chosen = state.settings?.language;
  const language = useMemo(() => {
    const candidates = [pageLocale, chosen === 'auto' ? undefined : chosen, ...pageLanguages];
    const locale = pickLocale(candidates);
    controller.setLanguage(visitorLanguage(candidates));
    return { locale, S: TRANSLATIONS[locale] };
  }, [controller, pageLocale, chosen, pageLanguages]);
  const { locale, S } = language;
  const panel = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const unread = state.open ? 0 : unreadCount(state.messages, state.readSeq);

  // The button belongs to the loader, so that it never redraws and never loses focus.
  useEffect(() => {
    button.setAttribute('aria-expanded', String(state.open));
    button.setAttribute('aria-label', state.open ? S.close : unread > 0 ? S.unread(unread) : S.open);
    button.lang = locale;
    const badge = button.querySelector<HTMLElement>('.oc-badge');
    if (badge) {
      badge.hidden = unread === 0;
      badge.textContent = unread > 9 ? '9+' : String(unread);
    }
  }, [button, state.open, unread, S, locale]);

  useEffect(() => {
    if (state.open) panel.current?.querySelector<HTMLElement>('input, textarea')?.focus();
  }, [state.open]);

  useLayoutEffect(() => {
    const element = log.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
    // The rating form takes room from the messages when it appears, and again when it asks for a comment.
  }, [state.messages, state.open, state.typing, state.conversation?.status, state.rating]);

  if (state.phase === 'hidden') return null;

  const mine = state.messages.filter((m) => m.mine && m.seq !== null);
  const newestMine = mine[mine.length - 1];
  const stateOf = (message: ChatMessage) => {
    if (message.status === 'sending') return S.sending;
    if (message !== newestMine) return null;
    return message.seq! <= state.agentReadSeq ? S.seen : S.sent;
  };
  const presence = state.connection === 'reconnecting' || state.connection === 'polling' ? S.reconnecting : state.availability === 'online' ? S.online : state.availability === 'offline' ? awayText(state.opensAt, locale, S) : '';
  const welcome = state.settings?.welcomeMessage;
  const hasHelp = state.helpLanguages.length > 0;
  const view = !hasHelp ? 'chat' : (state.view ?? (state.conversation || state.messages.length > 0 ? 'chat' : 'help'));

  return (
    <Language.Provider value={language}>
    <div
      ref={panel}
      lang={locale}
      class="oc-panel"
      role="dialog"
      aria-label={S.title}
      hidden={!state.open}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          controller.setOpen(false);
          button.focus();
        }
      }}
    >
      <header class="oc-head">
        <span class={presence === S.online ? 'oc-face on' : 'oc-face'} aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3C6.9 3 3 6.5 3 10.9c0 2.3 1.1 4.4 2.9 5.9L5 21l4.6-2.3c.8.2 1.6.3 2.4.3 5.1 0 9-3.5 9-8.1S17.1 3 12 3z" /></svg>
        </span>
        <div>
          <h2>{S.title}</h2>
          <p role="status">{presence}</p>
        </div>
        <button
          type="button"
          class="oc-x"
          aria-label={S.close}
          onClick={() => {
            controller.setOpen(false);
            button.focus();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.2l3.9-3.9a1 1 0 1 1 1.4 1.4l-4.6 4.6a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4z" /></svg>
        </button>
      </header>
      {hasHelp && (
        <div class="oc-tabs" role="tablist">
          {(['chat', 'help'] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={view === tab} class={view === tab ? 'on' : ''} onClick={() => controller.setView(tab)}>
              {tab === 'chat' ? S.chatTab : S.helpTab}
            </button>
          ))}
        </div>
      )}
      {view === 'help' ? (
        <HelpView controller={controller} language={locale} />
      ) : (
      <>
      <div
        ref={log}
        class="oc-log"
        role="log"
        aria-label={S.messages}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {hasOlder(state.messages) && (
          <div class="oc-older">
            <button type="button" class="oc-link" disabled={state.loadingOlder} onClick={() => void controller.loadOlder().catch(() => undefined)}>{S.earlier}</button>
          </div>
        )}
        {welcome && (
          <div class="oc-msg theirs first">
            <span class="oc-ava" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3C6.9 3 3 6.5 3 10.9c0 2.3 1.1 4.4 2.9 5.9L5 21l4.6-2.3c.8.2 1.6.3 2.4.3 5.1 0 9-3.5 9-8.1S17.1 3 12 3z" /></svg>
            </span>
            <div class="oc-bubble" dir="auto">{welcome}</div>
          </div>
        )}
        {state.messages.map((message, index) => {
          const before = state.messages[index - 1];
          // Each of the assistant's messages carries its own AI label, not only the first in a run.
          const first = !before || kindOf(before) !== kindOf(message) || before.senderName !== message.senderName || message.assistant !== null;
          return <Message key={message.key} message={message} first={first} state={stateOf(message)} onRetry={() => void controller.retry(message.key)} controller={controller} />;
        })}
      </div>
      <div class="oc-challenge" ref={(element) => { if (element && challengeHost.parentElement !== element) element.appendChild(challengeHost); }} />
      <div class="oc-typing" aria-live="polite">{state.typing ? S.typing(state.typing.displayName) : ''}</div>
      {state.notice && <p class="oc-note bad" role="alert">{state.notice === 'rate_limited' ? S.rateLimited : state.notice === 'daily_limit' ? S.dailyLimit : state.notice === 'bad_file' ? S.badFile : state.notice === 'challenge' ? S.challengeFailed : S.unavailable}</p>}
      {state.conversation?.status === 'resolved' && <p class="oc-note">{S.resolved}</p>}
      {state.conversation?.status === 'resolved' && state.settings?.askForRating !== false && <Rating key={state.conversation.id} controller={controller} rating={state.rating} />}
      {state.profile === 'offered' && state.messages.some((m) => m.mine) && <ProfileForm controller={controller} required={false} />}
      {state.profile === 'required' ? <ProfileForm controller={controller} required /> : <Composer controller={controller} maxChars={state.messageMaxChars} canAttach={state.conversation !== null} />}
      </>
      )}
    </div>
    </Language.Provider>
  );
}
