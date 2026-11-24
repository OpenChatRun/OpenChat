/**
 * Typed client for the dashboard and mobile app. Response types are derived from the route definitions,
 * so changing a contract without updating a caller fails to compile. Contracts are imported as types
 * only, which keeps Zod out of client bundles.
 */
import type {
  createAgentTicketRoute,
  createTagRoute,
  getContactRoute,
  updateContactRoute,
  exportContactRoute,
  createWebsiteRoute,
  createWorkspaceRoute,
  getDiscoveryRoute,
  getHealthRoute,
  getConversationRoute,
  getInboxSummaryRoute,
  getMeRoute,
  listConversationsRoute,
  listContactsRoute,
  getAnalyticsRoute,
  listMembersRoute,
  listMessagesRoute,
  listWebsitesRoute,
  createPushGrantRoute,
  listPushSubscriptionsRoute,
  listEmailSuppressionsRoute,
  listFollowUpRulesRoute,
  listSavedRepliesRoute,
  recordPushSubscriptionRoute,
  getNotificationPreferencesRoute,
  loginRoute,
  sendMessageRoute,
  AttachmentSchema,
  updateConversationRoute,
  assignPersonRoute,
  createPersonRoute,
  listAdminWorkspacesRoute,
  getRelayStatusRoute,
  listFailedJobsRoute,
  getRetentionRoute,
  listAuditLogRoute,
  listPeopleRoute,
  updateWebsiteRoute,
  updateWorkspaceRoute,
  getAssistantRoute,
  getTranslationSettingsRoute,
  translateMessageRoute,
  addAssistantSourceRoute,
  testAssistantRoute,
  listLearnedAnswersRoute,
  listUnansweredQuestionsRoute,
  getHelpCentreRoute,
  getHelpArticleRoute,
  createHelpDraftRunRoute,
  createHelpArticleRoute,
  updateHelpArticleRoute,
} from '@openchat/api-contracts';
import type { z } from 'zod';

type Schema<R, Status extends number> = R extends { responses: Record<Status, { content: { 'application/json': { schema: infer S extends z.ZodType } } }> } ? S : never;
type Json200<R> = z.output<Schema<R, 200>>;
type Json201<R> = z.output<Schema<R, 201>>;
type BodyOf<R> = R extends { request: { body: { content: { 'application/json': { schema: infer S extends z.ZodType } } } } } ? z.input<S> : never;

