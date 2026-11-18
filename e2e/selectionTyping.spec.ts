import { test, expect, type Page } from '@playwright/test';

async function dropOnCanvas(page: Page, entry: string) {
  const row = page.getByText(entry, { exact: true }).first();
  await expect(row).toBeVisible();
  const from = await row.boundingBox();
  const canvas = await page.locator('.konvajs-content').boundingBox();
  if (!from || !canvas) throw new Error('Palette row or canvas is missing');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 15 });
  await page.mouse.up();
}

for (const collapsed of [false, true]) {
  test(`typing immediately after a text drop works with Properties ${collapsed ? 'collapsed' : 'open'}`, async ({ page }) => {
    await page.addInitScript((closed) => localStorage.setItem('zpl-panel-right', closed ? '1' : '0'), collapsed);
    await page.goto('/');
    if (!collapsed) await page.getByRole('searchbox').fill('text');
    await dropOnCanvas(page, 'Text');

    const editor = page.getByRole('textbox', { name: 'Type text or insert a variable…' });
    const hasCaret = await editor.evaluate(async (field) => {
      await new Promise(requestAnimationFrame);
      const selection = window.getSelection();
      return selection?.isCollapsed === true && field.contains(selection.anchorNode);
    });
    expect(hasCaret).toBe(true);
    await page.keyboard.press('g');
    const properties = page.getByRole('tab', { name: 'Properties' });
    await expect(properties).toHaveAttribute('aria-selected', 'true');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('g');
    await editor.pressSequentially('Sr 123x');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('€');
    await expect(editor).toHaveText('gSr 123€');

    await page.getByRole('tab', { name: 'Layers' }).click();
    await properties.click();
    await expect(properties).toBeFocused();
    await page.getByRole('region', { name: 'Label', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(editor).toBeFocused();

    await page.getByRole('button', { name: 'Expand', exact: true }).click();
    const output = page.getByRole('region', { name: 'ZPL' }).getByRole('textbox');
    await expect(output).toContainText('^FDgSr 123');
  });
}

test('dropping Code 128 accepts typing and Enter and double-click select its content', async ({ page }) => {
  await page.goto('/');
  const grid = page.getByRole('button', { name: 'Grid', exact: true });
  const gridBefore = await grid.getAttribute('aria-pressed');
  await page.getByRole('tab', { name: 'Layers' }).click();
  await dropOnCanvas(page, 'Code 128');
  await page.keyboard.press('g');
  const editor = page.getByRole('textbox', { name: 'Type text or insert a variable…' });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('g');
  expect(await grid.getAttribute('aria-pressed')).toBe(gridBefore);

  await page.getByRole('region', { name: 'Label', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(editor).toBeFocused();
  await page.keyboard.type('ABC 123');
  await expect(editor).toHaveText('ABC 123');

  const point = await page.locator('.konvajs-content').evaluate((canvas) => {
    interface Stage {
      findOne: (name: string) => { getClientRect: () => { x: number; y: number; width: number; height: number } } | undefined;
    }
    const stage = (window as unknown as { Konva?: { stages: Stage[] } }).Konva?.stages[0];
    const bars = stage?.findOne('Image');
    if (!bars) throw new Error('Rendered barcode is missing');
    const { x, y, width, height } = bars.getClientRect();
    const { left, top } = canvas.getBoundingClientRect();
    return { x: left + x + width / 2, y: top + y + height / 2 };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect(editor).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('ABC 123');
  await page.keyboard.press('x');
  await expect(editor).toHaveText('x');
});

test('a selected text field leaves the menu and canvas keys available', async ({ page }) => {
  await page.goto('/');
  await dropOnCanvas(page, 'Text');
  const editor = page.getByRole('textbox', { name: 'Type text or insert a variable…' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Hello');

  const rotation = page.getByRole('button', { name: 'Rotation', exact: true });
  await rotation.click();
  await expect(page.getByRole('listbox')).toBeFocused();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await expect(rotation).toHaveText('180°');
  await rotation.click();
  await expect(page.getByRole('listbox')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(rotation).toHaveText('90°');
  await expect(editor).toHaveText('Hello');

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('menu')).toBeFocused();
  await page.keyboard.press('i');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  const canvas = page.getByRole('region', { name: 'Label', exact: true });
  await canvas.focus();
  for (const [key, name] of [['g', 'Grid'], ['s', 'Snap']]) {
    const button = page.getByRole('button', { name, exact: true });
    const pressed = await button.getAttribute('aria-pressed');
    await page.keyboard.press(key);
    await expect(button).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
  }
  await page.keyboard.press('r');
  await expect(page.getByRole('button', { name: 'Rotate view' })).toContainText('90°');
  await page.keyboard.down('Space');
  await expect(canvas).toHaveCSS('cursor', 'grab');
  await page.keyboard.up('Space');
  await expect(editor).toHaveText('Hello');
  await page.keyboard.press('Backspace');
  await expect(editor).toBeHidden();
});

test('double-click and Enter preserve an imported field binding', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import ZPL' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('^XA\n^FO50,50^A0N,30,0^FN1^FDJohn Doe^FS\n^XZ');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();

  const point = await page.locator('.konvajs-content').evaluate((canvas) => {
    interface TextNode {
      text: () => string;
      getClientRect: () => { x: number; y: number; width: number; height: number };
    }
    const stage = (window as unknown as { Konva?: { stages: { find: (type: string) => TextNode[] }[] } }).Konva?.stages[0];
    const field = stage?.find('Text').find((node) => node.text() === 'John Doe');
    if (!field) throw new Error('Imported field is missing from the canvas');
    const { x, y, width, height } = field.getClientRect();
    const { left, top } = canvas.getBoundingClientRect();
    return { x: left + x + width / 2, y: top + y + height / 2 };
  });
  const editor = page.getByRole('textbox', { name: 'Type text or insert a variable…' });
  await page.mouse.dblclick(point.x, point.y);
  await expect(editor).toBeFocused();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('region', { name: 'Label', exact: true })).toBeFocused();
  await page.keyboard.press('g');
  await page.keyboard.press('Enter');
  await expect(editor).toBeFocused();

  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  const output = page.getByRole('region', { name: 'ZPL' }).getByRole('textbox');
  await expect(output).toContainText('^FN1^FDJohn Doe^FS');
});
