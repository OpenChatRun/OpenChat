/**
 * Draft with AI's background work (ADR-0023, step 2), on the jobs queue. `help.draft` reads the material and makes
 * the outline; then one `help.draft_article` per article, so that one failure loses only that article.
 */
import { helpDraftPrefix, outlineHelpDraft, writeHelpDraftArticle, type HelpDraftJobDeps, type HelpDraftStore, type HelpMaterial } from '@openchat/core';
import { createLogger, newId, readAbuseLimits, type JobEnvelope } from '@openchat/shared';
import type { Env } from '../env';
import { pageReader } from '../assistant/crawl';
import { textRuntime } from '../assistant/runtime';

export const HELP_DRAFT_JOB = 'help.draft';
export const HELP_DRAFT_ARTICLE_JOB = 'help.draft_article';
/** Queues take at most 100 messages in one send. */
const SEND_BATCH = 100;

const envelope = <T>(type: string, key: string, workspaceId: string, payload: T): JobEnvelope<T> => ({
  v: 1,
  type,
  id: newId('job'),
  idempotencyKey: key,
  workspaceId,
  occurredAt: new Date().toISOString(),
  payload,
});

export const helpDraftJob = (workspaceId: string, runId: string) => envelope(HELP_DRAFT_JOB, `${HELP_DRAFT_JOB}:${runId}`, workspaceId, { runId });

function store(env: Env, runId: string): HelpDraftStore {
  const prefix = helpDraftPrefix(runId);
  return {
    async file(index) {
      const object = await env.ATTACHMENTS.get(`${prefix}file-${index}`);
      return object ? new Blob([await object.arrayBuffer()], { type: object.httpMetadata?.contentType ?? 'application/octet-stream' }) : null;
    },
    async putMaterial(material) {
      await env.ATTACHMENTS.put(`${prefix}material.json`, JSON.stringify(material), { httpMetadata: { contentType: 'application/json' } });
    },
    async material() {
      const object = await env.ATTACHMENTS.get(`${prefix}material.json`);
      return object ? ((await object.json()) as HelpMaterial[]) : null;
    },
    async clear() {
      await deleteHelpDraftFiles(env, runId);
    },
  };
}

export async function deleteHelpDraftFiles(env: Env, runId: string): Promise<void> {
  const prefix = helpDraftPrefix(runId);
  for (;;) {
    const listed = await env.ATTACHMENTS.list({ prefix, limit: 1000 });
    if (listed.objects.length === 0) return;
    await env.ATTACHMENTS.delete(listed.objects.map((object) => object.key));
  }
}

function jobDeps(env: Env, runId: string, db: HelpDraftJobDeps['db']): HelpDraftJobDeps | null {
  const runtime = textRuntime(env);
  const ai = env.AI;
  if (!runtime || !ai) return null;
  return {
    db,
    runtime,
    readPages: pageReader(),
    async toMarkdown(name, blob) {
      try {
        const result = await ai.toMarkdown({ name, blob });
        return result.format === 'error' ? null : result.data;
      } catch {
        return null;
      }
    },
    store: store(env, runId),
    limits: readAbuseLimits(env),
    defaultModel: env.ASSISTANT_MODEL,
  };
}

export async function runHelpDraftJob(job: JobEnvelope, env: Env, db: HelpDraftJobDeps['db']): Promise<void> {
  const { runId } = job.payload as { runId: string };
  // Workers AI was taken away since. The sweep stops the run.
  const deps = job.workspaceId ? jobDeps(env, runId, db) : null;
  if (!deps || !job.workspaceId) return;
  const workspaceId = job.workspaceId;
  const { outcome, positions } = await outlineHelpDraft(deps, workspaceId, runId);
  createLogger({ workspaceId }).info(`help_draft_${outcome}`, { jobType: job.type, count: positions.length });
  const jobs = positions.map((index) => envelope(HELP_DRAFT_ARTICLE_JOB, `${HELP_DRAFT_ARTICLE_JOB}:${runId}:${index}`, workspaceId, { runId, index }));
  for (let start = 0; start < jobs.length; start += SEND_BATCH) await env.JOBS_QUEUE.sendBatch(jobs.slice(start, start + SEND_BATCH).map((body) => ({ body })));
}

export async function runHelpDraftArticleJob(job: JobEnvelope, env: Env, db: HelpDraftJobDeps['db']): Promise<void> {
  const { runId, index } = job.payload as { runId: string; index: number };
  const deps = job.workspaceId ? jobDeps(env, runId, db) : null;
  if (!deps || !job.workspaceId) return;
  const outcome = await writeHelpDraftArticle(deps, job.workspaceId, runId, index);
  createLogger({ workspaceId: job.workspaceId }).info(`help_draft_article_${outcome}`, { jobType: job.type });
}
