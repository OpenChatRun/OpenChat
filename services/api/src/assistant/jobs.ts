/** The assistant's background work (ADR-0022): indexing a source, queued from the outbox. */
import { assistantVectorIds, indexAssistantSource } from '@openchat/core';
import { openDatabase, refreshStaleAssistantPages, type Database, type OutboxRow } from '@openchat/database';
import { createLogger, newId, readAbuseLimits, type JobEnvelope } from '@openchat/shared';
import type { Env } from '../env';
import { pageReader } from './crawl';
import { assistantRuntime } from './runtime';

export const ASSISTANT_INDEX_JOB = 'assistant.index_source';
/** Pages are read again after a week, so that answers follow the website. */
const REFRESH_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_LIMIT = 20;

interface IndexPayload {
  sourceId: string;
  generation: number;
}

/** One job per generation of a source, so a second dispatch of the same row is the same job. */
export function indexJob(row: OutboxRow): JobEnvelope<IndexPayload> {
  const { generation } = JSON.parse(row.payloadJson) as { generation: number };
  return {
    v: 1,
    type: ASSISTANT_INDEX_JOB,
    id: newId('job'),
    idempotencyKey: `${ASSISTANT_INDEX_JOB}:${row.aggregateId}:${generation}`,
    workspaceId: row.workspaceId,
    occurredAt: new Date().toISOString(),
    payload: { sourceId: row.aggregateId, generation },
  };
}

/** Deletes a generation's vectors. With no Vectorize binding there can be none. */
export async function removeVectors(env: Env, row: OutboxRow): Promise<void> {
  const runtime = assistantRuntime(env);
  if (!runtime) return;
  await runtime.remove(assistantVectorIds(JSON.parse(row.payloadJson) as { sourceId: string; generation: number; count: number }));
}

/** `dispatch` sends the outbox rows indexing wrote, such as removing the previous generation's vectors. */
export async function runIndexJob(job: JobEnvelope, env: Env, dispatch: (workspaceId: string, ids: string[]) => Promise<void>): Promise<void> {
  const runtime = assistantRuntime(env);
  // The bindings were taken away since. The source stays pending until they are back and it is read again.
  if (!runtime || !job.workspaceId) return;
  const payload = job.payload as IndexPayload;
  const outcome = await indexAssistantSource(
    { db: openDatabase(env.DB), runtime, readPages: pageReader(), limits: readAbuseLimits(env) },
    { workspaceId: job.workspaceId, sourceId: payload.sourceId, generation: payload.generation },
  );
  createLogger({ workspaceId: job.workspaceId }).info(`assistant_source_${outcome}`, { jobType: job.type });
  await dispatch(job.workspaceId, [payload.sourceId]);
}

/** Hourly. Returns the refreshed sources, for dispatch. */
export async function refreshAssistantPages(env: Env, db: Database): Promise<{ workspaceId: string; id: string }[]> {
  if (!assistantRuntime(env)) return [];
  return refreshStaleAssistantPages(db, REFRESH_AGE_MS, REFRESH_LIMIT);
}
