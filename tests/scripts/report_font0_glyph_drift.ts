/*
 * Per-glyph ink drift report: PrintLab ZPL (our Font-0 substitute) vs
 * Labelary's default CG Triumvirate render, over the full coverage set
 * (tests/fixtures/font0GlyphCoverageCases.ts).
 *
 * Decision tool for font-pipeline work: advance widths are already baked
 * into the TTF, so what this surfaces is glyph SHAPE drift.
 *
 * Run: pnpm dlx tsx tests/scripts/report_font0_glyph_drift.ts
 * (fetch fixtures first via fetch_labelary_default_text_fixtures.ts)
 */
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { zplAnchorToModel } from '@zplab/core/lib/labelGeometry/textPositionTransforms';
import { font0GlyphCoverageCases } from '../fixtures/font0GlyphCoverageCases';
import { darkBBox } from '../lib/darkBBox';
import { drawKonvaText } from '../lib/drawKonvaText';
import { inkCanvas } from '../lib/inkCanvas';
import {
  PRINTLAB_FONT_FAMILY,
  registerPrintLabZpl,
} from '../lib/printLabFont';

const FIXTURES_DIR = path.resolve('tests/fixtures/labelary_text_default_images');

// Production placement: ^FO anchor -> zplAnchorToModel -> Konva line
// placement, so dY reads as real on-canvas position drift, not harness
// offset.
function renderLocal(tc: (typeof font0GlyphCoverageCases)[number]) {
  const { canvas, ctx } = inkCanvas();
  const model = zplAnchorToModel(
    tc.x,
    tc.y,
    { fontHeight: tc.fontHeight, rotation: tc.rotation },
    'FO',
  );
  drawKonvaText(ctx, {
    text: tc.text,
    x: model.x,
    y: model.y,
    fontSizePx: tc.fontHeight,
    fontFamily: PRINTLAB_FONT_FAMILY,
    fontStyle: 'bold',
  });
  return darkBBox(PNG.sync.read(canvas.toBuffer('image/png')));
}

function main(): void {
  registerPrintLabZpl();

  interface Row {
    id: string;
    char: string;
    dW: number;
    dH: number;
    dY: number;
    relW: number;
    relH: number;
    local: ReturnType<typeof darkBBox>;
    labelary: ReturnType<typeof darkBBox>;
  }
  const rows: Row[] = [];
  const missing: string[] = [];

  for (const tc of font0GlyphCoverageCases) {
    const fixture = path.join(FIXTURES_DIR, `${tc.id}.png`);
    if (!fs.existsSync(fixture)) {
      missing.push(tc.id);
      continue;
    }
    const labelary = darkBBox(PNG.sync.read(fs.readFileSync(fixture)));
    const local = renderLocal(tc);
    rows.push({
      id: tc.id,
      char: tc.text[0] ?? '',
      dW: local.width - labelary.width,
      dH: local.height - labelary.height,
      dY: local.y - labelary.y,
      relW: labelary.width > 0 ? (local.width - labelary.width) / labelary.width : 0,
      relH: labelary.height > 0 ? (local.height - labelary.height) / labelary.height : 0,
      local,
      labelary,
    });
  }

  rows.sort((a, b) => Math.abs(b.relW) - Math.abs(a.relW));

  console.log('char  local WxH   labelary WxH   dW   dH   dY   relW%   relH%');
  for (const r of rows) {
    const flag = Math.abs(r.dW) > 6 || Math.abs(r.dH) > 6 || Math.abs(r.dY) > 6 ? '  <<<' : '';
    console.log(
      `${r.char.padEnd(5)} ${`${r.local.width}x${r.local.height}`.padEnd(11)} ` +
        `${`${r.labelary.width}x${r.labelary.height}`.padEnd(14)} ` +
        `${String(r.dW).padStart(3)}  ${String(r.dH).padStart(3)}  ` +
        `${String(r.dY).padStart(3)}  ` +
        `${(r.relW * 100).toFixed(1).padStart(6)}  ${(r.relH * 100).toFixed(1).padStart(6)}${flag}`,
    );
  }

  const outliers = rows.filter(
    (r) => Math.abs(r.dW) > 6 || Math.abs(r.dH) > 6 || Math.abs(r.dY) > 6,
  );
  const moderate = rows.filter(
    (r) =>
      !outliers.includes(r) &&
      (Math.abs(r.dW) > 3 || Math.abs(r.dH) > 3 || Math.abs(r.dY) > 3),
  );
  console.log(`\n${rows.length} glyphs measured at h=50 (char x3).`);
  console.log(
    `Outliers >6 dots (box-match tolerance): ${outliers.length}` +
      (outliers.length ? ` -> ${outliers.map((r) => r.char).join(' ')}` : ''),
  );
  console.log(
    `Moderate 4-6 dots: ${moderate.length}` +
      (moderate.length ? ` -> ${moderate.map((r) => r.char).join(' ')}` : ''),
  );
  if (missing.length) {
    console.log(
      `\nWARNING: ${missing.length} fixture(s) missing, run the fetch script: ${missing.join(', ')}`,
    );
  }
}

main();
