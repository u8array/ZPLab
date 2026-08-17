import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GlobalFonts } from '@napi-rs/canvas';
import { PNG } from 'pngjs';
import { deviceFontMetrics, deviceFontInkWidthDots } from '@zplab/core/lib/labelGeometry/deviceFonts';
import { zplAnchorToModel } from '@zplab/core/lib/labelGeometry/textPositionTransforms';
import { blockAnchorExtentDots, blockLineStepDots, tbLineStepDots } from '@zplab/core/lib/zebraTextLayout';
import { builtinFontFamily } from '@zplab/core/lib/customFonts';
import { deviceFontBoxMatchCases } from '../../tests/fixtures/deviceFontBoxMatchCases';
import { darkBBox } from '../../tests/lib/darkBBox';
import { drawKonvaText } from '../../tests/lib/drawKonvaText';
import { inkCanvas } from '../../tests/lib/inkCanvas';
import { expectBoxMatch } from '../../tests/lib/boxMatch';

/**
 * Box-match regression for the bitmap device fonts (^AA-^AH) through the
 * production metrics and placement chain; position is what validates the
 * yOffEm/xOffEm calibration. Bboxes, not pixels, for the same reason as
 * textBoxMatch: the substitute faces differ in glyph design.
 */

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  'tests/fixtures/labelary_devicefont_images',
);

const FONT_DIR = path.resolve(process.cwd(), 'src/assets/fonts');

/** Bundled TTF per CSS family name; the face choice itself comes from
 *  builtinFontFamily so a production face swap fails here loudly instead
 *  of silently testing the old font. */
const FONT_FILES: Record<string, string> = {
  'PrintLab Mono': 'PrintLabMono.ttf',
  'Vera Mono': 'VeraMono.ttf',
  'Vera Mono Bold': 'VeraMono-Bold.ttf',
  OCRB: 'OCRB.ttf',
  OCRA: 'OCRA.ttf',
};

function faceFor(fontId: string): { family: string; file: string } {
  const family = builtinFontFamily(fontId)
    ?.split(',')[0]
    ?.replace(/'/g, '')
    .trim();
  const file = family ? FONT_FILES[family] : undefined;
  if (!family || !file) throw new Error(`no bundled face for font ${fontId}`);
  return { family, file };
}

const FONT_IDS = [...new Set(deviceFontBoxMatchCases.map((tc) => tc.fontId))];

describe('Device font box-match: substitutes vs. Labelary bitmap fonts', () => {
  beforeAll(() => {
    for (const fontId of FONT_IDS) {
      const face = faceFor(fontId);
      const p = path.join(FONT_DIR, face.file);
      if (!fs.existsSync(p)) throw new Error(`Font file missing at ${p}`);
      GlobalFonts.registerFromPath(p, face.family);
    }
  });

  it('has device-font fixtures (run fetch_labelary_default_text_fixtures.ts if this fails)', () => {
    expect(deviceFontBoxMatchCases.length).toBeGreaterThan(0);
    for (const tc of deviceFontBoxMatchCases) {
      const fixture = path.join(FIXTURES_DIR, `${tc.id}.png`);
      expect(fs.existsSync(fixture), `Missing fixture ${tc.id}.png`).toBe(true);
    }
  });

  describe.each(deviceFontBoxMatchCases)('Box: $id', (tc) => {
    it('bbox matches Labelary within tolerance', () => {
      const metrics = deviceFontMetrics(tc.fontId, tc.fontHeight, tc.fontWidth);
      expect(metrics, `no metrics for font ${tc.fontId}`).not.toBeNull();
      if (!metrics) return;
      const face = faceFor(tc.fontId);

      const inkWidth =
        deviceFontInkWidthDots(tc.fontId, tc.fontHeight, tc.fontWidth, tc.text) ?? 0;
      // The gate consumes the production extent, so a parser/generator
      // divergence fails here instead of shifting user labels silently.
      const blockExtent =
        tc.block === undefined
          ? 0
          : blockAnchorExtentDots({
              tbHeightDots: tc.block.mode === 'tb' ? tc.block.heightDots : 0,
              blockWidthDots: tc.block.widthDots,
              blockLines: tc.block.mode === 'fb' ? tc.block.lines : 1,
              blockLineSpacing: tc.block.mode === 'fb' ? tc.block.spacing : 0,
              fontHeight: tc.fontHeight,
              deviceFontId: tc.fontId,
            });
      const model = zplAnchorToModel(
        tc.x,
        tc.y,
        { fontHeight: tc.fontHeight, rotation: tc.rotation, fontId: tc.fontId },
        tc.posType ?? 'FO',
        inkWidth,
        blockExtent,
        tc.block?.mode === 'fb' ? tc.block.widthDots : 0,
      );
      // ^FB breaks at \&, the ^TB case is sized to wrap each word; the
      // wrap algorithm itself is out of scope here.
      const lines =
        tc.block === undefined
          ? [tc.text]
          : tc.block.mode === 'fb'
            ? tc.text.split('\\&')
            : tc.text.split(' ');
      const step =
        tc.block?.mode === 'tb'
          ? tbLineStepDots(tc.fontHeight, tc.fontId)
          : blockLineStepDots(tc.fontHeight, tc.block?.spacing ?? 0, tc.fontId);

      const { canvas, ctx } = inkCanvas();
      // Konva rotates the node about its position; the device nudges are
      // node-local, so they apply inside the rotated frame.
      const deg = { N: 0, I: 180, B: 270 }[tc.rotation];
      ctx.save();
      ctx.translate(model.x, model.y);
      ctx.rotate((deg * Math.PI) / 180);
      for (const [i, line] of lines.entries()) {
        drawKonvaText(ctx, {
          text: line,
          x: metrics.xOffsetDots,
          y: metrics.yOffsetDots + i * step,
          fontSizePx: metrics.fontSizeDots,
          fontFamily: face.family,
          scaleX: metrics.scaleX,
          letterSpacingPx: metrics.letterSpacingDots,
        });
      }
      ctx.restore();

      const localPng = PNG.sync.read(canvas.toBuffer('image/png'));
      const labelaryPng = PNG.sync.read(
        fs.readFileSync(path.join(FIXTURES_DIR, `${tc.id}.png`)),
      );

      const localBox = darkBBox(localPng);
      const labelaryBox = darkBBox(labelaryPng);

      // Floor 2: device substitutes land within +-2 dots once calibrated.
      expectBoxMatch(localBox, labelaryBox, 2, tc.id);
    });
  });
});
