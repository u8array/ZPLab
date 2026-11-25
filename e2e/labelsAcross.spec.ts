import { test, expect, type Page } from '@playwright/test';

// Needs the real browser because the gaps are drawn on the canvas, which jsdom does not render.

const pageErrors: Error[] = [];

test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e));
});

/** Width in stage px of each gap the canvas draws, left to right. */
async function gapWidths(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    interface Node {
      find: (s: string) => Node[];
      x: () => number;
      width: () => number;
    }
    const stage = (window as unknown as { Konva?: { stages: Node[] } }).Konva?.stages[0];
    const gaps = stage?.find('.across-gap') ?? [];
    return [...gaps].sort((a, b) => a.x() - b.x()).map((r) => Math.round(r.width()));
  });
}

async function zpl(page: Page): Promise<string> {
  return (await page.getByRole('region', { name: 'ZPL' }).getByRole('textbox').allInnerTexts()).join('');
}

test('a row of three labels shows the gaps and keeps the ZPL unchanged', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  expect(await gapWidths(page)).toEqual([]);

  // The input carries no accessible name, so its caption leads to it.
  await page.getByText('Labels across', { exact: true }).locator('xpath=following::input[1]').fill('3');
  await expect(page.getByText(/^Label width/)).toBeVisible();
  await expect.poll(async () => (await gapWidths(page)).length).toBe(2);
  const [first, second] = await gapWidths(page);
  expect(first).toBeGreaterThan(0);
  expect(second).toBe(first);

  await page.getByText('Box', { exact: true }).first().dblclick();
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect.poll(async () => (await zpl(page)).split('^GB').length - 1).toBe(1);
  expect(await zpl(page)).toContain('^PW800');
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});
