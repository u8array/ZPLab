import { test, expect, type Page } from '@playwright/test';

/** Guards the one otherwise-unwatched class: the production bundle in a real
 *  browser. DOM-only; canvas interactions are out of scope (brittle). */

// Non-default dimensions (default label is 100x60), so the resize assertion
// actually proves ^PW/^LL were applied.
const SAMPLE_ZPL = '^XA\n^PW640\n^LL320\n^FO50,50^A0N,30,0^FDHello World^FS\n^XZ';

const pageErrors: Error[] = [];

test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e));
});

const openFileMenu = async (page: Page) => {
  await page.getByRole('button', { name: 'File', exact: true }).click();
};

test('boots, imports ZPL, adds a page, and regenerates output', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();

  await openFileMenu(page);
  await page.getByRole('button', { name: 'Import ZPL' }).click();
  await page.getByRole('textbox').fill(SAMPLE_ZPL);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  // A clean import closes the dialog; a summary/choice view staying open
  // would mean the sample produced findings.
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('80 × 40 mm')).toBeVisible();

  // The output panel defaults to collapsed.
  await page.getByRole('button', { name: 'Expand' }).click();
  const output = page.locator('pre').first();
  await expect(output).toContainText('^FDHello World');
  await expect(output).toContainText('^PW640');

  await openFileMenu(page);
  await page.getByRole('button', { name: 'Add page' }).click();
  // Focus moves onto the inserted page (2 / 2) and it starts empty: exactly
  // two pages, and the imported field exactly once (a duplicated or in-place
  // mutated page would double it or keep the pager on 1).
  await expect(page.getByText('2 / 2')).toBeVisible();
  await expect
    .poll(async () => {
      const text = (await page.locator('pre').allInnerTexts()).join('');
      return {
        pages: text.split('^XA').length - 1,
        fields: text.split('^FDHello World').length - 1,
      };
    })
    .toEqual({ pages: 2, fields: 1 });

  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});
