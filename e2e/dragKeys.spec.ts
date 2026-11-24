import { test, expect, type Page } from '@playwright/test';

// Needs the real browser because jsdom runs no pointer gesture on the canvas,
// so neither a Konva drag nor a transformer resize starts.

interface Frame {
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

/** The selection frame in stage px, null without a selection. */
async function frame(page: Page): Promise<Frame | null> {
  return page.evaluate(() => {
    interface Node {
      findOne: (s: string) => Node | undefined;
    }
    interface Transformer extends Node {
      nodes: () => Node[];
      x: () => number;
      y: () => number;
      width: () => number;
      height: () => number;
    }
    const stage = (window as unknown as { Konva?: { stages: Node[] } }).Konva?.stages[0];
    const tr = stage?.findOne('Transformer') as Transformer | undefined;
    if (!tr || tr.nodes().length === 0) return null;
    return { x: Math.round(tr.x()), y: Math.round(tr.y()), width: Math.round(tr.width()), height: Math.round(tr.height()) };
  });
}

/** Adds a Box and nudges it, so the history holds a step before the gesture. */
async function nudgedBox(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await page.getByText('Box', { exact: true }).first().dblclick();
  await expect.poll(() => frame(page)).not.toBeNull();
  const rest = await frame(page);
  if (!rest) throw new Error('no selection');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await frame(page))?.y ?? 0).toBeGreaterThan(rest.y);
  const nudged = await frame(page);
  if (!nudged) throw new Error('no selection');
  const origin = await page.locator('.konvajs-content').boundingBox();
  if (!origin) throw new Error('no canvas');
  return { nudged, origin };
}

for (const key of ['Delete', 'ControlOrMeta+z', 'Shift+ArrowRight']) {
  test(`${key} is ignored during a drag`, async ({ page }) => {
    const { nudged, origin } = await nudgedBox(page);
    const x = origin.x + nudged.x + nudged.width / 2;
    const y = origin.y + nudged.y + nudged.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 6 });
    await page.keyboard.press(key);
    await page.mouse.up();
    await expect.poll(async () => (await frame(page))?.x ?? 0).toBeGreaterThan(nudged.x + 40);

    // One step back is the drag alone, so the key left the history untouched.
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => frame(page)).toEqual(nudged);
    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
  });
}

// The arrow key is left out because the history is paused during a resize,
// so a nudge under it leaves no step of its own.
for (const key of ['Delete', 'ControlOrMeta+z']) {
  test(`${key} is ignored during a resize`, async ({ page }) => {
    const { nudged, origin } = await nudgedBox(page);
    const x = origin.x + nudged.x + nudged.width;
    const y = origin.y + nudged.y + nudged.height;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 40, { steps: 6 });
    await page.keyboard.press(key);
    await page.mouse.up();
    await expect.poll(async () => (await frame(page))?.width ?? 0).toBeGreaterThan(nudged.width + 40);

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => frame(page)).toEqual(nudged);
    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
  });
}
