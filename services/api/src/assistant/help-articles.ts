/**
 * Published help articles as an assistant source (ADR-0023, step 4), on the jobs queue. A sync looks at one website
 * and sends one job for each article whose copy is behind; that job indexes one version of one article.
 */
import { helpArticlesToSync, indexHelpArticle } from '@openchat/core';
import { openDatabase, type OutboxRow } from '@openchat/database';
import { createLogger, newId, type JobEnvelope } from '@openchat/shared';
import type { Env } from '../env';
import { assistantRuntime } from './runtime';

export const HELP_INDEX_ARTICLE_JOB = 'help.index_article';
/** Queues take at most 100 messages in one send. */
const SEND_BATCH = 100;

interface IndexArticlePayload {
  articleId: string;
  version: number;
}

/** Without Workers AI and Vectorize there is nothing to index into; the articles are synced when a later change comes. */
export async function syncHelpArticles(env: Env, row: OutboxRow): Promise<void> {
  if (!assistantRuntime(env)) return;
  const { websiteId } = JSON.parse(row.payloadJson) as { websiteId: string };
  const stale = await helpArticlesToSync(openDatabase(env.DB), row.workspaceId, websiteId);
  const jobs = stale.map(
    ({ id, version }): JobEnvelope<IndexArticlePayload> => ({
      v: 1,
      type: HELP_INDEX_ARTICLE_JOB,
      id: newId('job'),
      // One job per version: a second sync before it runs sends the same job.
      idempotencyKey: `${HELP_INDEX_ARTICLE_JOB}:${id}:${version}`,
      workspaceId: row.workspaceId,
      occurredAt: new Date().toISOString(),
      payload: { articleId: id, version },
    }),
  );
  for (let start = 0; start < jobs.length; start += SEND_BATCH) await env.JOBS_QUEUE.sendBatch(jobs.slice(start, start + SEND_BATCH).map((body) => ({ body })));
}

/** `dispatch` sends the outbox row that removes the version in use before. */
export async function runIndexHelpArticleJob(job: JobEnvelope, env: Env, dispatch: (workspaceId: string, ids: string[]) => Promise<void>): Promise<void> {
  const runtime = assistantRuntime(env);
  if (!runtime || !job.workspaceId) return;
  const payload = job.payload as IndexArticlePayload;
  const outcome = await indexHelpArticle({ db: openDatabase(env.DB), runtime }, { workspaceId: job.workspaceId, articleId: payload.articleId, version: payload.version });
  createLogger({ workspaceId: job.workspaceId }).info(`help_article_${outcome}`, { jobType: job.type });
  await dispatch(job.workspaceId, [payload.articleId]);
}
