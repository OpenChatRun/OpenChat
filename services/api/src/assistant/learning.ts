/**
 * Learning from resolved conversations (ADR-0022, step 3), on the jobs queue: the assistant's own queue is kept for
 * answering visitors, who are waiting. Both jobs are safe to run twice.
 */
import { indexLearnedAnswer, learnFromConversation } from '@openchat/core';
import { openDatabase, type OutboxRow } from '@openchat/database';
import { createLogger, newId, readAbuseLimits, type JobEnvelope } from '@openchat/shared';
import type { Env } from '../env';
import { assistantRuntime } from './runtime';

export const ASSISTANT_LEARN_JOB = 'assistant.learn';
export const ASSISTANT_INDEX_LEARNED_JOB = 'assistant.index_learned';

interface LearnPayload {
  conversationId: string;
}

interface IndexLearnedPayload {
  learnedId: string;
  generation: number;
}

/** One job per conversation and last message: resolved again after new messages, it is read again. */
export async function queueAssistantLearning(env: Env, row: OutboxRow, lastMessageSeq: number): Promise<void> {
  if (!assistantRuntime(env)) return;
  const job: JobEnvelope<LearnPayload> = {
    v: 1,
    type: ASSISTANT_LEARN_JOB,
    id: newId('job'),
    idempotencyKey: `${ASSISTANT_LEARN_JOB}:${row.aggregateId}:${lastMessageSeq}`,
    workspaceId: row.workspaceId,
    occurredAt: new Date().toISOString(),
    payload: { conversationId: row.aggregateId },
  };
  await env.JOBS_QUEUE.send(job);
}

export function learnedIndexJob(row: OutboxRow): JobEnvelope<IndexLearnedPayload> {
  const { generation } = JSON.parse(row.payloadJson) as { generation: number };
  return {
    v: 1,
    type: ASSISTANT_INDEX_LEARNED_JOB,
    id: newId('job'),
    idempotencyKey: `${ASSISTANT_INDEX_LEARNED_JOB}:${row.aggregateId}:${generation}`,
    workspaceId: row.workspaceId,
    occurredAt: new Date().toISOString(),
    payload: { learnedId: row.aggregateId, generation },
  };
}

/** A failing model is retried, as any platform error is. `dispatch` sends the indexing row an approved answer wrote. */
export async function runLearnJob(job: JobEnvelope, env: Env, dispatch: (workspaceId: string, ids: string[]) => Promise<void>): Promise<void> {
  const runtime = assistantRuntime(env);
  if (!runtime || !job.workspaceId) return;
  const { conversationId } = job.payload as LearnPayload;
  const result = await learnFromConversation({ db: openDatabase(env.DB), runtime, limits: readAbuseLimits(env), defaultModel: env.ASSISTANT_MODEL }, job.workspaceId, conversationId);
  createLogger({ workspaceId: job.workspaceId }).info(`assistant_learn_${result.outcome}`, { jobType: job.type });
  if (result.learnedId) await dispatch(job.workspaceId, [result.learnedId]);
}

export async function runIndexLearnedJob(job: JobEnvelope, env: Env): Promise<void> {
  const runtime = assistantRuntime(env);
  if (!runtime || !job.workspaceId) return;
  const payload = job.payload as IndexLearnedPayload;
  const outcome = await indexLearnedAnswer({ db: openDatabase(env.DB), runtime }, { workspaceId: job.workspaceId, id: payload.learnedId, generation: payload.generation });
  createLogger({ workspaceId: job.workspaceId }).info(`assistant_learned_${outcome}`, { jobType: job.type });
}
