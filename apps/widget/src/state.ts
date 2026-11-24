/** Pure rules for the message list. Sequence numbers are public ones, which are gapless. */
import type { VisitorMessage } from './api';

export interface ChatMessage {
  /** Stable across sending and arrival, so that the row keeps its place and its focus. */
  key: string;
  id: string | null;
  seq: number | null;
  clientMessageId: string | null;
  mine: boolean;
  system: boolean;
  /** Written by the AI assistant: labelled, and a handover is shown in the visitor's language. */
  assistant: 'answer' | 'handover' | null;
  /** A handover in the team's own words, shown as they are. */
  ownWords: boolean;
  senderName: string | null;
  content: string;
  createdAt: string | null;
  status: 'sending' | 'failed' | 'sent';
  attachments: VisitorMessage['attachments'];
  /** The name of a file on its way, until the server has it. */
  pendingFile: string | null;
  /** A team reply translated automatically for the visitor (ADR-0024): what the team member wrote. */
  original: { language: string; content: string } | null;
}

export const fromServer = (message: VisitorMessage): ChatMessage => ({
  // Only the visitor's own messages were ever pending under a client ID.
  key: message.sender.type === 'visitor' ? (message.clientMessageId ?? message.id) : message.id,
  id: message.id,
  seq: message.seq,
  clientMessageId: message.clientMessageId,
  mine: message.sender.type === 'visitor',
  system: message.sender.type === 'system' && !message.assistant,
  assistant: message.assistant?.kind ?? null,
  ownWords: message.assistant?.custom === true,
  senderName: message.sender.displayName,
  content: message.content,
  createdAt: message.createdAt,
  status: 'sent',
  attachments: message.attachments,
  pendingFile: null,
  original: message.original ?? null,
});

export const pendingMessage = (clientMessageId: string, content: string, pendingFile: string | null = null): ChatMessage => ({
  key: clientMessageId,
  id: null,
  seq: null,
  clientMessageId,
  mine: true,
  system: false,
  assistant: null,
  ownWords: false,
  senderName: null,
  content,
  createdAt: null,
  status: 'sending',
  attachments: [],
  pendingFile,
  original: null,
});

/** Committed messages in order, then what is still on its way. A socket, a response, and a catch-up can each bring the same message. */
export function mergeMessages(current: ChatMessage[], incoming: VisitorMessage[]): ChatMessage[] {
  const byKey = new Map(current.map((message) => [message.key, message]));
  for (const message of incoming) {
    const next = fromServer(message);
    byKey.set(next.key, next);
  }
  return [...byKey.values()].sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER));
}

export const lastSeq = (messages: ChatMessage[]) => messages.reduce((highest, message) => Math.max(highest, message.seq ?? 0), 0);

export const unreadCount = (messages: ChatMessage[], readSeq: number) => messages.filter((m) => !m.mine && m.seq !== null && m.seq > readSeq).length;

export const hasOlder = (messages: ChatMessage[]) => {
  const first = messages.find((m) => m.seq !== null);
  return first !== undefined && first.seq! > 1;
};

/** A UUID where the browser offers one. randomUUID exists only on HTTPS pages, and customers' sites may not be. */
export function newClientMessageId(crypto: Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string }): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const retryDelayMs = (attempt: number) => 1000 * 3 ** attempt;
