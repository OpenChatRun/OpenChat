/** The chat bundle: loaded by the loader, which hands itself over on the script element that loaded this. */
import { render } from 'preact';
import { createApi, type Session } from './api';
import { App } from './app';
import { createController } from './controller';
import { addStyles, applyColor, colorKey, type HandoffScript } from './handoff';
import { pageLanguages } from './locale';
import { createStorage } from './storage';
import { createChallenge } from './turnstile';
import { cleanAttributes } from './attributes';
import { CHAT_CSS } from './styles';

const handoff = (document.currentScript as HandoffScript | null)?.openchat;

if (handoff) {
  const storage = createStorage(handoff.websiteKey, handoff.consentPending);
  // Kept out of Preact's tree, because Turnstile writes inside it. The panel gives it a place on the screen.
  const challengeHost = document.createElement('div');
  const challenge = createChallenge(challengeHost, handoff.nonce);
  const api = createApi({
    solveChallenge: () => challenge.solve(),
    apiUrl: handoff.apiUrl,
    websiteKey: handoff.websiteKey,
    loadSession: () => storage.get().session ?? null,
    saveSession: (session: Session) => storage.set({ session }),
  });
  let consented = !handoff.consentPending;
  const controller = createController({
    api,
    storage,
    openSocket: (url) => new WebSocket(url) as never,
    isVisible: () => document.visibilityState === 'visible',
    // Nothing about the page before consent. The query and fragment never leave the browser.
    currentPage: () => (consented ? `${location.origin}${location.pathname}` : null),
  });
  // A single-page site changes its address without loading anything, and has no one event for it.
  for (const event of ['popstate', 'hashchange']) window.addEventListener(event, () => controller.pageMaybeChanged());
  setInterval(() => {
    if (document.visibilityState === 'visible') controller.pageMaybeChanged();
  }, 3000);

  addStyles(handoff.shadow, CHAT_CSS);
  const root = document.createElement('div');
  handoff.shadow.appendChild(root);

  controller.setAttributes(cleanAttributes(handoff.attributes));
  handoff.chat = {
    setOpen: (open) => controller.setOpen(open),
    setAttributes: (attributes) => controller.setAttributes(cleanAttributes(attributes)),
    grantConsent: () => {
      storage.grantConsent();
      consented = true;
      controller.pageMaybeChanged();
    },
  };
  handoff.button.addEventListener('click', () => controller.setOpen(!controller.getState().open));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') controller.onVisible();
  });

  render(<App controller={controller} button={handoff.button} challengeHost={challengeHost} pageLocale={handoff.locale} pageLanguages={pageLanguages()} />, root);
  if (handoff.openOnStart) controller.setOpen(true);

  let color: string | undefined;
  controller.subscribe(() => {
    challenge.setSiteKey(controller.getState().turnstileSiteKey ?? undefined);
    const next = controller.getState().settings?.primaryColor;
    if (!next || next === color) return;
    color = next;
    applyColor(handoff.host, next);
    storage.remember(colorKey(handoff.websiteKey), next);
  });

  void controller.start().then((allowed) => {
    if (allowed) return;
    controller.stop();
    handoff.host.remove();
    // The site's developer needs to know why the widget went away.
    console.warn('OpenChat: this page is not allowed to use this website key. Check the allowed origins.');
  });
}