export type HealthResponse = Json200<typeof getHealthRoute>;
export type DiscoveryResponse = Json200<typeof getDiscoveryRoute>;
export type TokenPair = Json200<typeof loginRoute>;
export type Me = Json200<typeof getMeRoute>;
export type Workspace = Json200<typeof updateWorkspaceRoute>;
export type MemberPage = Json200<typeof listMembersRoute>;
export type Member = MemberPage['data'][number];
export type Website = Json200<typeof listWebsitesRoute>['data'][number];
export type PushGrant = Json201<typeof createPushGrantRoute>;
export type PushSubscription = Json200<typeof listPushSubscriptionsRoute>['data'][number];
export type PushSubscriptionInput = BodyOf<typeof recordPushSubscriptionRoute>;
export type SavedReply = Json200<typeof listSavedRepliesRoute>['data'][number];
export type FollowUpRule = Json200<typeof listFollowUpRulesRoute>['data'][number];
export type EmailSuppressionPage = Json200<typeof listEmailSuppressionsRoute>;
export type NotificationPreferences = Json200<typeof getNotificationPreferencesRoute>;
export type WebsiteInput = BodyOf<typeof createWebsiteRoute>;
export type WebsiteUpdate = BodyOf<typeof updateWebsiteRoute>;
export type Person = Json201<typeof createPersonRoute>;
export type PersonInput = BodyOf<typeof createPersonRoute>;
export type PersonAssignment = BodyOf<typeof assignPersonRoute>;
export type People = Json200<typeof listPeopleRoute>;
export type AdminWorkspaces = Json200<typeof listAdminWorkspacesRoute>;
export type RelayStatus = Json200<typeof getRelayStatusRoute>;
export type FailedJobPage = Json200<typeof listFailedJobsRoute>;
export type FailedJob = FailedJobPage['data'][number];
export type Retention = Json200<typeof getRetentionRoute>;
export type AuditLogPage = Json200<typeof listAuditLogRoute>;
export type AuditEntry = AuditLogPage['data'][number];
export type LoginInput = BodyOf<typeof loginRoute>;
export type Assistant = Json200<typeof getAssistantRoute>;
export type TranslationSettings = Json200<typeof getTranslationSettingsRoute>;
export type MessageTranslation = Json200<typeof translateMessageRoute>;
export type AssistantSource = Assistant['sources'][number];
export type AssistantSourceInput = BodyOf<typeof addAssistantSourceRoute>;
export type AssistantAnswer = Json200<typeof testAssistantRoute>;
export type LearnedAnswer = Json200<typeof listLearnedAnswersRoute>['data'][number];
export type UnansweredQuestion = Json200<typeof listUnansweredQuestionsRoute>['data'][number];
export type HelpCentre = Json200<typeof getHelpCentreRoute>;
export type HelpCollection = HelpCentre['collections'][number];
export type HelpArticleSummary = HelpCentre['articles'][number];
export type HelpAsset = HelpCentre['assets'][number];
export type HelpArticle = Json200<typeof getHelpArticleRoute>;
export type HelpArticleInput = BodyOf<typeof createHelpArticleRoute>;
export type HelpArticleUpdate = BodyOf<typeof updateHelpArticleRoute>;
export type HelpDraftRun = HelpCentre['drafting']['runs'][number];
export type HelpDraftInput = BodyOf<typeof createHelpDraftRunRoute>;
export type CreatedWorkspace = Json201<typeof createWorkspaceRoute>;
export type Conversation = Json200<typeof getConversationRoute>;
export type InboxSummary = Json200<typeof getInboxSummaryRoute>;
export type ConversationPage = Json200<typeof listConversationsRoute>;
export type ConversationUpdate = BodyOf<typeof updateConversationRoute>;
export type Message = Json200<typeof listMessagesRoute>['data'][number];
export type MessageInput = BodyOf<typeof sendMessageRoute>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type RealtimeTicket = Json201<typeof createAgentTicketRoute>;
export type Tag = Json201<typeof createTagRoute>;
export type Contact = Json200<typeof getContactRoute>;
export type Analytics = Json200<typeof getAnalyticsRoute>;
export type ContactPage = Json200<typeof listContactsRoute>;
export type ContactListItem = ContactPage['data'][number];
export type ContactUpdate = BodyOf<typeof updateContactRoute>;
export type ContactExport = Json200<typeof exportContactRoute>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, title: string, requestId?: string) {
    super(title);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** A browser has a Blob. React Native has only bytes that it can send. */
type FileBody = { data: Blob | Uint8Array<ArrayBuffer>; type: string };

export interface ClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Called once when a request answers 401. Return true if a new access token is now available. */
  onUnauthorized?: () => Promise<boolean>;
  fetch?: typeof globalThis.fetch;
}

