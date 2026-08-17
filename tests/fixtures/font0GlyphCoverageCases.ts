/** Measurement input for the per-glyph drift report, deliberately NOT
 *  wired into the strict box-match test: measurement precedes gating.
 *  Ids reuse textBoxMatchCases' scheme (see fixtureIdContract). */
import type { TextBoxMatchCase } from './textBoxMatchCases';
import { PUNCT_SLUGS, charSlug } from './charSlug';

const ALL_CHARS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  ...Object.keys(PUNCT_SLUGS),
];

const SIZE = 50;

export const font0GlyphCoverageCases: TextBoxMatchCase[] = ALL_CHARS.map(
  (c) => ({
    id: `h${SIZE}_${charSlug(c)}`,
    fontHeight: SIZE,
    fontWidth: 0,
    text: c.repeat(3),
    rotation: 'N' as const,
    x: 200,
    y: 200,
  }),
);
