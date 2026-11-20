import { test, expect } from '@playwright/test';

test('a key on a dialog button keeps the canvas selection and the view', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Box', { exact: true }).first().dblclick();
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  const output = page.getByRole('region', { name: 'ZPL' }).getByRole('textbox');
  await expect(output).toContainText('^GB');
  const zpl = await output.innerText();
  const grid = page.getByRole('button', { name: 'Grid', exact: true });
  await expect(grid).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().focus();
  for (const key of ['Shift+ArrowRight', 'Delete']) {
    await page.keyboard.press(key);
    expect.soft(await output.innerText(), key).toBe(zpl);
  }
  await page.keyboard.press('g');
  await expect(grid).toHaveAttribute('aria-pressed', 'false');

  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => output.innerText()).not.toBe(zpl);
});

test('Escape on a dialog closes it and keeps the preview', async ({ page }) => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  await page.route('https://api.labelary.com/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from(png, 'base64'),
    }),
  );
  await page.goto('/');
  await page.getByText('Box', { exact: true }).first().dblclick();
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  const preview = page.getByRole('region', { name: 'ZPL' }).getByRole('button', { name: 'Preview', exact: true });
  await preview.click();
  await page.getByRole('button', { name: 'Got it, continue' }).click();
  await expect(preview).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(preview).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Escape');
  await expect(preview).toHaveAttribute('aria-pressed', 'false');
});

test('Escape on a dialog closes it and keeps the RFID position pick', async ({ page }) => {
  await page.goto('/');
  const openSettings = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings…' }).click();
  };
  const dialog = page.getByRole('dialog');
  await openSettings();
  await dialog.getByRole('button', { name: 'Per Label', exact: true }).click();
  await dialog.getByText('RFID', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Set on the label…' }).click();
  const hint = page.getByText('Click the label or drag the guide', { exact: false });
  await expect(hint).toBeVisible();

  // Opening the settings ends the pick, so another dialog goes on top.
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import ZPL' }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(hint).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(hint).toBeHidden();
});
