import { test, expect, type Locator, type Page } from '@playwright/test';

// jsdom lays nothing out, so no bar has a size there.

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const box = async (target: Locator): Promise<Box> => {
  const b = await target.boundingBox();
  if (!b) throw new Error('not rendered');
  return b;
};

const buttonBox = (page: Page, name: string) => box(page.getByRole('button', { name, exact: true }));

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('the page buttons lie clear of the view bar at the default window', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add page' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible();

  const grid = await buttonBox(page, 'Grid');
  for (const name of ['Next page (Page Down)', 'Delete page']) {
    expect(overlap(await buttonBox(page, name), grid), name).toBe(false);
  }
});

test.describe(() => {
  // Slovak's snap label is long enough that 600 px makes the bar narrower than it.
  test.use({ locale: 'sk-SK' });

  // At 820 px the bar wraps between its groups.
  for (const width of [820, 600]) {
    test(`the view bar keeps every control inside the canvas at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto('/');
      const canvas = await box(page.locator('main'));
      const controls = await page.locator('main button').all();
      expect(controls.length).toBeGreaterThanOrEqual(7);
      for (const control of controls) {
        const b = await box(control);
        expect(b.x).toBeGreaterThanOrEqual(canvas.x);
        expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width);
        expect(b.y).toBeGreaterThanOrEqual(canvas.y);
      }
    });
  }
});