/** There is deliberately no global client: one instance is bound to one installation. See ADR-0010. */
export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function send(method: string, path: string, body: unknown, file?: FileBody): Promise<Response> {
    const headers = new Headers({ accept: 'application/json' });
    const token = await options.getAccessToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (file) headers.set('content-type', file.type);
    const payload = file ? { body: file.data } : body === undefined ? {} : { body: JSON.stringify(body) };
    return doFetch(`${baseUrl}${path}`, { method, headers, ...payload });
  }

  async function checked(method: string, path: string, body?: unknown, file?: FileBody): Promise<Response> {
    let response = await send(method, path, body, file);
    if (response.status === 401 && options.onUnauthorized && (await options.onUnauthorized())) {
      response = await send(method, path, body, file);
    }
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as { code?: string; title?: string; requestId?: string } | null;
      throw new ApiError(response.status, problem?.code ?? 'unknown', problem?.title ?? 'Request failed', problem?.requestId);
    }
    return response;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await checked(method, path, body);
    if (response.status === 202 || response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const get = <T>(path: string) => request<T>('GET', path);
  const person = (id: string) => `/api/v1/admin/people/${encodeURIComponent(id)}`;
  const workspace = (id: string) => `/api/v1/workspaces/${encodeURIComponent(id)}`;
  const adminWorkspace = (id: string) => `/api/v1/admin/workspaces/${encodeURIComponent(id)}`;
  const conversation = (workspaceId: string, id: string) => `${workspace(workspaceId)}/conversations/${encodeURIComponent(id)}`;
  const query = (values: Record<string, string | number | undefined>) => {
    // By hand, because React Native's URLSearchParams has no `size`, which would silently drop the query.
    const params = Object.entries(values).flatMap(([key, value]) => (value === undefined ? [] : [`${encodeURIComponent(key)}=${encodeURIComponent(value)}`]));
    return params.length > 0 ? `?${params.join('&')}` : '';
  };

  return {
    getHealth: () => get<HealthResponse>('/health'),
    getDiscovery: () => get<DiscoveryResponse>('/.well-known/openchat.json'),

    getSetup: () => get<{ status: 'ready' | 'needed' | 'unconfigured' }>('/api/v1/setup'),
    completeSetup: (input: { setupCode: string; name: string; ownerName: string; email: string; password: string }) => request<void>('POST', '/api/v1/setup', input),
    login: (input: LoginInput) => request<TokenPair>('POST', '/api/v1/auth/login', input),
    logout: () => request<void>('POST', '/api/v1/auth/logout'),
    requestPasswordReset: (email: string) => request<void>('POST', '/api/v1/auth/password-reset/request', { email }),
    confirmPasswordReset: (token: string, password: string) => request<void>('POST', '/api/v1/auth/password-reset/confirm', { token, password }),
    getMe: () => get<Me>('/api/v1/me'),
    updateMe: (input: { language: NonNullable<Me['language']> }) => request<Me>('PATCH', '/api/v1/me', input),

    setAway: (workspaceId: string, away: boolean) => request<Member>('PATCH', `${workspace(workspaceId)}/members/me`, { away }),
    getInboxSummary: (workspaceId: string) => get<InboxSummary>(`${workspace(workspaceId)}/inbox-summary`),
    listMembers: (workspaceId: string, cursor?: string) => get<MemberPage>(`${workspace(workspaceId)}/members?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    listPeople: (input: { cursor?: string | undefined; limit?: number; q?: string } = {}) => get<People>(`/api/v1/admin/people${query(input)}`),
    createPerson: (input: PersonInput) => request<Person>('POST', '/api/v1/admin/people', input),
    updatePerson: (userId: string, input: { isInstallationAdmin: boolean }) => request<Person>('PATCH', person(userId), input),
    deactivatePerson: (userId: string) => request<Person>('POST', `${person(userId)}/deactivate`),
    reactivatePerson: (userId: string) => request<Person>('POST', `${person(userId)}/reactivate`),
    assignPerson: (userId: string, workspaceId: string, input: PersonAssignment) => request<Person>('PUT', `${person(userId)}/workspaces/${encodeURIComponent(workspaceId)}`, input),
    unassignPerson: (userId: string, workspaceId: string) => request<Person>('DELETE', `${person(userId)}/workspaces/${encodeURIComponent(workspaceId)}`),
    listAdminWorkspaces: (input: { cursor?: string; limit?: number } = {}) => get<AdminWorkspaces>(`/api/v1/admin/workspaces${query(input)}`),
    createWorkspace: (name: string) => request<CreatedWorkspace>('POST', '/api/v1/admin/workspaces', { name }),
    updateWorkspace: (workspaceId: string, input: { name: string }) => request<Workspace>('PATCH', adminWorkspace(workspaceId), input),
    listAdminWebsites: (workspaceId: string) => get<{ data: Website[] }>(`${adminWorkspace(workspaceId)}/websites`),
    createWebsite: (workspaceId: string, input: WebsiteInput) => request<Website>('POST', `${adminWorkspace(workspaceId)}/websites`, input),
    updateWebsite: (workspaceId: string, websiteId: string, input: WebsiteUpdate) => request<Website>('PATCH', `${adminWorkspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}`, input),
    getRelayStatus: () => get<RelayStatus>('/api/v1/admin/push'),
    disconnectRelay: () => request<RelayStatus>('POST', '/api/v1/admin/push/disconnect'),
    reconnectRelay: () => request<RelayStatus>('POST', '/api/v1/admin/push/reconnect'),
    listFailedJobs: (input: { cursor?: string | undefined; limit?: number } = {}) => get<FailedJobPage>(`/api/v1/admin/failed-jobs${query(input)}`),
    replayFailedJob: (id: string) => request<FailedJob>('POST', `/api/v1/admin/failed-jobs/${encodeURIComponent(id)}/replay`),
    listAuditLog: (input: { cursor?: string | undefined; limit?: number; workspaceId?: string | undefined } = {}) => get<AuditLogPage>(`/api/v1/admin/audit-log${query(input)}`),
    getRetention: (workspaceId: string) => get<Retention>(`/api/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/retention`),
    setRetention: (workspaceId: string, retentionDays: number | null) => request<Retention>('PUT', `/api/v1/admin/workspaces/${encodeURIComponent(workspaceId)}/retention`, { retentionDays }),
    dismissFailedJob: (id: string) => request<void>('DELETE', `/api/v1/admin/failed-jobs/${encodeURIComponent(id)}`),
    listWebsites: (workspaceId: string) => get<{ data: Website[] }>(`${workspace(workspaceId)}/websites`),

    listConversations: (workspaceId: string, input: { status: Conversation['status']; assignee?: string | undefined; q?: string | undefined; cursor?: string | undefined }) =>
      get<ConversationPage>(`${workspace(workspaceId)}/conversations${query({ ...input, limit: 50 })}`),
    getAnalytics: (workspaceId: string, input: { days: number; utcOffsetMinutes: number }) => get<Analytics>(`${workspace(workspaceId)}/analytics${query(input)}`),
    listContacts: (workspaceId: string, input: { q?: string | undefined; cursor?: string | undefined; limit?: number | undefined } = {}) =>
      get<ContactPage>(`${workspace(workspaceId)}/contacts${query({ limit: 50, ...input })}`),
    getConversation: (workspaceId: string, id: string) => get<Conversation>(conversation(workspaceId, id)),
    updateConversation: (workspaceId: string, id: string, input: ConversationUpdate) => request<Conversation>('PATCH', conversation(workspaceId, id), input),
    listMessages: (workspaceId: string, id: string, input: { afterSeq?: number | undefined; beforeSeq?: number | undefined } = {}) =>
      get<{ data: Message[] }>(`${conversation(workspaceId, id)}/messages${query({ ...input, limit: 50 })}`),
    /** The file's own type decides whether it is allowed. A browser reports none for some files, which are refused. */
    uploadAttachment: async (workspaceId: string, id: string, file: File): Promise<Attachment> =>
      (await (await checked('POST', `${conversation(workspaceId, id)}/attachments?filename=${encodeURIComponent(file.name)}`, undefined, { data: file, type: file.type || 'application/octet-stream' })).json()) as Attachment,
    /** For React Native, where a picked file is bytes and not a File. The same rules apply on the server. */
    uploadAttachmentBytes: async (workspaceId: string, id: string, file: { filename: string; contentType: string; data: Uint8Array<ArrayBuffer> }): Promise<Attachment> =>
      (await (await checked('POST', `${conversation(workspaceId, id)}/attachments?filename=${encodeURIComponent(file.filename)}`, undefined, { data: file.data, type: file.contentType })).json()) as Attachment,
    /** `url` is the path from an attachment. It needs the token, so a file is fetched, not linked. */
    downloadAttachment: async (url: string): Promise<Blob> => (await checked('GET', url)).blob(),
    downloadAttachmentBytes: async (url: string): Promise<ArrayBuffer> => (await checked('GET', url)).arrayBuffer(),
    sendMessage: (workspaceId: string, id: string, input: MessageInput) => request<Message>('POST', `${conversation(workspaceId, id)}/messages`, input),
    markConversationRead: (workspaceId: string, id: string, seq: number) => request<void>('POST', `${conversation(workspaceId, id)}/read`, { deliveredSeq: seq, readSeq: seq }),
    getContact: (workspaceId: string, id: string) => get<Contact>(`${workspace(workspaceId)}/contacts/${encodeURIComponent(id)}`),
    updateContact: (workspaceId: string, id: string, input: ContactUpdate) => request<Contact>('PATCH', `${workspace(workspaceId)}/contacts/${encodeURIComponent(id)}`, input),
    exportContact: (workspaceId: string, id: string, includeNotes = false) => get<ContactExport>(`${workspace(workspaceId)}/contacts/${encodeURIComponent(id)}/export${includeNotes ? '?include=notes' : ''}`),
    eraseContact: (workspaceId: string, id: string) => request<void>('DELETE', `${workspace(workspaceId)}/contacts/${encodeURIComponent(id)}`),
    listTags: (workspaceId: string) => get<{ data: Tag[] }>(`${workspace(workspaceId)}/tags`),
    createTag: (workspaceId: string, name: string) => request<Tag>('POST', `${workspace(workspaceId)}/tags`, { name }),
    setConversationTags: (workspaceId: string, id: string, tagIds: string[]) => request<void>('PUT', `${conversation(workspaceId, id)}/tags`, { tagIds }),
    createPushGrant: (workspaceId: string) => request<PushGrant>('POST', `${workspace(workspaceId)}/push/grants`),
    listPushSubscriptions: (workspaceId: string) => get<{ data: PushSubscription[] }>(`${workspace(workspaceId)}/push/subscriptions`),
    recordPushSubscription: (workspaceId: string, input: PushSubscriptionInput) => request<PushSubscription>('POST', `${workspace(workspaceId)}/push/subscriptions`, input),
    removePushSubscription: (workspaceId: string, id: string) => request<void>('DELETE', `${workspace(workspaceId)}/push/subscriptions/${encodeURIComponent(id)}`),
    getNotificationPreferences: (workspaceId: string) => get<NotificationPreferences>(`${workspace(workspaceId)}/notification-preferences`),
    setNotificationPreferences: (workspaceId: string, input: NotificationPreferences) => request<void>('PUT', `${workspace(workspaceId)}/notification-preferences`, input),
    listEmailSuppressions: (workspaceId: string, cursor?: string) => get<EmailSuppressionPage>(`${workspace(workspaceId)}/email-suppressions?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    addEmailSuppression: (workspaceId: string, email: string) => request<void>('POST', `${workspace(workspaceId)}/email-suppressions`, { email }),
    removeEmailSuppression: (workspaceId: string, email: string) => request<void>('POST', `${workspace(workspaceId)}/email-suppressions/remove`, { email }),
    listSavedReplies: (workspaceId: string) => get<{ data: SavedReply[] }>(`${workspace(workspaceId)}/saved-replies`),
    createSavedReply: (workspaceId: string, input: { title: string; content: string }) => request<SavedReply>('POST', `${workspace(workspaceId)}/saved-replies`, input),
    updateSavedReply: (workspaceId: string, savedReplyId: string, change: { title?: string; content?: string }) => request<SavedReply>('PATCH', `${workspace(workspaceId)}/saved-replies/${savedReplyId}`, change),
    deleteSavedReply: (workspaceId: string, savedReplyId: string) => request<void>('DELETE', `${workspace(workspaceId)}/saved-replies/${savedReplyId}`),
    listFollowUpRules: (workspaceId: string) => get<{ data: FollowUpRule[] }>(`${workspace(workspaceId)}/follow-up-rules`),
    createFollowUpRule: (workspaceId: string, input: { name: string; inactiveMinutes: number }) => request<FollowUpRule>('POST', `${workspace(workspaceId)}/follow-up-rules`, input),
    updateFollowUpRule: (workspaceId: string, ruleId: string, change: { name?: string; enabled?: boolean; inactiveMinutes?: number }) => request<FollowUpRule>('PATCH', `${workspace(workspaceId)}/follow-up-rules/${encodeURIComponent(ruleId)}`, change),
    deleteFollowUpRule: (workspaceId: string, ruleId: string) => request<void>('DELETE', `${workspace(workspaceId)}/follow-up-rules/${encodeURIComponent(ruleId)}`),
    getTranslationSettings: (workspaceId: string) => get<TranslationSettings>(`${workspace(workspaceId)}/translation`),
    updateTranslationSettings: (workspaceId: string, input: { enabled: boolean; model: string }) => request<TranslationSettings>('PUT', `${workspace(workspaceId)}/translation`, input),
    translateMessage: (workspaceId: string, conversationId: string, messageId: string, language?: string) =>
      request<MessageTranslation>('POST', `${conversation(workspaceId, conversationId)}/messages/${encodeURIComponent(messageId)}/translation`, language ? { language } : {}),
    getAssistant: (workspaceId: string, websiteId: string) => get<Assistant>(`${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/assistant`),
    saveAssistantSettings: (workspaceId: string, websiteId: string, input: { name: string; model: string | null; enabled?: boolean; learn?: boolean; instructions?: string | null; handoverMessage?: string | null }) =>
      request<NonNullable<Assistant['settings']>>('PUT', `${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/assistant/settings`, input),
    addAssistantSource: (workspaceId: string, websiteId: string, input: AssistantSourceInput) => request<AssistantSource>('POST', `${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/assistant/sources`, input),
    updateAssistantSource: (workspaceId: string, sourceId: string, change: { title?: string; content?: string } = {}) =>
      request<AssistantSource>('PATCH', `${workspace(workspaceId)}/assistant/sources/${encodeURIComponent(sourceId)}`, change),
    deleteAssistantSource: (workspaceId: string, sourceId: string) => request<void>('DELETE', `${workspace(workspaceId)}/assistant/sources/${encodeURIComponent(sourceId)}`),
    testAssistant: (workspaceId: string, websiteId: string, question: string, history: { role: 'visitor' | 'assistant'; content: string }[] = []) =>
      request<AssistantAnswer>('POST', `${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/assistant/test`, history.length > 0 ? { question, history } : { question }),
    listLearnedAnswers: (workspaceId: string, websiteId: string, status: LearnedAnswer['status']) =>
      get<{ data: LearnedAnswer[] }>(`${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/assistant/learned?status=${status}`),
    decideLearnedAnswer: (workspaceId: string, learnedId: string, input: { status: 'approved' | 'rejected'; question?: string; answer?: string }) =>
      request<LearnedAnswer>('PATCH', `${workspace(workspaceId)}/assistant/learned/${encodeURIComponent(learnedId)}`, input),
    deleteLearnedAnswer: (workspaceId: string, learnedId: string) => request<void>('DELETE', `${workspace(workspaceId)}/assistant/learned/${encodeURIComponent(learnedId)}`),
    listUnansweredQuestions: (workspaceId: string, websiteId: string) => get<{ data: UnansweredQuestion[] }>(`${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/assistant/unanswered`),
    answerUnansweredQuestion: (workspaceId: string, questionId: string, input: { question: string; answer: string }) =>
      request<LearnedAnswer>('POST', `${workspace(workspaceId)}/assistant/unanswered/${encodeURIComponent(questionId)}/answer`, input),
    dismissUnansweredQuestion: (workspaceId: string, questionId: string) => request<void>('DELETE', `${workspace(workspaceId)}/assistant/unanswered/${encodeURIComponent(questionId)}`),
    setLearnedAutoApprove: (workspaceId: string, autoApprove: boolean) => request<{ autoApprove: boolean }>('PUT', `${workspace(workspaceId)}/assistant/learning`, { autoApprove }),
    getHelpCentre: (workspaceId: string, websiteId: string) => get<HelpCentre>(`${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/help`),
    saveHelpSettings: (workspaceId: string, websiteId: string, input: { slug: string | null; noindex?: boolean }) =>
      request<{ slug: string | null; noindex: boolean }>('PUT', `${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/help/settings`, input),
    createHelpCollection: (workspaceId: string, websiteId: string, input: { language: string; name: string }) =>
      request<HelpCollection>('POST', `${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/help/collections`, input),
    updateHelpCollection: (workspaceId: string, collectionId: string, change: { name?: string; slug?: string; position?: number }) =>
      request<HelpCollection>('PATCH', `${workspace(workspaceId)}/help/collections/${encodeURIComponent(collectionId)}`, change),
    deleteHelpCollection: (workspaceId: string, collectionId: string) => request<void>('DELETE', `${workspace(workspaceId)}/help/collections/${encodeURIComponent(collectionId)}`),
    getHelpArticle: (workspaceId: string, articleId: string) => get<HelpArticle>(`${workspace(workspaceId)}/help/articles/${encodeURIComponent(articleId)}`),
    createHelpArticle: (workspaceId: string, websiteId: string, input: HelpArticleInput) =>
      request<HelpArticle>('POST', `${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/help/articles`, input),
    updateHelpArticle: (workspaceId: string, articleId: string, change: HelpArticleUpdate) => request<HelpArticle>('PATCH', `${workspace(workspaceId)}/help/articles/${encodeURIComponent(articleId)}`, change),
    setHelpArticleStatus: (workspaceId: string, articleId: string, status: 'draft' | 'published') =>
      request<HelpArticle>('PUT', `${workspace(workspaceId)}/help/articles/${encodeURIComponent(articleId)}/status`, { status }),
    deleteHelpArticle: (workspaceId: string, articleId: string) => request<void>('DELETE', `${workspace(workspaceId)}/help/articles/${encodeURIComponent(articleId)}`),
    uploadHelpAsset: async (workspaceId: string, websiteId: string, file: File): Promise<HelpAsset> =>
      (await (
        await checked('POST', `${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/help/assets?filename=${encodeURIComponent(file.name)}`, undefined, {
          data: file,
          type: file.type || 'application/octet-stream',
        })
      ).json()) as HelpAsset,
    deleteHelpAsset: (workspaceId: string, assetId: string) => request<void>('DELETE', `${workspace(workspaceId)}/help/assets/${encodeURIComponent(assetId)}`),
    createHelpDraftRun: (workspaceId: string, websiteId: string, input: HelpDraftInput) =>
      request<HelpDraftRun>('POST', `${workspace(workspaceId)}/websites/${encodeURIComponent(websiteId)}/help/drafts`, input),
    uploadHelpDraftFile: async (workspaceId: string, runId: string, file: File): Promise<HelpDraftRun> =>
      (await (
        await checked('POST', `${workspace(workspaceId)}/help/drafts/${encodeURIComponent(runId)}/files?filename=${encodeURIComponent(file.name)}`, undefined, {
          data: file,
          type: file.type || 'application/octet-stream',
        })
      ).json()) as HelpDraftRun,
    startHelpDraftRun: (workspaceId: string, runId: string) => request<HelpDraftRun>('POST', `${workspace(workspaceId)}/help/drafts/${encodeURIComponent(runId)}/start`),
    createRealtimeTicket: (workspaceId: string) => request<RealtimeTicket>('POST', `${workspace(workspaceId)}/realtime/tickets`),
  };
}

export type ApiClient = ReturnType<typeof createClient>;
