/** The AGPL source offer and the third-party notices. See docs/operations/licensing.md. */
import { expect, test } from '@playwright/test';
import { nextIp, signIn } from './helpers';
import { OWNER } from './fixtures';

test('the sign-in page and the dashboard offer the source and the notices', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'cf-connecting-ip': nextIp() });
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', /^https:\/\/github\.com\/OrangoLabsLtd\/OpenChat/);
  await expect(footer.getByRole('link', { name: 'Third-party licences' })).toHaveAttribute('href', '/third-party-licenses.txt');
  await signIn(page, OWNER);
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Source code' })).toBeVisible();
});

test('serves the notices for the dashboard and the widget, but not the build output they come from', async ({ request }) => {
  const dashboard = await request.get('/third-party-licenses.txt');
  expect(dashboard.status()).toBe(200);
  expect(await dashboard.text()).toMatch(/^react-dom \d/m);
  const widget = await request.get('/widget/third-party-licenses.txt');
  expect(widget.status()).toBe(200);
  expect(await widget.text()).toMatch(/^preact \d[\s\S]*MIT License/m);
  // An unknown path gets the dashboard page, so the JSON must not come back.
  expect(await (await request.get('/.vite/license.json')).text()).not.toContain('"identifier"');
});

test('an admin is told of a newer release, until they dismiss it', async ({ page }) => {
  // The local Worker has no release version, so it never asks the project's repository. The answer is given here.
  let asked = 0;
  await page.route('**/api/v1/admin/software-update', (route) => {
    asked += 1;
    return route.fulfill({ json: { current: '0.3.0', latest: '0.4.0', updateAvailable: true, releaseUrl: 'https://github.com/OrangoLabsLtd/OpenChat/releases/tag/v0.4.0' } });
  });
  await signIn(page, OWNER);
  const notice = page.getByRole('region', { name: 'New version' });
  await expect(notice).toContainText('OpenChat 0.4.0 is available. This installation runs 0.3.0.');
  await expect(notice.getByRole('link', { name: 'See what is new, and how to upgrade' })).toHaveAttribute('href', 'https://github.com/OrangoLabsLtd/OpenChat/releases/tag/v0.4.0');
  // The answer is kept for a day, so a reload does not ask again.
  await page.reload();
  await expect(notice).toBeVisible();
  expect(asked).toBe(1);
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(notice).toBeHidden();
});
