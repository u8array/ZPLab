import { test, expect, type Page } from '@playwright/test';

/** Pins the production wiring: align and smart snap read a barcode's bar box,
 *  so the interpretation line below the bars never pulls the symbol. */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pageErrors: Error[] = [];

test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e));
});

/** Bar image of the one barcode without its selection stroke and the rect of
 *  the one box with its border, both in stage px, so each edge is the model edge. */
async function shapes(page: Page): Promise<{ bars: Box; box: Box } | null> {
  return page.evaluate(() => {
    interface Node {
      id: () => string;
      findOne: (s: string) => Node | undefined;
      getClientRect: (o: { skipStroke: boolean; skipShadow: boolean }) => Box;
    }
    const stage = (window as unknown as { Konva?: { stages: { find: (s: string) => Node[] }[] } }).Konva?.stages[0];
    if (!stage) return null;
    const groups = stage.find('Group').filter((g) => g.id() !== '');
    const bars = groups.map((g) => g.findOne('Image')).find((n) => n);
    const box = groups.find((g) => !g.findOne('Image') && g.findOne('Rect'))?.findOne('Rect');
    if (!bars || !box) return null;
    return {
      bars: bars.getClientRect({ skipStroke: true, skipShadow: true }),
      box: box.getClientRect({ skipStroke: false, skipShadow: true }),
    };
  });
}

/** Both objects insert at the same spot, so the box moves away before anything can snap or align to it. */
async function insertPair(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await page.getByText('Code 128', { exact: true }).first().dblclick();
  await page.getByText('Box', { exact: true }).first().dblclick();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => shapes(page)).not.toBeNull();
}

test('align centres the bars, not the bars plus text', async ({ page }) => {
  await insertPair(page);
  await page.locator('.konvajs-content').click({ button: 'right', position: { x: 5, y: 5 } });
  await page.getByText('Select all', { exact: true }).click();
  await page.getByRole('button', { name: 'Align vertical centers' }).last().click();
  await expect
    .poll(async () => {
      const s = (await shapes(page)) as { bars: Box; box: Box };
      return Math.round(s.bars.y + s.bars.height / 2 - (s.box.y + s.box.height / 2));
    })
    .toBe(0);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('dragging snaps the bar bottom to a neighbour top edge', async ({ page }) => {
  await insertPair(page);
  const origin = (await page.locator('.konvajs-content').boundingBox()) as { x: number; y: number };
  const before = (await shapes(page)) as { bars: Box; box: Box };
  const from = { x: origin.x + before.bars.x + before.bars.width / 2, y: origin.y + before.bars.y + before.bars.height / 2 };
  // The 3 px gap stays inside the snap threshold.
  const dy = before.box.y - 3 - (before.bars.y + before.bars.height);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + 10, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const s = (await shapes(page)) as { bars: Box; box: Box };
      return s.bars.y + s.bars.height - s.box.y;
    })
    .toBe(0);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});
