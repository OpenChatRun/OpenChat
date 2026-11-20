/**
 * The assistant's turn after a visitor's message (ADR-0022, step 2). Queued from dispatch of `message.created`, on its
 * own queue, so that slow model calls never hold up other jobs.
 */
import { replyToVisitor } from '@openchat/core';
import { openDatabase, type OutboxRow } from '@openchat/database';
import { roomName } from '@openchat/realtime';
import { createLogger, newId, readAbuseLimits, type JobEnvelope } from '@openchat/shared';
import type { Env } from '../env';
import { assistantRuntime } from './runtime';

export const ASSISTANT_REPLY_JOB = 'assistant.reply';

interface ReplyPayload {
  messageId: string;
}

/** The assistant can answer only with Workers AI, Vectorize, and its queue all bound. */
export const assistantCanReply = (env: Env): boolean => env.ASSISTANT_QUEUE !== undefined && assistantRuntime(env) !== null;

/**
 * One job per visitor message. The job decides whether to answer, from what is true when it runs, so it is queued
 * for every visitor message while the assistant can reply at all.
 */
export async function queueAssistantReply(env: Env, row: OutboxRow, senderType: string): Promise<void> {
  if (senderType !== 'visitor' || !env.ASSISTANT_QUEUE || !assistantCanReply(env)) return;
  const job: JobEnvelope<ReplyPayload> = {
    v: 1,
    type: ASSISTANT_REPLY_JOB,
    id: newId('job'),
    idempotencyKey: `${ASSISTANT_REPLY_JOB}:${row.aggregateId}`,
    workspaceId: row.workspaceId,
    occurredAt: new Date().toISOString(),
    payload: { messageId: row.aggregateId },
  };
  await env.ASSISTANT_QUEUE.send(job);
}

/**
 * Safe to run twice: the reply's client message ID comes from the visitor's message, so a retry writes nothing more.
 * A model that fails hands over rather than retrying; anything else, such as D1, is retried.
 */
export async function runReplyJob(job: JobEnvelope, env: Env, dispatch: (workspaceId: string, ids: string[]) => Promise<void>): Promise<void> {
  const runtime = assistantRuntime(env);
  if (!runtime || !job.workspaceId) return;
  const workspaceId = job.workspaceId;
  const { messageId } = job.payload as ReplyPayload;
  const outcome = await replyToVisitor(
    { db: openDatabase(env.DB), runtime, limits: readAbuseLimits(env), defaultModel: env.ASSISTANT_MODEL },
    workspaceId,
    messageId,
    async (assistantName, id) => {
      // "Typing", as for a person. Advisory: the room may be empty, and the widget expires it.
      await env.CONVERSATION_ROOM.getByName(roomName(workspaceId, id)).publish({ v: 1, type: 'typing', data: { conversationId: id, displayName: assistantName } });
    },
  );
  const log = createLogger({ workspaceId });
  if (outcome.kind === 'skipped') {
    log.info('assistant_reply_skipped', { jobType: job.type });
    return;
  }
  log.info(outcome.kind === 'answer' ? 'assistant_answered' : `assistant_handover_${outcome.reason}`, { jobType: job.type });
  await dispatch(workspaceId, [outcome.messageId, outcome.conversationId]);
}
