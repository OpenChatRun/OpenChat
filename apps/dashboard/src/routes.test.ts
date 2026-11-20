import { describe, expect, it } from 'vitest';
import { ADMIN_PATHS, parseRoute, routePath, SECTION_PATHS, type Route } from './routes';

const conv = 'conv_01JD8Z3Q4R5S6T7V8W9X0Y1Z2A';

describe('dashboard addresses', () => {
  it('reads back every address it makes', () => {
    const routes: Route[] = [
      ...Object.keys(SECTION_PATHS).map((section) => ({ section, adminPage: null, conversationId: null }) as Route),
      ...Object.keys(ADMIN_PATHS).map((adminPage) => ({ section: null, adminPage, conversationId: null }) as Route),
      { section: 'inbox', adminPage: null, conversationId: conv },
    ];
    for (const route of routes) expect(parseRoute(routePath(route))).toEqual(route);
  });

  it('opens the inbox for the root, an unknown address or a malformed conversation', () => {
    for (const path of ['/', '/nope', '/admin', '/inbox/conv_short', '/inbox/../api/v1/me', `/inbox/${conv}/extra`]) {
      expect(parseRoute(path)).toEqual({ section: 'inbox', adminPage: null, conversationId: null });
    }
  });

  it('accepts a trailing slash', () => {
    expect(parseRoute('/websites/')).toEqual({ section: 'websites', adminPage: null, conversationId: null });
    expect(parseRoute(`/inbox/${conv}/`).conversationId).toBe(conv);
  });

  it('never uses a path the worker serves itself', () => {
    const workerOwned = /^\/(api\/|health(\/|$)|\.well-known\/|__scheduled|help\/|help-assets\/)/;
    for (const path of [...Object.values(SECTION_PATHS), ...Object.values(ADMIN_PATHS), `/inbox/${conv}`]) {
      expect(path).not.toMatch(workerOwned);
      expect(`${path}/`).not.toMatch(workerOwned);
    }
  });
});
