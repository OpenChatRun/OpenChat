/**
 * Small fakes of Workers AI and Vectorize for tests of the assistant. Embeddings are word counts, and the index
 * ranks by cosine similarity within a namespace and a websiteId filter.
 */
const DIMENSIONS = 512;

export function embedOne(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % DIMENSIONS]! += 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((v) => v / length);
}

type Stored = { id: string; values: number[]; namespace: string; metadata: { websiteId: string } };
export type Turn = { role: string; content: string };

export function fakeAssistant() {
  const state = {
    vectors: new Map<string, Stored>(),
    prompts: [] as { model: string; messages: Turn[] }[],
    /** What the model says. By default, the first line of the first source it was given. */
    reply: (messages: Turn[]): string => /<source n="1"[^>]*>\n([^\n]*)/.exec(messages[0]!.content)?.[1] ?? 'NO_ANSWER',
  };
  const ai = {
    async run(model: string, input: { text?: string[]; messages?: Turn[] }) {
      if (model === '@cf/baai/bge-m3') return { shape: [input.text!.length, DIMENSIONS], data: input.text!.map(embedOne) };
      state.prompts.push({ model, messages: input.messages! });
      return { response: state.reply(input.messages!) };
    },
  };
  const vectorize = {
    async upsert(list: Stored[]) {
      for (const v of list) state.vectors.set(v.id, v);
      return { mutationId: 'm' };
    },
    async query(vector: number[], options: { topK: number; namespace: string; filter: { websiteId: string } }) {
      const matches = [...state.vectors.values()]
        .filter((v) => v.namespace === options.namespace && v.metadata.websiteId === options.filter.websiteId)
        .map((v) => ({ id: v.id, score: v.values.reduce((sum, x, i) => sum + x * vector[i]!, 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, options.topK);
      return { matches, count: matches.length };
    },
    async deleteByIds(ids: string[]) {
      for (const id of ids) state.vectors.delete(id);
      return { mutationId: 'm' };
    },
  };
  return { state, ai, vectorize };
}
