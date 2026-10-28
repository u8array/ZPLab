import { test, expect, type Page } from '@playwright/test';

interface Box {
  width: number;
  height: number;
}

interface Boxes {
  frame: Box;
  bars: Box;
}

const pageErrors: Error[] = [];

test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e));
});

/** Transformer box next to the bar image's own box, both in stage px without stroke. */
async function boxes(page: Page): Promise<Boxes | null> {
  return page.evaluate(() => {
    interface Node {
      findOne: (s: string) => Node | undefined;
      getClientRect: (o: { skipStroke: boolean; skipShadow: boolean }) => Box;
    }
    interface Transformer extends Node {
      nodes: () => Node[];
      width: () => number;
      height: () => number;
    }
    const stage = (window as unknown as { Konva?: { stages: Node[] } }).Konva?.stages[0];
    const tr = stage?.findOne('Transformer') as Transformer | undefined;
    const bars = tr?.nodes()[0]?.findOne('Image')?.getClientRect({ skipStroke: true, skipShadow: true });
    if (!tr || !bars) return null;
    const round = (b: Box) => ({ width: Math.round(b.width), height: Math.round(b.height) });
    return { frame: round({ width: tr.width(), height: tr.height() }), bars: round(bars) };
  });
}

/** Needs the real browser: jsdom showed the correct frame before the fix. */
// Code 128 carries its text in the HRI overlay while EAN-13 clips its image to the bars.
for (const entry of ['Code 128', 'EAN-13']) {
  test(`a freshly inserted ${entry} gets the bar box as its selection frame`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
    await page.getByText(entry, { exact: true }).first().dblclick();
    await expect.poll(() => boxes(page)).not.toBeNull();
    const b = (await boxes(page)) as Boxes;
    expect(b.frame).toEqual(b.bars);
    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
  });
}
