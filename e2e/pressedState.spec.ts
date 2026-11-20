import { test, expect, type Page } from '@playwright/test';

// jsdom loads no stylesheet, so only the browser shows whether a class produced a rule.

const accentDim = async (page: Page) => {
  const colour = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--color-accent-dim)';
    document.body.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  });
  expect(colour).not.toBe('rgba(0, 0, 0, 0)');
  return colour;
};

test('a pressed view toggle gets the dim accent background', async ({ page }) => {
  await page.goto('/');
  const grid = page.getByRole('button', { name: 'Grid', exact: true });
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await expect(grid).toHaveCSS('background-color', await accentDim(page));
});

test('the data mode badge gets the dim accent background in preview mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Variables' }).click();
  await page.getByRole('button', { name: 'Add variable' }).click();
  const sidebar = page.locator('aside').filter({ has: page.getByRole('tablist') });
  const badge = sidebar.getByRole('button', { name: 'Preview', exact: true });
  await expect(badge).toHaveCSS('background-color', await accentDim(page));
});
