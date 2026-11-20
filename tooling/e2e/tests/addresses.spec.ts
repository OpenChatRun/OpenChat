import { expect, test } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { AGENT, OWNER, SITE_ORIGIN, WEBSITE_KEY } from './fixtures';
import { nextIp, signIn } from './helpers';

/** A visitor's conversation, made through the API: this file is about the dashboard's addresses. */
async function newConversation(): Promise<string> {
  const post = async (path: string, body: unknown, token?: string) => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { origin: SITE_ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': nextIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    expect(response.status, path).toBeLessThan(300);
    return (await response.json()) as Record<string, string>;
  };
  const { accessToken } = await post('/api/v1/widget/sessions', { websiteKey: WEBSITE_KEY });
  const { id } = await post('/api/v1/widget/conversations', { clientMessageId: crypto.randomUUID(), content: 'Where is my order?' }, accessToken);
  return id!;
}

test('each page has its own address, which a refresh and the back button keep', async ({ page }) => {
  await signIn(page, OWNER);

  await page.getByRole('button', { name: 'Websites', exact: true }).click();
  await expect(page).toHaveURL(/\/websites$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Websites' })).toBeVisible();

  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/workspaces$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Websites' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();

  // The help centre's own pages are at /help/, so the dashboard's Help page is elsewhere.
  await page.goto('/help-centre');
  await expect(page.getByRole('heading', { level: 1, name: 'Help centre' })).toBeVisible();
});

test('an open conversation has its own address', async ({ page }) => {
  const conversationId = await newConversation();
  await signIn(page, OWNER);
  await page.getByRole('button', { name: new RegExp(`Visitor ${conversationId.slice(-6)}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/inbox/${conversationId}$`));
  await page.reload();
  await expect(page.getByRole('list', { name: 'Messages' }).getByText('Where is my order?')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('list', { name: 'Messages' })).toHaveCount(0);
});

test('an admin page address shows someone who is not an admin the inbox', async ({ page }) => {
  await signIn(page, AGENT);
  await page.goto('/admin/people');
  await expect(page.getByRole('region', { name: 'Conversations' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toHaveCount(0);
});
