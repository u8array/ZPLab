import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { inkCanvas, INK_CANVAS_PX } from '../../tests/lib/inkCanvas';
import {
  PRINTLAB_FONT_FAMILY,
  registerPrintLabZpl,
} from '../../tests/lib/printLabFont';
import { textTestCases } from '../../tests/fixtures/textTestCases';

/**
 * Renderer-pair stability check: Skia (@napi-rs/canvas) vs Labelary,
 * with the SAME TTF loaded on both sides (PrintLabZPL-Bold.ttf):
 *   - Labelary uploaded it via /v1/fonts before generating the fixtures
 *     (see tests/scripts/fetch_labelary_text_fixtures.ts).
 *   - The local render here registers the TTF with @napi-rs/canvas.
 *
 * **This suite does NOT verify Zebra firmware fidelity.** Glyph data is
 * identical on both sides by construction, and Labelary is itself a
 * firmware simulator; substituting the font further removes the one
 * thing Labelary contributed (its bundled Zebra-equivalent font metrics).
 * What this catches: drift in our canvas font sizing / anchor math /
 * fontSize-to-fontHeight conversion vs Labelary's renderer. What it
 * does NOT catch: actual diff between the canvas preview and a label
 * printed by physical Zebra hardware.
 *
 * Production uses `ZPL_FONT_HEIGHT_TO_CSS_RATIO = 1.0`, i.e. canvas
 * fontSize equals ZPL fontHeight directly. The test mirrors that so
 * the regression catches anything that breaks the live render path.
 */
const FIXTURES_DIR = path.resolve(
  process.cwd(),
  'tests/fixtures/labelary_text_images',
);
const DIFF_DIR = path.resolve(process.cwd(), 'tests/fixtures/__text_diffs__');

/** Diff allowance. With both sides loading the same TTF the remaining
 *  delta is anti-aliasing edge variance between the renderers, sized
 *  with the glyph perimeter rather than the area, so a flat ceiling
 *  generous enough for the largest case in the matrix still leaves an
 *  order of magnitude of headroom before a real regression (wrong font
 *  loaded, wrong fontSize, wrong rotation) breaches it. Measured high
 *  watermark across the current suite is ~5700; an actual regression
 *  produces >20000 even at small fontHeights. */
const ALLOWED_PX_DIFF = 8000;

if (!fs.existsSync(DIFF_DIR)) {
  fs.mkdirSync(DIFF_DIR, { recursive: true });
}

describe('Text renderer-pair stability (Skia vs Labelary, shared TTF)', () => {
  beforeAll(() => {
    registerPrintLabZpl();
  });

  it('has fixtures (run fetch_labelary_text_fixtures.ts if this fails)', () => {
    expect(textTestCases.length).toBeGreaterThan(0);
    for (const tc of textTestCases) {
      const fixture = path.join(FIXTURES_DIR, `${tc.id}.png`);
      expect(
        fs.existsSync(fixture),
        `Missing fixture ${tc.id}.png — run tests/scripts/fetch_labelary_text_fixtures.ts`,
      ).toBe(true);
    }
  });

  describe.each(textTestCases)('Text: $id', (tc) => {
    it('matches Labelary within anti-aliasing tolerance', () => {
      // Deliberately NOT drawKonvaText: this is a pixel diff against
      // fixtures rendered at textBaseline='top'; the shared helper's
      // alphabetic-baseline offset would shift the render off them.
      const { canvas, ctx } = inkCanvas();
      ctx.font = `bold ${tc.fontHeight}px "${PRINTLAB_FONT_FAMILY}"`;
      ctx.textBaseline = 'top';
      ctx.fillText(tc.text, tc.x, tc.y);
      const localPng = PNG.sync.read(canvas.toBuffer('image/png'));

      const fixtureBuf = fs.readFileSync(path.join(FIXTURES_DIR, `${tc.id}.png`));
      const fixturePng = PNG.sync.read(fixtureBuf);
      expect(fixturePng.width).toBe(INK_CANVAS_PX);
      expect(fixturePng.height).toBe(INK_CANVAS_PX);

      const diff = new PNG({ width: INK_CANVAS_PX, height: INK_CANVAS_PX });
      const diffCount = pixelmatch(
        fixturePng.data,
        localPng.data,
        diff.data,
        INK_CANVAS_PX,
        INK_CANVAS_PX,
        { threshold: 0.1 },
      );

      if (diffCount > ALLOWED_PX_DIFF) {
        // Write the diff and local PNGs so a CI failure is debuggable
        // without re-running the script locally.
        fs.writeFileSync(
          path.join(DIFF_DIR, `${tc.id}_diff.png`),
          PNG.sync.write(diff),
        );
        fs.writeFileSync(
          path.join(DIFF_DIR, `${tc.id}_local.png`),
          canvas.toBuffer('image/png'),
        );
      }

      expect(diffCount).toBeLessThanOrEqual(ALLOWED_PX_DIFF);
    });
  });
});
