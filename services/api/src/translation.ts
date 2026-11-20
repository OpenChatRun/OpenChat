/**
 * Automatic translation on Workers AI (ADR-0024, step 2). The job runs on the assistant's queue, so that slow model
 * calls never hold up other jobs; without that queue or Workers AI, translation is off.
 */
import { translateVisitorMessage, type TranslationDeps, type TranslationRuntime } from '@openchat/core';
import { openDatabase, type OutboxRow } from '@openchat/database';
import { hubName } from '@openchat/realtime';
import { createLogger, newId, readAbuseLimits, type JobEnvelope } from '@openchat/shared';
import { generatedText } from './assistant/runtime';
import type { Env } from './env';

export const TRANSLATE_MESSAGE_JOB = 'translation.visitor_message';

/** Model names are chosen at run time, so the binding is called untyped. */
type UntypedAi = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

export function translationRuntime(env: Env): TranslationRuntime | null {
  if (!env.AI || !env.ASSISTANT_QUEUE) return null;
  const ai = env.AI as unknown as UntypedAi;
  return {
    async translate(text, source, target) {
      const output = (await ai.run('@cf/meta/m2m100-1.2b', { text, source_lang: source, target_lang: target })) as { translated_text?: unknown } | null;
      if (typeof output?.translated_text !== 'string') throw new Error('The translation model gave no text');
      return output.translated_text;
    },
    async generate(model, messages, maxTokens) {
      return generatedText(await ai.run(model, { messages, max_tokens: maxTokens, temperature: 0.1 }));
    },
  };
}

export const translationDeps = (env: Env): TranslationDeps => ({ db: openDatabase(env.DB), runtime: translationRuntime(env), limits: readAbuseLimits(env), defaultModel: env.ASSISTANT_MODEL });

/** One job per visitor message. It decides from what is true when it runs, so it is queued whenever translation can run. */
export async function queueTranslation(env: Env, row: OutboxRow, message: { senderType: string; type: string }): Promise<void> {
  if (message.senderType !== 'visitor' || message.type !== 'text' || !env.ASSISTANT_QUEUE || !translationRuntime(env)) return;
  const job: JobEnvelope<{ messageId: string }> = {
    v: 1,
    type: TRANSLATE_MESSAGE_JOB,
    id: newId('job'),
    idempotencyKey: `${TRANSLATE_MESSAGE_JOB}:${row.aggregateId}`,
    workspaceId: row.workspaceId,
    occurredAt: new Date().toISOString(),
    payload: { messageId: row.aggregateId },
  };
  await env.ASSISTANT_QUEUE.send(job);
}

/** Members hear that a translation is stored, and read it through REST. Only IDs and languages go on the socket. */
export async function runTranslationJob(job: JobEnvelope, env: Env): Promise<void> {
  if (!job.workspaceId) return;
  const workspaceId = job.workspaceId;
  const { messageId } = job.payload as { messageId: string };
  const outcome = await translateVisitorMessage(translationDeps(env), workspaceId, messageId);
  const log = createLogger({ workspaceId });
  if (outcome.kind !== 'translated') {
    log.info(outcome.kind === 'limit_reached' ? 'translation_limit_reached' : 'translation_skipped', { jobType: job.type });
    return;
  }
  if (outcome.failed > 0) log.warn('translation_failed', { jobType: job.type, count: outcome.failed });
  if (outcome.languages.length === 0) return;
  await env.WORKSPACE_HUB.getByName(hubName(workspaceId)).publish({ v: 1, kind: 'message.translated', workspaceId, conversationId: outcome.conversationId, messageId, languages: outcome.languages });
}
