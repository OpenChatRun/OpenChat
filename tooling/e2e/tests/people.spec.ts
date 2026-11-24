import { expect, test, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { AGENT, OWNER, PASSWORD, SITE_ORIGIN, WEBSITE_KEY, WORKSPACE_ID } from './fixtures';
import { nextIp, signIn } from './helpers';

const post = async (path: string, token: string | undefined, body: unknown, origin?: string) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextIp(), ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  expect(response.status, path).toBeLessThan(300);
  return (await response.json()) as Record<string, string>;
};

/** A conversation with a reply from the agent, played through the API. */
async function conversationAnsweredByAgent(reply: string) {
  const { accessToken: visitor } = await post('/api/v1/widget/sessions', undefined, { websiteKey: WEBSITE_KEY }, SITE_ORIGIN);
  const { id } = await post('/api/v1/widget/conversations', visitor, { clientMessageId: crypto.randomUUID(), content: `Question for ${reply}` }, SITE_ORIGIN);
  const { accessToken: agent } = await post('/api/v1/auth/login', undefined, { email: AGENT.email, password: PASSWORD, clientType: 'mobile' });
  await post(`/api/v1/workspaces/${WORKSPACE_ID}/conversations/${id}/messages`, agent, { clientMessageId: crypto.randomUUID(), type: 'text', content: reply });
  return `Question for ${reply}`;
}

const openPeople = async (page: Page) => {
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.getByRole('region', { name: 'People' })).toBeVisible();
};
const card = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true });
/** A row opens to show its workspaces and access. */
const open = async (page: Page, name: string) => {
  const person = card(page, name);
  const toggle = person.locator('button[aria-expanded]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return person;
};

test.describe('People', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => void dialog.accept());
  });

  test('an installation admin adds someone and assigns them to a workspace', async ({ page }) => {
    await signIn(page, OWNER);
    await openPeople(page);
    const name = `Newcomer ${Date.now()}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Email', { exact: true }).fill(`newcomer-${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('a link to choose a password');

    const person = card(page, name);
    await person.getByLabel(`Role to give ${name}`).selectOption('supervisor');
    await person.getByRole('button', { name: 'Add to workspace' }).click();
    await expect(person.getByLabel(`Role for ${name} in E2E`)).toHaveValue('supervisor');

    await person.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(person.getByLabel(`Role for ${name} in E2E`)).toBeHidden();
  });

  test('a removed agent keeps their name on messages, marked as removed, until brought back', async ({ page }) => {
    const reply = `Answered ${Date.now()}`;
    const question = await conversationAnsweredByAgent(reply);
    await signIn(page, OWNER);
    await openPeople(page);
    const person = await open(page, AGENT.name);
    await person.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(person.getByLabel(`Role for ${AGENT.name} in E2E`)).toBeHidden();

    await page.getByRole('button', { name: 'People', exact: true }).click();
    await page.getByRole('button', { name: 'Members', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: AGENT.email }).getByText('Removed', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    // Newest first, and this one has just had a message.
    await page.getByRole('region', { name: 'Conversations' }).getByRole('listitem').first().getByRole('button').click();
    await expect(page.getByText(question)).toBeVisible();
    await expect(page.getByText(`${AGENT.name} (Removed)`).first()).toBeVisible();

    await openPeople(page);
    await open(page, AGENT.name);
    await person.getByRole('button', { name: 'Add to workspace' }).click();
    await expect(person.getByLabel(`Role for ${AGENT.name} in E2E`)).toHaveValue('agent');
  });

  test('an admin creates a workspace and adds a website, with no way into its inbox until they join', async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
    const name = `Team ${Date.now()}`;
    await page.getByLabel('New workspace name').fill(name);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByLabel('Workspace to manage')).toHaveValue(/.+/);
    await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue(name);

    const manage = page.getByRole('region', { name: 'Manage workspaces' });
    await manage.getByRole('tab', { name: 'Websites' }).click();
    await manage.getByRole('button', { name: 'Add website' }).click();
    await manage.getByLabel('Name', { exact: true }).fill('Team site');
    await manage.getByRole('button', { name: 'Add website' }).click();
    // A new website opens on how to install it.
    await expect(manage.getByRole('heading', { name: 'Team site' })).toBeVisible();
    await expect(manage.getByRole('button', { name: 'Copy code' })).toBeVisible();

    // Not in the list of workspaces this admin can open.
    await expect(page.getByLabel('Workspace', { exact: true }).getByRole('option', { name })).toHaveCount(0);
    await openPeople(page);
    const me = await open(page, OWNER.name);
    await me.getByLabel(`Workspace to add ${OWNER.name} to`).selectOption({ label: name });
    await me.getByRole('button', { name: 'Add to workspace' }).click();
    await expect(page.getByLabel('Workspace', { exact: true }).getByRole('option', { name })).toHaveCount(1);
  });

  test('an admin finds people by name or email, and filters to admins', async ({ page }) => {
    await signIn(page, OWNER);
    await openPeople(page);
    const region = page.getByRole('region', { name: 'People' });
    await region.getByLabel('Search by name or email').fill(AGENT.email.toUpperCase());
    await expect(card(page, AGENT.name)).toBeVisible();
    await expect(card(page, OWNER.name)).toBeHidden();
    await region.getByLabel('Search by name or email').fill('nobody-by-this-name');
    await expect(region.getByText('Nobody matches.')).toBeVisible();
    await region.getByLabel('Search by name or email').fill('');
    await region.getByRole('button', { name: /^Admins/ }).click();
    await expect(card(page, OWNER.name)).toBeVisible();
    await expect(card(page, AGENT.name)).toBeHidden();
  });

  test('an agent has no admin pages, and sees members and websites without any controls', async ({ page }) => {
    await signIn(page, AGENT);
    await expect(page.getByRole('button', { name: 'People', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Workspaces', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Members', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: OWNER.email })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Role for/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Websites', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy code' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Settings for/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add website' })).toHaveCount(0);
  });

  test('a deactivated account cannot sign in until it is reactivated', async ({ page, browser }) => {
    await signIn(page, OWNER);
    await openPeople(page);
    const person = await open(page, AGENT.name);
    await person.getByRole('button', { name: 'Deactivate account' }).click();
    await expect(person.getByText('Deactivated', { exact: true })).toBeVisible();

    const attempt = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: JSON.stringify({ email: AGENT.email, password: PASSWORD, clientType: 'mobile' }),
    });
    expect(attempt.status).toBe(401);

    await person.getByRole('button', { name: 'Reactivate account' }).click();
    await expect(person.getByText('Deactivated', { exact: true })).toBeHidden();
    const context = await browser.newContext();
    const agent = await context.newPage();
    await signIn(agent, AGENT);
    await expect(agent.getByRole('button', { name: 'People', exact: true })).toBeHidden();
    await context.close();
  });
});
