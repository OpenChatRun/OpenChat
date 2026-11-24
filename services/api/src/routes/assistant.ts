/** The AI assistant's settings, sources and test panel (ADR-0022). Supervisors only, checked in @openchat/core. */
import {
  addAssistantSourceRoute,
  answerUnansweredQuestionRoute,
  decideLearnedAnswerRoute,
  dismissUnansweredQuestionRoute,
  listUnansweredQuestionsRoute,
  deleteAssistantSourceRoute,
  deleteLearnedAnswerRoute,
  getAssistantRoute,
  listLearnedAnswersRoute,
  saveAssistantSettingsRoute,
  setLearnedAutoApproveRoute,
  testAssistantRoute,
  updateAssistantSourceRoute,
} from '@openchat/api-contracts';
import {
  addAssistantSource,
  answerUnansweredQuestion,
  decideLearnedAnswer,
  dismissUnansweredQuestion,
  listUnansweredQuestions,
  deleteAssistantSource,
  deleteLearnedAnswer,
  getAssistant,
  listLearnedAnswers,
  saveAssistantSettings,
  setLearnedAutoApprove,
  testAssistant,
  updateAssistantSource,
  workspaceContext,
  type AssistantDeps,
} from '@openchat/core';
import { readAbuseLimits } from '@openchat/shared';
import type { Context } from 'hono';
import { assistantCanReply } from '../assistant/reply';
import { assistantRuntime } from '../assistant/runtime';
import { authDeps, type App, type AppEnv } from '../context';
import { dispatchSoon } from '../dispatch';

async function scoped(c: Context<AppEnv>, workspaceId: string): Promise<{ deps: AssistantDeps; ctx: Awaited<ReturnType<typeof workspaceContext>> }> {
  const { db } = await authDeps(c.env);
  return {
    deps: { db, runtime: assistantRuntime(c.env), limits: readAbuseLimits(c.env), defaultModel: c.env.ASSISTANT_MODEL, canReply: assistantCanReply(c.env) },
    ctx: await workspaceContext(db, c.get('principal'), workspaceId),
  };
}

/** Authentication comes from the /api/v1/workspaces/* prefix in routes/workspaces.ts. */
export function registerAssistantRoutes(app: App) {
  app.openapi(getAssistantRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    return c.json(await getAssistant(deps, ctx, websiteId), 200);
  });

  app.openapi(saveAssistantSettingsRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    const settings = await saveAssistantSettings(deps, ctx, websiteId, c.req.valid('json'));
    // The website's published help articles, into the assistant.
    dispatchSoon(c, workspaceId, [websiteId]);
    return c.json(settings, 200);
  });

  app.openapi(addAssistantSourceRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    const source = await addAssistantSource(deps, ctx, websiteId, c.req.valid('json'));
    dispatchSoon(c, workspaceId, [source.id]);
    return c.json(source, 201);
  });

  app.openapi(updateAssistantSourceRoute, async (c) => {
    const { workspaceId, sourceId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    const source = await updateAssistantSource(deps, ctx, sourceId, c.req.valid('json'));
    dispatchSoon(c, workspaceId, [source.id]);
    return c.json(source, 200);
  });

  app.openapi(deleteAssistantSourceRoute, async (c) => {
    const { workspaceId, sourceId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    await deleteAssistantSource(deps, ctx, sourceId);
    dispatchSoon(c, workspaceId, [sourceId]);
    return c.body(null, 204);
  });

  app.openapi(listLearnedAnswersRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    return c.json(await listLearnedAnswers(deps, ctx, websiteId, c.req.valid('query').status), 200);
  });

  app.openapi(decideLearnedAnswerRoute, async (c) => {
    const { workspaceId, learnedId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    const learned = await decideLearnedAnswer(deps, ctx, learnedId, c.req.valid('json'));
    dispatchSoon(c, workspaceId, [learnedId]);
    return c.json(learned, 200);
  });

  app.openapi(deleteLearnedAnswerRoute, async (c) => {
    const { workspaceId, learnedId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    await deleteLearnedAnswer(deps, ctx, learnedId);
    dispatchSoon(c, workspaceId, [learnedId]);
    return c.body(null, 204);
  });

  app.openapi(listUnansweredQuestionsRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    return c.json(await listUnansweredQuestions(deps, ctx, websiteId), 200);
  });

  app.openapi(answerUnansweredQuestionRoute, async (c) => {
    const { workspaceId, questionId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    const learned = await answerUnansweredQuestion(deps, ctx, questionId, c.req.valid('json'));
    dispatchSoon(c, workspaceId, [learned.id]);
    return c.json(learned, 201);
  });

  app.openapi(dismissUnansweredQuestionRoute, async (c) => {
    const { workspaceId, questionId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    await dismissUnansweredQuestion(deps, ctx, questionId);
    return c.body(null, 204);
  });

  app.openapi(setLearnedAutoApproveRoute, async (c) => {
    const { workspaceId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    return c.json(await setLearnedAutoApprove(deps, ctx, c.req.valid('json').autoApprove), 200);
  });

  app.openapi(testAssistantRoute, async (c) => {
    const { workspaceId, websiteId } = c.req.valid('param');
    const { deps, ctx } = await scoped(c, workspaceId);
    const body = c.req.valid('json');
    return c.json(await testAssistant(deps, ctx, websiteId, body.question, body.history), 200);
  });
}
