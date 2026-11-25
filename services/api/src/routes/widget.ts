import {
  downloadVisitorAttachmentRoute,
  uploadVisitorAttachmentRoute,
  createVisitorConversationRoute,
  createVisitorSessionRoute,
  createVisitorTicketRoute,
  listVisitorConversationsRoute,
  listVisitorMessagesRoute,
  markVisitorConversationReadRoute,
  setVisitorPageRoute,
  rateVisitorConversationRoute,
  sendVisitorMessageRoute,
  updateVisitorProfileRoute,
  widgetBootstrapRoute,
  widgetHelpArticleRoute,
  widgetHelpFeedbackRoute,
  widgetHelpRoute,
  OpeningHoursSchema,
} from '@openchat/api-contracts';
import {
  beginVisitorUpload,
  visitorAttachment,
  assertVisitorOrigin,
  authenticateVisitor,
  createVisitorConversation,
  createVisitorSession,
  createVisitorTicket,
  listVisitorConversations,
  listVisitorMessages,
  markVisitorConversationRead,
  sendVisitorMessage,
  updateVisitorProfile,
  enforce,
  limitKeyForIp,
  publishedHelpLanguages,
  acceptHelpFeedback,
  countHelpFeedback,
  countHelpView,
  helpReaderIsPerson,
  websiteForWidget,
  setVisitorPage,
  rateVisitorConversation,
  availableMembers,
  widgetHelp,
  widgetHelpArticle,
  type VisitorContext,
} from '@openchat/core';
import { AppError, notFound, openingState, readAbuseLimits, toIso } from '@openchat/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { hubName } from '@openchat/realtime';
import { authDeps, limiterFor, publicDatabase, type App, type AppEnv } from '../context';
import { HELP_PAGE_LIMIT } from './help-public';
import { receiveUpload, sendFile } from '../attachments';
import { dispatchSoon, publishRead, socketUrl } from '../dispatch';

type WidgetEnv = { Bindings: AppEnv['Bindings']; Variables: AppEnv['Variables'] & { visitor: VisitorContext } };

const clientIp = (c: Context<AppEnv>) => c.req.header('cf-connecting-ip') ?? 'unknown';

/**
 * Bearer tokens only and no cookies, so a cross-origin read carries no ambient authority, and the header can
 * name the caller. Refusing an origin the website does not allow happens on the server, in each route.
 */
const cors: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('origin');
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...(origin ? { 'access-control-allow-origin': origin } : {}),
        'access-control-allow-methods': 'GET, POST, PATCH',
        'access-control-allow-headers': 'authorization, content-type, x-request-id',
        'access-control-max-age': '600',
        vary: 'Origin',
      },
    });
  }
  await next();
  if (origin) {
    c.header('access-control-allow-origin', origin);
    c.header('access-control-expose-headers', 'retry-after, x-request-id');
  }
  c.header('vary', 'Origin');
};

const requireVisitor: MiddlewareHandler<WidgetEnv> = async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) throw new AppError(401, 'unauthorized', 'Start a new visitor session');
  const visitor = await authenticateVisitor(await authDeps(c.env), token);
  assertVisitorOrigin(visitor, c.req.header('origin'));
  c.set('visitor', visitor);
  await next();
};

const BOOTSTRAP_TTL_SECONDS = 30;

interface CachedBootstrap {
  found: boolean;
  websiteId?: string;
  settings?: Record<string, unknown>;
  allowedOrigins?: string[];
  availability?: 'online' | 'offline';
  /** When a website with opening hours, closed now, next opens. */
  opensAt?: string;
  /** Languages with published help articles: the Help tab shows if there are any. */
  helpLanguages?: string[];
}

/**
 * Cached with the rest, so that page views on a busy site do not wake the hub. Opening hours come first: a closed
 * website is away whoever is connected, and says when it opens, unless it is set to be away always.
 */
async function availabilityOf(c: Context<AppEnv>, workspaceId: string, settings: Record<string, unknown>): Promise<{ availability: 'online' | 'offline'; opensAt?: string }> {
  const mode = settings.availabilityMode;
  if (mode === 'offline') return { availability: 'offline' };
  const hours = OpeningHoursSchema.safeParse(settings.openingHours);
  const { open, opensAt } = openingState(hours.success ? hours.data : null, Date.now());
  if (!open) return { availability: 'offline', ...(opensAt === null ? {} : { opensAt: toIso(opensAt) }) };
  if (mode === 'online') return { availability: 'online' };
  const hub = c.env.WORKSPACE_HUB.getByName(hubName(workspaceId));
  // A member who set themselves away does not count. A hub from before a deploy cannot say who is connected for
  // a while, and then anyone connected counts, as before.
  const members = await hub.principalIds().catch(() => null);
  if (members) return { availability: (await availableMembers(publicDatabase(c.env), workspaceId, members)) > 0 ? 'online' : 'offline' };
  const agents = await hub.connectionCount().catch(() => 0);
  return { availability: agents > 0 ? 'online' : 'offline' };
}

