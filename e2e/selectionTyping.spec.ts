import { test, expect } from '@playwright/test';

for (const entry of ['Text', 'Code 128', 'Box']) {
  test(`typing after dropping ${entry} edits content without opening Properties`, async ({ page }) => {
    await page.addInitScript((collapsed) => localStorage.setItem('zpl-panel-right', collapsed), entry === 'Code 128' ? '0' : '1');
    await page.goto('/');
    if (entry === 'Code 128') await page.getByRole('tab', { name: 'Layers', exact: true }).click();
    const row = page.getByText(entry, { exact: true }).first();
    const from = await row.boundingBox();
    const canvas = await page.locator('.konvajs-content').boundingBox();
    if (!from || !canvas) throw new Error('Palette row or canvas is missing');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 15 });
    await page.mouse.up();

    const properties = page.getByRole('tab', { name: 'Properties', exact: true });
    await page.keyboard.type('gSr 123x');
    await page.keyboard.press('Backspace');
    if (entry === 'Code 128') await expect(properties).toHaveAttribute('aria-selected', 'false');
    else await expect(properties).toBeHidden();
    // Inspect generated ZPL, not a contenteditable DOM that might never save.
    await page.getByRole('button', { name: 'Expand', exact: true }).last().click();
    const output = page.getByRole('region', { name: 'ZPL', exact: true }).getByRole('textbox');
    if (entry === 'Box') {
      await expect(output).not.toContainText('^FD');
    } else {
      await expect(output).toContainText('^FDgSr 123');
      await page.keyboard.press('ControlOrMeta+z');
      await expect(output).toContainText('^FDgSr 123x');
    }
  });
}
