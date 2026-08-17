import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { textBoxMatchCases } from '../../tests/fixtures/textBoxMatchCases';
import { font0GlyphCoverageCases } from '../../tests/fixtures/font0GlyphCoverageCases';

/** The coverage list deliberately shares ids with the box-match set so
 *  both read the same fixture PNG; that only stays correct while equal
 *  ids imply equal render parameters. The fetch script keeps the first
 *  job per id, so a silent divergence would compare one list's render
 *  against the other list's fixture. */
describe('fixture id contract', () => {
  it('cases sharing an id share their render parameters', () => {
    const byId = new Map<string, string>();
    for (const tc of [...textBoxMatchCases, ...font0GlyphCoverageCases]) {
      // The fetch ZPL emits fontWidth || fontHeight; 0 and an explicit
      // width equal to the height are the same fixture.
      const params = JSON.stringify([
        tc.text,
        tc.fontHeight,
        tc.fontWidth || tc.fontHeight,
        tc.rotation,
        tc.x,
        tc.y,
      ]);
      const prev = byId.get(tc.id);
      if (prev !== undefined) {
        expect(params, `diverging params for shared id ${tc.id}`).toBe(prev);
      } else {
        byId.set(tc.id, params);
      }
    }
  });

  it('has no orphaned fixture PNGs', () => {
    const dir = path.resolve(process.cwd(), 'tests/fixtures/labelary_text_default_images');
    const expected = new Set(
      [...textBoxMatchCases, ...font0GlyphCoverageCases].map((tc) => `${tc.id}.png`),
    );
    const orphans = fs.readdirSync(dir).filter((f) => f.endsWith('.png') && !expected.has(f));
    expect(orphans, 'unreferenced fixtures').toEqual([]);
  });
});