/** Keeps busy pages off D1. A key that does not exist is cached too, so that guessing cannot reach D1 either. */
async function loadBootstrap(c: Context<AppEnv>, websiteKey: string): Promise<CachedBootstrap> {
  const cache = caches.default;
  const key = new Request(`https://widget-bootstrap.invalid/${encodeURIComponent(websiteKey)}`);
  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as CachedBootstrap;
  const website = await websiteForWidget(await authDeps(c.env), websiteKey);
  const value: CachedBootstrap = website
    ? {
        found: true,
        ...(await availabilityOf(c, website.workspaceId, website.settings)),
        websiteId: website.id,
        settings: website.settings,
        allowedOrigins: website.allowedOrigins,
        helpLanguages: await publishedHelpLanguages(publicDatabase(c.env), website.id),
      }
    : { found: false };
  await cache.put(key, new Response(JSON.stringify(value), { headers: { 'cache-control': `public, max-age=${BOOTSTRAP_TTL_SECONDS}` } }));
  return value;
}

/**
 * The Help tab's list and articles, cached as the bootstrap is: keyed by website key, so a change shows within the
 * same 30 seconds as the tab itself. Searches are not cached.
 */
async function cachedHelp<T>(name: string, produce: () => Promise<T | null>): Promise<T | null> {
  const cache = caches.default;
  const key = new Request(`https://widget-help.invalid/${name}`);
  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as T | null;
  const value = await produce();
  await cache.put(key, new Response(JSON.stringify(value), { headers: { 'cache-control': `public, max-age=${BOOTSTRAP_TTL_SECONDS}` } }));
  return value;
}

