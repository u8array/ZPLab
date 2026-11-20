import { test, expect, type Page } from '@playwright/test';

// Needs the real browser because the guides are Konva nodes, which jsdom does not draw.

interface Line {
  vertical: boolean;
  px: number;
}

const RULER = 20;
const pageErrors: Error[] = [];

test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e));
});

/** The guide lines on the stage, the draft badge text and the selection frame. */
async function canvas(page: Page) {
  return page.evaluate(() => {
    interface Node {
      find: (s: string) => Node[];
      findOne: (s: string) => Node | undefined;
      points: () => number[];
      getText: () => { text: () => string };
      nodes: () => Node[];
      getClientRect: (o: { skipStroke: boolean; skipShadow: boolean }) => { x: number; y: number; width: number; height: number };
    }
    const stage = (window as unknown as { Konva?: { stages: Node[] } }).Konva?.stages[0];
    const lines = (stage?.find('.ruler-guide') ?? []).map((line): Line => {
      const [x1, y1, x2] = line.points();
      return x1 === x2 ? { vertical: true, px: x1 ?? NaN } : { vertical: false, px: y1 ?? NaN };
    });
    return {
      lines,
      marks: stage?.find('.ruler-guide-mark').length ?? 0,
      badge: stage?.findOne('.ruler-guide-badge')?.getText().text() ?? null,
      selected: (stage?.findOne('Transformer')?.nodes().length ?? 0) > 0,
      frame: stage?.findOne('Transformer')?.findOne('.back')?.getClientRect({ skipStroke: true, skipShadow: true }) ?? null,
    };
  });
}

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  const origin = await page.locator('.konvajs-content').boundingBox();
  if (!origin) throw new Error('no canvas');
  return origin;
}

