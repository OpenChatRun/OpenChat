/** The dashboard's Help centre page: finding articles in the list, and the editor's toolbar. */
import { expect, test } from '@playwright/test';
import { OWNER } from './fixtures';
import { signIn } from './helpers';

test('a supervisor writes an article with the toolbar, and finds it in the list', async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto('/help-centre');
  const list = page.getByRole('region', { name: 'Articles' });
  const stamp = Date.now();

  // A new article starts from the top of the list, and opens in the editor.
  await list.getByLabel('Title').fill(`Returns ${stamp}`);
  await list.getByRole('button', { name: 'New article' }).click();
  const body = page.getByLabel('Article', { exact: true });
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  const preview = page.locator('.help-preview');

  await body.fill('Sending it back\nYou have 30 days.\nKeep the box\nKeep the receipt');
  // A heading from wherever the caret is in the line.
  await body.evaluate((area: HTMLTextAreaElement) => area.setSelectionRange(3, 3));
  await toolbar.getByRole('button', { name: 'Heading' }).click();
  await expect(body).toHaveValue(/^## Sending it back\n/);
  await expect(body).toBeFocused();
  await expect(preview.getByRole('heading', { name: 'Sending it back' })).toBeVisible();

  // Bold with the button, and off again with the key.
  const select = (text: string) => body.evaluate((area: HTMLTextAreaElement, words) => area.setSelectionRange(area.value.indexOf(words), area.value.indexOf(words) + words.length), text);
  await select('30 days');
  await toolbar.getByRole('button', { name: 'Bold' }).click();
  await expect(body).toHaveValue(/You have \*\*30 days\*\*\./);
  await expect(preview.locator('strong')).toHaveText('30 days');
  await body.press('ControlOrMeta+b');
  await expect(body).toHaveValue(/You have 30 days\./);

  // A list of the lines selected, and a link with its address ready to type.
  await select('Keep the box\nKeep the receipt');
  await toolbar.getByRole('button', { name: 'Bulleted list' }).click();
  await expect(preview.getByRole('listitem')).toHaveText(['Keep the box', 'Keep the receipt']);
  await select('receipt');
  await toolbar.getByRole('button', { name: 'Link' }).click();
  await page.keyboard.type('https://shop.example/receipts');
  await expect(preview.getByRole('link', { name: 'receipt' })).toHaveAttribute('href', 'https://shop.example/receipts');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /All articles/ }).click();
  await list.getByLabel('Title').fill(`Delivery ${stamp}`);
  await list.getByRole('button', { name: 'New article' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: /All articles/ }).click();

  // The list: by words of the title, and by status.
  const rows = list.getByRole('listitem');
  await list.getByLabel('Search articles').fill(`${stamp}`);
  await expect(rows).toHaveCount(2);
  await list.getByLabel('Search articles').fill(`returns ${stamp}`);
  await expect(rows).toHaveText([new RegExp(`Returns ${stamp}`)]);
  await list.getByLabel('Search articles').fill(`${stamp}`);
  await list.getByLabel('Status').selectOption('published');
  await expect(rows).toHaveText([new RegExp(`Delivery ${stamp}`)]);
  await list.getByLabel('Status').selectOption('draft');
  await expect(rows).toHaveText([new RegExp(`Returns ${stamp}`)]);
  await list.getByLabel('Search articles').fill('nothing is called this');
  await expect(list.getByText('No articles match.')).toBeVisible();
});