export function registerWidgetRoutes(app: App) {
  app.use('/api/v1/widget/*', cors);
  // The wildcard also matches /conversations itself, so naming that as well would run all this twice.
  for (const path of [updateVisitorProfileRoute.path, '/api/v1/widget/conversations/*', '/api/v1/widget/attachments/*']) {
    app.use(path, requireVisitor as unknown as MiddlewareHandler<AppEnv>);
  }
  const visitorOf = (c: Context<AppEnv>) => (c as unknown as Context<WidgetEnv>).get('visitor');

  app.openapi(widgetBootstrapRoute, async (c) => {
    const bootstrap = await loadBootstrap(c, c.req.valid('query').websiteKey);
    if (!bootstrap.found) throw notFound();
    const origin = c.req.header('origin');
    if (origin !== undefined && !bootstrap.allowedOrigins!.includes(origin)) throw new AppError(403, 'bad_origin', 'This website does not allow requests from this origin');
    return c.json({ websiteId: bootstrap.websiteId!, settings: bootstrap.settings!, availability: bootstrap.availability ?? 'offline', ...(bootstrap.opensAt ? { opensAt: bootstrap.opensAt } : {}), reportPage: c.env.VISITOR_PAGE !== 'off', messageMaxChars: readAbuseLimits(c.env).messageMaxChars, helpLanguages: bootstrap.helpLanguages ?? [], ...(bootstrap.settings!.requireTurnstile === true && c.env.TURNSTILE_SITE_KEY ? { turnstileSiteKey: c.env.TURNSTILE_SITE_KEY } : {}) }, 200);
  });

  /** The Help tab reads with no session, so it is limited per address, as the public help centre is. */
  const helpWebsite = async (c: Context<AppEnv>, websiteKey: string) => {
    await enforce(limiterFor(c.env), await limitKeyForIp({ limits: readAbuseLimits(c.env) }, 'help-page-ip', clientIp(c)), HELP_PAGE_LIMIT);
    const bootstrap = await loadBootstrap(c, websiteKey);
    if (!bootstrap.found) throw notFound();
    const origin = c.req.header('origin');
    if (origin !== undefined && !bootstrap.allowedOrigins!.includes(origin)) throw new AppError(403, 'bad_origin', 'This website does not allow requests from this origin');
    return bootstrap.websiteId!;
  };

  app.openapi(widgetHelpRoute, async (c) => {
    const { websiteKey, language, q } = c.req.valid('query');
    const websiteId = await helpWebsite(c, websiteKey);
    const read = () => widgetHelp(publicDatabase(c.env), websiteId, { language, q });
    return c.json(q?.trim() ? await read() : (await cachedHelp(`${encodeURIComponent(websiteKey)}/list/${encodeURIComponent(language ?? '')}`, read))!, 200);
  });

  app.openapi(widgetHelpArticleRoute, async (c) => {
    const websiteId = await helpWebsite(c, c.req.valid('query').websiteKey);
    const { articleId } = c.req.valid('param');
    const article = await cachedHelp(`${encodeURIComponent(c.req.valid('query').websiteKey)}/article/${encodeURIComponent(articleId)}`, () =>
      widgetHelpArticle(publicDatabase(c.env), websiteId, articleId, new URL(c.req.url).origin),
    );
    if (!article) throw notFound();
    // Counted whether or not the article came from the cache. Never delays or fails the answer.
    if (helpReaderIsPerson(c.req.header('user-agent'))) c.executionCtx.waitUntil(countHelpView(publicDatabase(c.env), websiteId, { id: articleId }));
    return c.json(article, 200);
  });

  /** "Was this helpful?" under an article in the widget. Thanked whether or not it was counted. */
  app.openapi(widgetHelpFeedbackRoute, async (c) => {
    const { websiteKey, helpful } = c.req.valid('json');
    const websiteId = await helpWebsite(c, websiteKey);
    const article = { id: c.req.valid('param').articleId };
    if (await acceptHelpFeedback({ limiter: limiterFor(c.env), limits: readAbuseLimits(c.env) }, clientIp(c), websiteId, article)) {
      if (!(await countHelpFeedback(publicDatabase(c.env), websiteId, article, helpful))) throw notFound();
    }
    return c.body(null, 204);
  });

  app.openapi(createVisitorSessionRoute, async (c) => {
    const body = c.req.valid('json');
    return c.json(await createVisitorSession(await authDeps(c.env), { ...body, origin: c.req.header('origin'), ip: clientIp(c) }), 200);
  });

  app.openapi(updateVisitorProfileRoute, async (c) => {
    await updateVisitorProfile(await authDeps(c.env), visitorOf(c), c.req.valid('json'));
    return c.body(null, 204);
  });

  app.openapi(listVisitorConversationsRoute, async (c) => c.json(await listVisitorConversations(await authDeps(c.env), visitorOf(c)), 200));

  app.openapi(createVisitorConversationRoute, async (c) => {
    const { created, conversation, messageId } = await createVisitorConversation(await authDeps(c.env), visitorOf(c), c.req.valid('json'), clientIp(c));
    dispatchSoon(c, visitorOf(c).workspaceId, [conversation.id, messageId]);
    return created ? c.json(conversation, 201) : c.json(conversation, 200);
  });

  app.openapi(listVisitorMessagesRoute, async (c) => c.json(await listVisitorMessages(await authDeps(c.env), visitorOf(c), c.req.valid('param').conversationId, c.req.valid('query')), 200));

  app.openapi(sendVisitorMessageRoute, async (c) => {
    const { created, message } = await sendVisitorMessage(await authDeps(c.env), visitorOf(c), c.req.valid('param').conversationId, c.req.valid('json'), clientIp(c));
    dispatchSoon(c, visitorOf(c).workspaceId, [message.id, message.conversationId]);
    return created ? c.json(message, 201) : c.json(message, 200);
  });

  app.openapi(createVisitorTicketRoute, async (c) => {
    const { ticket, expiresAt } = await createVisitorTicket(await authDeps(c.env), visitorOf(c), c.req.valid('param').conversationId, c.req.header('origin'));
    return c.json({ ticket, expiresAt, url: socketUrl(c, ticket) }, 201);
  });

  app.openapi(uploadVisitorAttachmentRoute, async (c) => {
    const deps = await authDeps(c.env);
    return c.json(await receiveUpload(c, c.req.valid('param').conversationId, c.req.valid('query').filename, (input) => beginVisitorUpload(deps, visitorOf(c), input)), 201);
  });

  app.openapi(downloadVisitorAttachmentRoute, (async (c: Context<AppEnv>) => sendFile(c, await visitorAttachment(await authDeps(c.env), visitorOf(c), c.req.param('attachmentId')!))) as never);

  app.openapi(setVisitorPageRoute, async (c) => {
    // Turned off by the operator: a widget from before the change may still send, and nothing is kept.
    if (c.env.VISITOR_PAGE === 'off') return c.body(null, 204);
    await setVisitorPage(await authDeps(c.env), visitorOf(c), c.req.valid('param').conversationId, c.req.valid('json').url);
    return c.body(null, 204);
  });

  app.openapi(rateVisitorConversationRoute, async (c) => {
    await rateVisitorConversation(await authDeps(c.env), visitorOf(c), c.req.valid('param').conversationId, c.req.valid('json'));
    return c.body(null, 204);
  });

  app.openapi(markVisitorConversationReadRoute, async (c) => {
    const visitor = visitorOf(c);
    const { conversationId } = c.req.valid('param');
    const position = await markVisitorConversationRead(await authDeps(c.env), visitor, conversationId, c.req.valid('json'));
    publishRead(c, { v: 1, kind: 'conversation.read', workspaceId: visitor.workspaceId, conversationId, reader: { type: 'visitor', id: visitor.visitorId }, publicReadSeq: null, ...position });
    return c.body(null, 204);
  });
}
