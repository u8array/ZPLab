import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { zplAnchorToModel } from '@zplab/core/lib/labelGeometry/textPositionTransforms';
import { charSlug } from '../../tests/fixtures/charSlug';
import { darkBBox } from '../../tests/lib/darkBBox';
import { drawKonvaText } from '../../tests/lib/drawKonvaText';
import { inkCanvas } from '../../tests/lib/inkCanvas';
import { expectBoxMatch } from '../../tests/lib/boxMatch';
import {
  PRINTLAB_FONT_FAMILY,
  registerPrintLabZpl,
} from '../../tests/lib/printLabFont';

/**
 * Font-0 placement gate: size AND position of the calibrated glyphs vs
 * Labelary, through the production chain (^FO anchor -> zplAnchorToModel
 * -> Konva placement). Guards the font-patch results that the drift
 * report only measures; a rebuilt TTF without the patch pipeline turns
 * this red.
 */

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  'tests/fixtures/labelary_text_default_images',
);
const H = 50;

// Representative subset of the font build's calibrated glyphs; '/'
// also guards the kerning strip ('///' collapses if GSUB/GPOS come
// back); 'b' guards the global vertical shift; '5' and 'M' pin the
// chain.
const GLYPHS = ['_', '<', '>', '@', '*', '$', '(', ')', '/', 'f', 'j', 'Q', 'p', 'b', '~', '^', '[', 'ß', '©', '°', '§', '×', '–', 'Æ', 'Ç', 'ñ', '5', 'M'];

describe('Font 0 placement match: patched glyphs vs Labelary', () => {
  beforeAll(() => {
    registerPrintLabZpl();
  });

  describe.each(GLYPHS)('Glyph: %s', (glyph) => {
    it('bbox and position match Labelary within tolerance', () => {
      const id = `h${H}_${charSlug(glyph)}`;
      const fixture = path.join(FIXTURES_DIR, `${id}.png`);
      expect(
        fs.existsSync(fixture),
        `Missing fixture ${id}.png (run fetch_labelary_default_text_fixtures.ts)`,
      ).toBe(true);

      const { canvas, ctx } = inkCanvas();
      const model = zplAnchorToModel(200, 200, { fontHeight: H, rotation: 'N' }, 'FO');
      drawKonvaText(ctx, {
        text: glyph.repeat(3),
        x: model.x,
        y: model.y,
        fontSizePx: H,
        fontFamily: PRINTLAB_FONT_FAMILY,
        fontStyle: 'bold',
      });

      const localBox = darkBBox(PNG.sync.read(canvas.toBuffer('image/png')));
      const labelaryBox = darkBBox(PNG.sync.read(fs.readFileSync(fixture)));

      // Floor 3: sub-10-dot punctuation boxes carry +-3 dots of AA and
      // rounding noise; the regressions this gate exists for measure 4+.
      expectBoxMatch(localBox, labelaryBox, 3, id);
    });
  });
});
