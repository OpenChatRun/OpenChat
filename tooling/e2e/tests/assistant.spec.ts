/**
 * The Assistant page's layout. The Worker under test has no Workers AI, so it says the assistant is unavailable;
 * here the page is given what an installation with one answers, to show its tabs. What the API itself does is
 * tested in services/api, and on real Cloudflare.
 */
import { expect, test, type Page } from '@playwright/test';
import { OWNER } from './fixtures';
import { signIn } from './helpers';

const source = (id: string, title: string, status: string) => ({ id, kind: 'page', title, url: `https://shop.example/${id}`, status, errorCode: null, chunkCount: 12, pageCount: 3, indexedAt: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });

async function withAssistant(page: Page) {
  const settings = { name: 'Robin', model: null as string | null, enabled: false, learn: true };
  const saved: unknown[] = [];
  await page.route('**/api/v1/workspaces/*/websites/*/assistant', (route) =>
    route.fulfill({
      json: {
        available: true,
        canReply: true,
        models: [{ id: 'm', label: 'Model' }],
        defaultModel: 'm',
        settings,
        sources: [source('faq', 'Questions and answers', 'ready'), source('returns', 'Returns', 'indexing')],
        helpArticles: { published: 4, inUse: 3 },
        learning: { autoApprove: false, pending: 2, approved: 5, rejected: 1 },
        limits: { sourcesPerWebsite: 20, pagesPerSource: 50, textSourceChars: 20000, turnsPerConversation: 5 },
      },
    }),
  );
  await page.route('**/api/v1/workspaces/*/websites/*/assistant/settings', (route) => {
    Object.assign(settings, route.request().postDataJSON());
    saved.push(route.request().postDataJSON());
    return route.fulfill({ json: settings });
  });
  await page.route('**/api/v1/workspaces/*/websites/*/assistant/learned?*', (route) => route.fulfill({ json: { data: [] } }));
  return saved;
}

test('the assistant page is in tabs, with its switch on the overview', async ({ page }) => {
  const saved = await withAssistant(page);
  await signIn(page, OWNER);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Assistant', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Assistant' });
  await expect(tabs.getByRole('tab')).toHaveText(['Overview', 'Knowledge2', 'Try it', 'Settings', 'Translation']);
  const panel = page.locator('#assistant-panel');

  // The overview: its name, whether it answers, and what it has.
  await expect(panel.getByRole('heading', { name: 'Robin' })).toBeVisible();
  await expect(panel.getByText('Not answering visitors')).toBeVisible();
  await expect(panel.getByText('1 / 2')).toBeVisible();
  await expect(panel.getByText('3 / 4')).toBeVisible();
  await expect(panel.getByText('Waiting for review: 2')).toBeVisible();
  await panel.getByRole('button', { name: 'Turn on' }).click();
  await expect(panel.getByText('Answering visitors', { exact: true })).toBeVisible();
  // The switch changes nothing else, and never chooses a model.
  expect(saved).toEqual([{ name: 'Robin', model: null, enabled: true, learn: true }]);
  await expect(panel.getByRole('button', { name: 'Turn off' })).toBeVisible();

  // Knowledge: the forms open from buttons.
  await tabs.getByRole('tab', { name: /Knowledge/ }).click();
  await expect(panel.getByText('Questions and answers')).toBeVisible();
  await expect(panel.getByLabel('Web page address')).toBeHidden();
  await panel.getByRole('button', { name: 'Add web page' }).click();
  await expect(panel.getByLabel('Web page address')).toBeFocused();
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await panel.getByRole('button', { name: 'Add text' }).click();
  await expect(panel.getByLabel('Title')).toBeFocused();
  await expect(panel.getByRole('region', { name: 'Learned answers' })).toBeVisible();

  // Settings: a name and learning, with no model to choose, and answering left as it is.
  await tabs.getByRole('tab', { name: 'Settings' }).click();
  await expect(panel.getByRole('region', { name: 'Settings' }).getByRole('combobox')).toHaveCount(0);
  await panel.getByLabel('Name visitors will see').fill('Robin the helper');
  await panel.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(() => saved.at(-1)).toEqual({ name: 'Robin the helper', model: null, enabled: true, learn: true });

  await tabs.getByRole('tab', { name: 'Try it' }).click();
  await expect(panel.getByLabel('Question')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Translation' }).click();
  await expect(panel.getByRole('region', { name: 'Automatic translation' })).toBeVisible();
});
