/** Workers AI and Vectorize, as the assistant needs them (ADR-0022). Without both bindings there is no assistant. */
import { ASSISTANT_EMBEDDING_MODEL, type AssistantRuntime } from '@openchat/core';
import type { Env } from '../env';

/** Model names are chosen at run time, from a list in @openchat/core, so the binding is called untyped. */
type UntypedAi = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

/** Vectorize deletes up to 1,000 IDs in one call. */
const DELETE_BATCH = 1000;

/** Chat models answer in one of two shapes, depending on the model. */
export function generatedText(output: unknown): string {
  const value = output as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;
  if (typeof value?.response === 'string') return value.response;
  const content = value?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  throw new Error('The model gave no text');
}

export function assistantRuntime(env: Env): AssistantRuntime | null {
  if (!env.AI || !env.VECTORIZE) return null;
  const ai = env.AI as unknown as UntypedAi;
  const index = env.VECTORIZE;
  return {
    async embed(texts) {
      const output = (await ai.run(ASSISTANT_EMBEDDING_MODEL, { text: texts })) as { data?: number[][] };
      if (!Array.isArray(output.data) || output.data.length !== texts.length) throw new Error('The embedding model gave the wrong number of vectors');
      return output.data;
    },
    async generate(model, messages, maxTokens) {
      return generatedText(await ai.run(model, { messages, max_tokens: maxTokens, temperature: 0.2 }));
    },
    async upsert(namespace, vectors) {
      if (vectors.length === 0) return;
      await index.upsert(vectors.map((v) => ({ id: v.id, values: v.values, namespace, metadata: { websiteId: v.websiteId } })));
    },
    async query(namespace, websiteId, vector, topK) {
      const result = await index.query(vector, { topK, namespace, filter: { websiteId }, returnMetadata: 'none', returnValues: false });
      return result.matches.map((match) => ({ id: match.id, score: match.score }));
    },
    async remove(ids) {
      for (let start = 0; start < ids.length; start += DELETE_BATCH) await index.deleteByIds(ids.slice(start, start + DELETE_BATCH));
    },
  };
}
