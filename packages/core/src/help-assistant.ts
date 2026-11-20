/**
 * Published help articles as a source for the AI assistant (ADR-0023, step 4). The pieces are the assistant's own:
 * the same chunking, embedding and Vectorize index as its sources, and the same removal.
 */
import { finishHelpArticleIndexing, helpArticleForIndexing, helpArticlesToIndex, type Database } from '@openchat/database';
import { helpMarkdownToText } from '@openchat/shared';
import { chunkText, today, type AssistantRuntime } from './assistant';

/** At most this many pieces of one article: 20,000 characters of body make about 20. */
const CHUNKS_PER_ARTICLE = 40;
const EMBED_BATCH = 20;

/**
 * What the assistant reads of an article: the title, the summary, and the body as plain text. Links keep their
 * address, written out after the words, so that an answer can give it; help-centre links are made absolute.
 */
export function helpArticleAssistantText(article: { title: string; summary: string; bodyMarkdown: string }, base: string): string {
  const origin = base.replace(/\/+$/, '');
  const body = article.bodyMarkdown
    .replace(/!\[([^\]\n]*)\]\([^()\s]+\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (_, label: string, href: string) => {
      const address = href.startsWith('/help/') ? `${origin}${href}` : href;
      return /^(https:|mailto:)/.test(address) ? `${label} (${address.replace(/^mailto:/, '')})` : label;
    });
  return [article.title, article.summary, helpMarkdownToText(body)].filter((part) => part.trim()).join('\n\n');
}

export const helpChunkId = (articleId: string, version: number, n: number) => `${articleId}.${version}.${n}`;

/** Articles of a website the sync should index, as [id, version]. Empty if the website has no assistant. */
export const helpArticlesToSync = (db: Database, workspaceId: string, websiteId: string) => helpArticlesToIndex(db, workspaceId, websiteId);

/**
 * Indexes one version of one published article. Safe to run twice: the IDs are fixed by the version, and nothing is
 * put in use unless the article is still published at that version.
 */
export async function indexHelpArticle(deps: { db: Database; runtime: AssistantRuntime }, job: { workspaceId: string; articleId: string; version: number }): Promise<'indexed' | 'stale'> {
  const article = await helpArticleForIndexing(deps.db, job.workspaceId, job.articleId, job.version);
  if (!article) return 'stale';
  const pieces = chunkText(helpArticleAssistantText(article, article.publicBaseUrl)).slice(0, CHUNKS_PER_ARTICLE);
  const chunks = pieces.map((content, n) => ({ id: helpChunkId(article.id, article.version, n), content }));
  const vectors: { id: string; values: number[]; websiteId: string }[] = [];
  for (let at = 0; at < chunks.length; at += EMBED_BATCH) {
    const slice = chunks.slice(at, at + EMBED_BATCH);
    // As for sources: the title helps a piece be found by what the article is about.
    const values = await deps.runtime.embed(slice.map((chunk) => `${article.title}\n\n${chunk.content}`));
    slice.forEach((chunk, i) => vectors.push({ id: chunk.id, values: values[i]!, websiteId: article.websiteId }));
  }
  if (vectors.length > 0) await deps.runtime.upsert(job.workspaceId, vectors);
  if (await finishHelpArticleIndexing(deps.db, job.workspaceId, article.id, article.version, chunks, today())) return 'indexed';
  // Changed, unpublished or deleted meanwhile. These vectors belong to nothing now.
  if (vectors.length > 0) await deps.runtime.remove(chunks.map((chunk) => chunk.id));
  return 'stale';
}
