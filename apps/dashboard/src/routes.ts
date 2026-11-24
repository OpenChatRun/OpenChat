import { useSyncExternalStore } from 'react';

/**
 * The dashboard's addresses, so that a refresh, a bookmark or the back button keeps the page.
 * The worker serves the dashboard for any path it does not handle itself (`not_found_handling`), so none of these may
 * start with a path the worker owns: `/api/`, `/health`, `/.well-known/`, `/help/` (the public help centre) or
 * `/help-assets/`. That is why the Help page is `/help-centre`.
 * The workspace is not in the address: it stays the one this browser remembers.
 */
export const SECTION_PATHS = {
  home: '/dashboard',
  inbox: '/inbox',
  contacts: '/contacts',
  analytics: '/analytics',
  websites: '/websites',
  members: '/members',
  email: '/email',
  assistant: '/assistant',
  help: '/help-centre',
  settings: '/settings',
} as const;
export const ADMIN_PATHS = {
  people: '/admin/people',
  workspaces: '/admin/workspaces',
  jobs: '/admin/jobs',
  audit: '/admin/audit',
} as const;

export type Section = keyof typeof SECTION_PATHS;
export type AdminPage = keyof typeof ADMIN_PATHS;
export type Route =
  | { section: Section; adminPage: null; conversationId: string | null }
  | { section: null; adminPage: AdminPage; conversationId: null };

const INBOX: Route = { section: 'inbox', adminPage: null, conversationId: null };
// Conversation IDs are a prefix and a ULID. Anything else in the address is ignored rather than sent to the API.
const CONVERSATION = /^\/inbox\/(conv_[0-9A-Za-z]{26})\/?$/;

/** An unknown address opens the inbox, as `/` does. */
export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  const conversation = CONVERSATION.exec(pathname);
  if (conversation) return { section: 'inbox', adminPage: null, conversationId: conversation[1]! };
  for (const [section, sectionPath] of Object.entries(SECTION_PATHS)) {
    if (path === sectionPath) return { section: section as Section, adminPage: null, conversationId: null };
  }
  for (const [page, pagePath] of Object.entries(ADMIN_PATHS)) {
    if (path === pagePath) return { section: null, adminPage: page as AdminPage, conversationId: null };
  }
  return INBOX;
}

export function routePath(route: Route): string {
  if (route.adminPage) return ADMIN_PATHS[route.adminPage];
  if (route.conversationId) return `${SECTION_PATHS.inbox}/${encodeURIComponent(route.conversationId)}`;
  return SECTION_PATHS[route.section];
}

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}
const currentPath = () => window.location.pathname;

/** Opens a page and adds it to the browser's history. `replace` changes the current entry instead. */
export function navigate(route: Route, { replace = false } = {}) {
  const path = routePath(route);
  if (path === window.location.pathname) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  for (const listener of listeners) listener();
}

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, currentPath));
}
