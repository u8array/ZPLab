import { test, expect, type Page } from '@playwright/test';

// Needs the real browser because the guides render on Konva layers, which jsdom does not draw.

interface Edges {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Guides {
  lines: Edges;
  frame: Edges;
  xNear: string;
}

const pageErrors: Error[] = [];

test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e));
});

/** Guide lines next to the transformer frame in stage px, null while the guides are hidden. */
async function guides(page: Page): Promise<Guides | null> {
  return page.evaluate(() => {
    interface Rect {
      x: number;
      y: number;
      width: number;
      height: number;
    }
    interface Node {
      findOne: (s: string) => Node | undefined;
      isVisible: () => boolean;
      x: () => number;
      y: () => number;
      getText: () => { text: () => string };
      getClientRect: (o: { skipStroke: boolean; skipShadow: boolean }) => Rect;
    }
    const stage = (window as unknown as { Konva?: { stages: Node[] } }).Konva?.stages[0];
    const line = (name: string) => stage?.findOne(`.line-${name}`);
    const xNear = line('x-near');
    const back = stage?.findOne('Transformer')?.findOne('.back');
    if (!xNear?.isVisible() || !back) return null;
    const b = back.getClientRect({ skipStroke: true, skipShadow: true });
    return {
      lines: {
        minX: xNear.x(),
        maxX: line('x-far')?.x() ?? NaN,
        minY: line('y-near')?.y() ?? NaN,
        maxY: line('y-far')?.y() ?? NaN,
      },
      frame: { minX: b.x, maxX: b.x + b.width, minY: b.y, maxY: b.y + b.height },
      xNear: stage?.findOne('.badge-x-near')?.getText().text() ?? '',
    };
  });
}

/** The guide line snaps to the half pixel, so it sits within half a px of its frame edge. */
function expectOnFrame(g: Guides | null) {
  expect(g).not.toBeNull();
  const { lines, frame } = g as Guides;
  for (const key of ['minX', 'maxX', 'minY', 'maxY'] as const) {
    expect(Math.abs(lines[key] - frame[key]), key).toBeLessThanOrEqual(0.51);
  }
}

/** Stage rects of the two near badges that meet at the ruler corner. */
async function nearBadges(page: Page) {
  return page.evaluate(() => {
    interface Badge {
      x: () => number;
      y: () => number;
      width: () => number;
      height: () => number;
    }
    const stage = (window as unknown as { Konva?: { stages: { findOne: (s: string) => Badge | undefined }[] } }).Konva
      ?.stages[0];
    return ['x', 'y'].map((axis) => {
      const badge = stage?.findOne(`.badge-${axis}-near`);
      return badge ? { x: badge.x(), y: badge.y(), width: badge.width(), height: badge.height() } : null;
    });
  });
}

/** Adds a Box and waits until the guides sit on it. */
async function addBox(page: Page) {
  const before = (await guides(page))?.frame;
  await page.getByText('Box', { exact: true }).first().dblclick();
  await expect.poll(async () => (await guides(page))?.frame).not.toEqual(before);
}

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await page.getByText('Code 128', { exact: true }).first().dblclick();
  const toggle = page.getByRole('button', { name: 'Guides', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await guides(page)).toBeNull();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => guides(page)).not.toBeNull();
  const origin = await page.locator('.konvajs-content').boundingBox();
  if (!origin) throw new Error('no canvas');
  return origin;
}

