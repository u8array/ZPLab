import { test, expect, type Page } from '@playwright/test';

interface Rect {
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

/** The transformer frame and the centers of the line handles, in stage px. */
async function chrome(page: Page) {
  return page.evaluate(() => {
    interface Node {
      find: (s: string) => Node[];
      findOne: (s: string) => Node | undefined;
      getClientRect: (o: { skipStroke: boolean; skipShadow: boolean }) => Rect;
    }
    const stage = (window as unknown as { Konva?: { stages: Node[] } }).Konva?.stages[0];
    const rect = (n: Node) => n.getClientRect({ skipStroke: true, skipShadow: true });
    const back = stage?.findOne('Transformer')?.findOne('.back');
    const handles = (stage?.find('.line-handle') ?? []).map(rect).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }));
    return { frame: back ? rect(back) : null, handles };
  });
}

test('a line handle reshapes only its line in a multi-selection', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await page.getByText('Code 128', { exact: true }).first().dblclick();
  await expect.poll(async () => (await chrome(page)).frame).not.toBeNull();
  const code = (await chrome(page)).frame as Rect;

  await page.getByText('Line', { exact: true }).first().dblclick();
  // Below the barcode, clear of its hit area.
  await expect(async () => {
    await page.keyboard.press('Shift+ArrowDown');
    expect((await chrome(page)).handles[0]?.y ?? 0).toBeGreaterThan(code.y + code.height + 30);
  }).toPass({ timeout: 5000 });
  const [start, end] = (await chrome(page)).handles;
  if (!start || !end) throw new Error('no line handles');

  await page.locator('.konvajs-content').click({ button: 'right', position: { x: 5, y: 5 } });
  await page.getByText('Select all', { exact: true }).click();
  await expect.poll(async () => (await chrome(page)).frame?.height ?? 0).toBeGreaterThan(code.height + 20);
  const origin = await page.locator('.konvajs-content').boundingBox();
  if (!origin) throw new Error('no canvas');
  await page.mouse.move(origin.x + start.x, origin.y + start.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + start.x - 40, origin.y + start.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await chrome(page)).handles[0]?.x ?? 0).toBeLessThan(start.x - 30);
  expect((await chrome(page)).handles[1]).toEqual(end);

  await page.mouse.click(origin.x + code.x + code.width / 2, origin.y + code.y + code.height / 2);
  await expect.poll(async () => (await chrome(page)).frame?.height ?? 0).toBeLessThan(code.height + 1);
  const after = (await chrome(page)).frame as Rect;
  expect(Math.abs(after.x - code.x)).toBeLessThanOrEqual(0.51);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});
