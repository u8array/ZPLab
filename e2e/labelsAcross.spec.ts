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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CopyNode {
  getClientRect: () => Rect;
}

/** The drawn copies of the repeating objects, as screen rects. */
async function copyRects(page: Page): Promise<Rect[]> {
  return page.evaluate(() => {
    interface Layer {
      find: (s: (n: { id: () => string }) => boolean) => CopyNode[];
    }
    const stage = (window as unknown as { Konva?: { stages: { findOne: (s: string) => Layer | undefined }[] } }).Konva?.stages[0];
    const copies = stage?.findOne('.repeat-copies')?.find((n) => n.id() !== '') ?? [];
    return copies.map((n) => n.getClientRect());
  });
}

test('a repeating group shows and prints on every label, and decouples into groups', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await page.getByText('Labels across', { exact: true }).locator('xpath=following::input[1]').fill('3');
  await expect.poll(async () => (await gapWidths(page)).length).toBe(2);

  await page.getByText('Box', { exact: true }).first().dblclick();
  await page.getByRole('button', { name: 'Expand' }).click();
  await page.keyboard.press('ControlOrMeta+g');
  await page.getByRole('tab', { name: 'Layers' }).click();
  const repeat = page.getByRole('button', { name: 'Repeat on every label', exact: true });
  await repeat.click();
  await expect(repeat).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await zpl(page)).split('^GB').length - 1).toBe(3);
  expect(await copyRects(page)).toHaveLength(2);

  // A click on a copy selects the group, whose menu decouples the copies.
  const canvas = page.locator('.konvajs-content');
  const [copy] = await copyRects(page);
  if (!copy) throw new Error('no copy drawn');
  await canvas.click({ button: 'right', position: { x: copy.x + 2, y: copy.y + copy.height / 2 } });
  await page.getByRole('menu').getByRole('button', { name: 'Decouple copies' }).click();
  expect(await copyRects(page)).toHaveLength(0);
  expect((await zpl(page)).split('^GB').length - 1).toBe(3);
  await expect(page.getByRole('button', { name: 'Repeat on every label', exact: true })).toHaveCount(3);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('a single object repeats without a group, and its copies follow a drag', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await page.getByText('Labels across', { exact: true }).locator('xpath=following::input[1]').fill('3');
  await expect.poll(async () => (await gapWidths(page)).length).toBe(2);

  await page.getByText('Box', { exact: true }).first().dblclick();
  await page.getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Repeat on every label' }).check();
  await expect.poll(async () => (await zpl(page)).split('^GB').length - 1).toBe(3);
  const [first, second] = await copyRects(page);
  if (!first || !second) throw new Error('no copies drawn');

  // The source lies one label step left of its first copy. A quarter down its edge lies no resize handle.
  const box = await page.locator('.konvajs-content').boundingBox();
  if (!box) throw new Error('no canvas');
  const source = { x: box.x + first.x - (second.x - first.x) + 2, y: box.y + first.y + first.height / 4 };
  // Unselected, so the drag itself has to pick the source.
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect.poll(() => page.evaluate(() => {
    interface Stage { find: (s: string) => { nodes: () => unknown[] }[] }
    const stage = (window as unknown as { Konva?: { stages: Stage[] } }).Konva?.stages[0];
    return stage?.find('Transformer').reduce((n, t) => n + t.nodes().length, 0);
  })).toBe(0);
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(source.x + 10, source.y + 30, { steps: 5 });
  await expect.poll(async () => Math.round(((await copyRects(page))[0]?.y ?? 0) - first.y)).toBe(30);
  await page.mouse.up();
});

test('the copies of a locked child stay put while its group is dragged', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await page.getByText('Labels across', { exact: true }).locator('xpath=following::input[1]').fill('3');
  await expect.poll(async () => (await gapWidths(page)).length).toBe(2);

  await page.getByText('Box', { exact: true }).first().dblclick();
  await page.getByText('Text', { exact: true }).first().dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Repeat on every label' }).check();
  await expect.poll(async () => (await copyRects(page)).length).toBe(4);
  await page.getByRole('tab', { name: 'Layers' }).click();
  const expander = page.getByRole('button', { name: 'Ungroup', exact: true }).locator('xpath=preceding::button[@aria-expanded][1]');
  if ((await expander.getAttribute('aria-expanded')) === 'false') await expander.click();
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Lock', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(1);

  // Wider first, so the order is box, box, text, text.
  const sorted = async () => (await copyRects(page)).sort((p, q) => q.width - p.width || p.x - q.x);
  const before = await sorted();
  const box = await page.locator('.konvajs-content').boundingBox();
  const [first, second, third] = before;
  if (!box || !first || !second || !third) throw new Error('no copies drawn');
  // The text lies one label step left of its first copy.
  const source = { x: box.x + third.x - (second.x - first.x) + 2, y: box.y + third.y + third.height / 4 };
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(source.x + 10, source.y + 30, { steps: 5 });
  const moved = async () => (await sorted()).map((r, i) => r.y - (before[i]?.y ?? 0) > 20);
  await expect.poll(moved).toEqual([false, false, true, true]);
  await page.mouse.up();
});