test('a guide comes out of a ruler, moves by its mark and drops back on a ruler', async ({ page }) => {
  const origin = await open(page);

  await page.mouse.move(origin.x + 300, origin.y + RULER / 2);
  await page.mouse.down();
  await page.mouse.move(origin.x + 300, origin.y + 200, { steps: 6 });
  await expect.poll(async () => (await canvas(page)).badge).toMatch(/^[\d.]+ mm$/);
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).lines).toHaveLength(1);
  const placed = (await canvas(page)).lines[0] as Line;
  expect(placed.vertical).toBe(false);
  expect(Math.abs(placed.px - 200)).toBeLessThanOrEqual(2);
  expect((await canvas(page)).marks).toBe(1);
  expect((await canvas(page)).badge).toBeNull();

  // A level guide is grabbed on the left ruler, where its mark sits.
  await page.mouse.move(origin.x + RULER / 2, origin.y + placed.px);
  await page.mouse.down();
  await page.mouse.move(origin.x + RULER / 2, origin.y + placed.px + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).lines[0]?.px ?? 0).toBeGreaterThan(placed.px + 50);
  expect((await canvas(page)).lines).toHaveLength(1);
  const moved = (await canvas(page)).lines[0] as Line;

  await page.mouse.move(origin.x + RULER / 2, origin.y + moved.px);
  await page.mouse.down();
  await page.mouse.move(origin.x + RULER / 2, origin.y + RULER / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).lines).toHaveLength(0);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('a guide from the left ruler stands upright and survives a reload', async ({ page }) => {
  const origin = await open(page);
  await page.mouse.move(origin.x + RULER / 2, origin.y + 300);
  await page.mouse.down();
  await page.mouse.move(origin.x + 260, origin.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).lines).toHaveLength(1);
  const placed = (await canvas(page)).lines[0] as Line;
  expect(placed.vertical).toBe(true);

  await page.reload();
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await expect.poll(async () => (await canvas(page)).lines).toEqual([placed]);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('pulling a guide out leaves the selection alone', async ({ page }) => {
  const origin = await open(page);
  await page.getByText('Code 128', { exact: true }).first().dblclick();
  await expect.poll(async () => (await canvas(page)).selected).toBe(true);

  await page.mouse.move(origin.x + 300, origin.y + RULER / 2);
  await page.mouse.down();
  await page.mouse.move(origin.x + 300, origin.y + 120, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).lines).toHaveLength(1);
  expect((await canvas(page)).selected).toBe(true);

  // Beside the label the release lands on the bare stage.
  const bare = { x: 40, y: 300 };
  expect(
    await page.evaluate((at) => {
      interface Stage {
        getIntersection: (p: { x: number; y: number }) => unknown;
      }
      return (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages[0].getIntersection(at) === null;
    }, bare),
  ).toBe(true);
  await page.mouse.move(origin.x + bare.x, origin.y + RULER / 2);
  await page.mouse.down();
  await page.mouse.move(origin.x + bare.x, origin.y + bare.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).lines).toHaveLength(2);
  expect((await canvas(page)).selected).toBe(true);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('a moved and a resized object snap to a guide', async ({ page }) => {
  const origin = await open(page);
  for (const x of [400, 560]) {
    await page.mouse.move(origin.x + RULER / 2, origin.y + 300);
    await page.mouse.down();
    await page.mouse.move(origin.x + x, origin.y + 300, { steps: 6 });
    await page.mouse.up();
  }
  await expect.poll(async () => (await canvas(page)).lines).toHaveLength(2);
  const [left, right] = (await canvas(page)).lines.map((line) => line.px).sort((a, b) => a - b) as [number, number];

  await page.getByText('Box', { exact: true }).first().dblclick();
  await expect.poll(async () => (await canvas(page)).frame).not.toBeNull();
  const start = (await canvas(page)).frame;
  if (!start) throw new Error('no frame');

  // Released three px short, inside the snap reach.
  const grab = { x: origin.x + start.x + start.width / 2, y: origin.y + start.y + start.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + (left + 3 - start.x), grab.y + 150, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(((await canvas(page)).frame?.x ?? 0) - left)).toBeLessThanOrEqual(1);
  const moved = (await canvas(page)).frame;
  if (!moved) throw new Error('no frame');

  const handle = { x: origin.x + moved.x + moved.width, y: origin.y + moved.y + moved.height / 2 };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + right - 3, handle.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const frame = (await canvas(page)).frame;
      return frame ? Math.abs(frame.x + frame.width - right) : 99;
    })
    .toBeLessThanOrEqual(1);
  expect(Math.abs(((await canvas(page)).frame?.x ?? 0) - left)).toBeLessThanOrEqual(1);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('a press on a ruler stays off the object that lies under it', async ({ page }) => {
  const origin = await open(page);
  await page.getByText('Code 128', { exact: true }).first().dblclick();
  await expect.poll(async () => (await canvas(page)).frame).not.toBeNull();
  const placed = (await canvas(page)).frame;
  if (!placed) throw new Error('no frame');

  // Zoomed in, the label runs under the top ruler. The barcode moves up until the ruler covers its top.
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '+', exact: true }).click();
  await page.getByRole('region', { name: 'Label', exact: true }).focus();
  await expect(async () => {
    await page.keyboard.press('Shift+ArrowUp');
    expect((await canvas(page)).frame?.y ?? 99).toBeLessThan(RULER / 2);
  }).toPass({ timeout: 5000 });
  expect((await canvas(page)).selected).toBe(true);
  const under = (await canvas(page)).frame;
  if (!under) throw new Error('no frame');

  await page.mouse.move(origin.x + under.x + under.width / 2, origin.y + RULER / 2);
  await page.mouse.down();
  await page.mouse.move(origin.x + under.x + under.width / 2, origin.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).lines).toHaveLength(1);
  expect((await canvas(page)).frame).toEqual(under);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('a click on a mark leaves the guide in place, a drag off the canvas removes it', async ({ page }) => {
  const origin = await open(page);
  await page.mouse.move(origin.x + RULER / 2, origin.y + 300);
  await page.mouse.down();
  await page.mouse.move(origin.x + 260, origin.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).lines).toHaveLength(1);
  const placed = (await canvas(page)).lines[0] as Line;

  // Three px beside the mark, still inside the grab reach.
  await page.mouse.click(origin.x + placed.px + 3, origin.y + RULER / 2);
  expect((await canvas(page)).lines).toEqual([placed]);

  await page.mouse.move(origin.x + placed.px, origin.y + RULER / 2);
  await page.mouse.down();
  await page.mouse.move(origin.x - 40, origin.y + 200, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).lines).toHaveLength(0);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('Escape drops the guide being dragged', async ({ page }) => {
  const origin = await open(page);
  await page.mouse.move(origin.x + 300, origin.y + RULER / 2);
  await page.mouse.down();
  await page.mouse.move(origin.x + 300, origin.y + 200, { steps: 6 });
  await expect.poll(async () => (await canvas(page)).badge).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await canvas(page)).badge).toBeNull();
  await page.mouse.up();
  expect((await canvas(page)).lines).toHaveLength(0);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});
