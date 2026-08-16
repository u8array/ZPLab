import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { PNG } from 'pngjs';
import { textBoxMatchCases } from '../../tests/fixtures/textBoxMatchCases';
import { darkBBox } from '../../tests/lib/darkBBox';
import { drawKonvaText } from '../../tests/lib/drawKonvaText';
import { inkCanvas } from '../../tests/lib/inkCanvas';
import {
  PRINTLAB_FONT_FAMILY,
  registerPrintLabZpl,
} from '../../tests/lib/printLabFont';

/**
 * Box-match regression.
 *
 * Asserts that our local @napi-rs/canvas render (with PrintLab ZPL)
 * produces a glyph bounding box within a small tolerance of what
 * Labelary prints using the default Zebra firmware font (^A0,
 * CG Triumvirate). That's the comparison the user actually cares
 * about: "if my editor says this text fits, will it also fit on the
 * printed label?".
 *
 * We compare BBOX DIMENSIONS, not pixel content. The two fonts have
 * different glyph designs (Roboto vs. CG Triumvirate), so pixel-perfect
 * match is impossible; but the rendered footprint can and must
 * match for layout to be trustworthy.
 *
 * Test cases are `char × 3` patterns at multiple sizes (see
 * tests/fixtures/textBoxMatchCases.ts) covering digits, alpha caps,
 * alpha lowercase, and the punctuation chars Zebra renders unusually
 * wide. Fixture generation lives in
 * tests/scripts/fetch_labelary_default_text_fixtures.ts.
 */

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  'tests/fixtures/labelary_text_default_images',
);
/** Per-axis size tolerance across the 20-80 sweep: calibrated content
 *  lands at <=3 dots, 6 leaves AA/rounding headroom, and a real layout
 *  regression (wrong advance class, wrong fontSize) produces >12 even
 *  at small sizes. */
const BBOX_TOLERANCE_DOTS = 6;


describe('Text Box-Match — PrintLab ZPL vs. Labelary default font', () => {
  beforeAll(() => {
    registerPrintLabZpl();
  });

  it('has default-font fixtures (run fetch_labelary_default_text_fixtures.ts if this fails)', () => {
    expect(textBoxMatchCases.length).toBeGreaterThan(0);
    for (const tc of textBoxMatchCases) {
      const fixture = path.join(FIXTURES_DIR, `${tc.id}.png`);
      expect(fs.existsSync(fixture), `Missing fixture ${tc.id}.png`).toBe(true);
    }
  });

  describe.each(textBoxMatchCases)('Box: $id', (tc) => {
    it(`bbox matches Labelary default within ±${BBOX_TOLERANCE_DOTS} dots`, () => {
      // ZPL `^A0,h,w` with w != h stretches each glyph; w = 0 means
      // "match h".
      const { canvas, ctx } = inkCanvas();
      drawKonvaText(ctx, {
        text: tc.text,
        x: tc.x,
        y: tc.y,
        fontSizePx: tc.fontHeight,
        fontFamily: PRINTLAB_FONT_FAMILY,
        fontStyle: 'bold',
        scaleX: tc.fontWidth > 0 ? tc.fontWidth / tc.fontHeight : 1,
      });

      const localPng = PNG.sync.read(canvas.toBuffer('image/png'));
      const labelaryPng = PNG.sync.read(
        fs.readFileSync(path.join(FIXTURES_DIR, `${tc.id}.png`)),
      );

      const localBox = darkBBox(localPng);
      const labelaryBox = darkBBox(labelaryPng);

      expect(localBox.width, `width drift for ${tc.id}`).toBeGreaterThanOrEqual(
        labelaryBox.width - BBOX_TOLERANCE_DOTS,
      );
      expect(localBox.width).toBeLessThanOrEqual(
        labelaryBox.width + BBOX_TOLERANCE_DOTS,
      );
      expect(localBox.height, `height drift for ${tc.id}`).toBeGreaterThanOrEqual(
        labelaryBox.height - BBOX_TOLERANCE_DOTS,
      );
      expect(localBox.height).toBeLessThanOrEqual(
        labelaryBox.height + BBOX_TOLERANCE_DOTS,
      );
    });
  });
});