test('the guides sit on the selection frame at rest, through a drag and after it', async ({ page }) => {
  const origin = await open(page);
  const rest = (await guides(page)) as Guides;
  expectOnFrame(rest);
  expect(rest.xNear).toMatch(/^[\d.]+ mm$/);

  const x = origin.x + (rest.frame.minX + rest.frame.maxX) / 2;
  const y = origin.y + (rest.frame.minY + rest.frame.maxY) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await expect.poll(async () => (await guides(page))?.lines.minX ?? 0).toBeGreaterThan(rest.lines.minX + 30);
  const dragged = (await guides(page)) as Guides;
  expectOnFrame(dragged);
  expect(parseFloat(dragged.xNear)).toBeGreaterThan(parseFloat(rest.xNear));
  await page.mouse.up();
  await expect.poll(async () => (await guides(page))?.xNear).toBe(dragged.xNear);
  expectOnFrame(await guides(page));

  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => parseFloat((await guides(page))?.xNear ?? '0'))
    .toBeGreaterThan(parseFloat(dragged.xNear));
  expectOnFrame(await guides(page));

  await page.locator('.konvajs-content').click({ position: { x: 60, y: 60 } });
  await expect.poll(() => guides(page)).toBeNull();
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('the guides return with a drag that comes back to its grab point', async ({ page }) => {
  const origin = await open(page);
  const rest = (await guides(page)) as Guides;
  const x = origin.x + (rest.frame.minX + rest.frame.maxX) / 2;
  const y = origin.y + (rest.frame.minY + rest.frame.maxY) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await expect.poll(async () => (await guides(page))?.lines.minX ?? 0).toBeGreaterThan(rest.lines.minX + 30);
  await page.mouse.move(x, y);
  await expect.poll(async () => (await guides(page))?.xNear).toBe(rest.xNear);
  expectOnFrame(await guides(page));
  await page.mouse.up();
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('the guides follow the frame of a single object while it resizes', async ({ page }) => {
  const origin = await open(page);
  await addBox(page);
  const rest = (await guides(page)) as Guides;
  expectOnFrame(rest);

  const x = origin.x + rest.frame.maxX;
  const y = origin.y + rest.frame.maxY;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 30, { steps: 6 });
  await expect.poll(async () => (await guides(page))?.lines.maxX ?? 0).toBeGreaterThan(rest.lines.maxX + 20);
  expectOnFrame(await guides(page));
  await page.mouse.up();
  await expect(async () => expectOnFrame(await guides(page))).toPass();
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('the guides follow the frame of a multi-selection while it resizes', async ({ page }) => {
  const origin = await open(page);
  const lone = (await guides(page)) as Guides;
  await page.getByText('Box', { exact: true }).first().dblclick();
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  // A line's stroke-free rect is its centre line. As the lowest member it separates the frame from the members.
  await page.getByText('Line', { exact: true }).first().dblclick();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  await page.locator('.konvajs-content').click({ button: 'right', position: { x: 5, y: 5 } });
  await page.getByText('Select all', { exact: true }).click();
  await expect
    .poll(async () => {
      const g = await guides(page);
      return g ? g.frame.maxY - g.frame.minY : 0;
    })
    .toBeGreaterThan(lone.frame.maxY - lone.frame.minY + 10);
  const rest = (await guides(page)) as Guides;
  expectOnFrame(rest);

  const x = origin.x + rest.frame.maxX;
  const y = origin.y + rest.frame.maxY;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 30, { steps: 6 });
  await expect.poll(async () => (await guides(page))?.lines.maxX ?? 0).toBeGreaterThan(rest.lines.maxX + 20);
  expectOnFrame(await guides(page));
  await page.mouse.up();
  await expect.poll(async () => {
    const g = await guides(page);
    return g ? Math.abs(g.lines.maxY - g.frame.maxY) : 99;
  }).toBeLessThanOrEqual(1);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('the badges of both rulers stay apart at the ruler corner', async ({ page }) => {
  const origin = await open(page);
  const rest = (await guides(page)) as Guides;
  const x = origin.x + (rest.frame.minX + rest.frame.maxX) / 2;
  const y = origin.y + (rest.frame.minY + rest.frame.maxY) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45 - rest.frame.minX, y + 45 - rest.frame.minY, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await guides(page))?.frame.minY ?? Infinity).toBeLessThan(50);
  await expect
    .poll(async () => {
      const [top, left] = await nearBadges(page);
      return !!top && !!left && (left.y >= top.y + top.height || left.x >= top.x + top.width);
    })
    .toBe(true);
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});

test('the action bar covers the guides that run behind it', async ({ page }) => {
  const origin = await open(page);
  await addBox(page);
  const { frame } = (await guides(page)) as Guides;
  const y = origin.y + (frame.minY + frame.maxY) / 2;
  await page.mouse.move(origin.x + frame.maxX, y);
  await page.mouse.down();
  await page.mouse.move(origin.x + frame.minX + 24, y, { steps: 6 });
  await page.mouse.up();
  // Counts the pixels in the guide colour on both vertical guides, inside the bar's pill.
  const covered = () =>
    page.evaluate(() => {
      interface Rect {
        x: number;
        y: number;
        width: number;
        height: number;
      }
      interface Node {
        findOne: (s: string) => Node | undefined;
        x: () => number;
        stroke: () => string;
        getClientRect: () => Rect;
        toCanvas: (o: { pixelRatio: number }) => HTMLCanvasElement;
      }
      const stage = (window as unknown as { Konva: { stages: Node[] } }).Konva.stages[0];
      const bar = stage.findOne('.action-bar')?.getClientRect();
      const near = stage.findOne('.line-x-near');
      const far = stage.findOne('.line-x-far');
      if (!bar || !near || !far) return null;
      const swatch = document.createElement('canvas').getContext('2d');
      const shot = stage.toCanvas({ pixelRatio: 1 }).getContext('2d');
      if (!swatch || !shot) return null;
      swatch.fillStyle = near.stroke();
      swatch.fillRect(0, 0, 1, 1);
      const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data;
      let guidePixels = 0;
      for (const line of [near, far]) {
        const x = Math.floor(line.x());
        const rows = shot.getImageData(x, Math.ceil(bar.y) + 6, 1, Math.floor(bar.height) - 12).data;
        for (let i = 0; i < rows.length; i += 4) {
          if (rows[i] === r && rows[i + 1] === g && rows[i + 2] === b) guidePixels += 1;
        }
      }
      return { guidePixels, inside: near.x() > bar.x + 15 && far.x() < bar.x + bar.width - 15 };
    });
  await expect.poll(covered).toEqual({ guidePixels: 0, inside: true });
  expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
});
