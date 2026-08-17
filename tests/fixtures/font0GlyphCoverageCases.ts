/** Measurement input for the per-glyph drift report, deliberately NOT
 *  wired into the strict box-match test: measurement precedes gating.
 *  Ids reuse textBoxMatchCases' scheme (see fixtureIdContract). */
import type { TextBoxMatchCase } from './textBoxMatchCases';
import { CHAR_SLUGS, charSlug } from './charSlug';

export const UNSUPPORTED_CHARS = ['\u212e'];

/** Residuals the calibration deliberately leaves: <=3 dots of accent
 *  ink on the I family and fraction/ellipsis inner spacing, plus the
 *  spacing accents, whose shared outlines cannot move to Zebra's
 *  standalone positions without breaking the accented composites. */
export const KNOWN_DRIFT = [...'ÍÎÏÌìíîïýÿðøÙÚÛÜ«²³¹¼½¾…`\u00b4\u00b8\u2018\u2019\u201c\u201d'];

/** Ink-less space, NBSP and soft hyphen excluded; a missing slug
 *  throws instead of silently dropping coverage. */
const LATIN1_PRINTABLE: string[] = [];
for (let c = 0x21; c <= 0x7e; c++) LATIN1_PRINTABLE.push(String.fromCharCode(c));
for (let c = 0xa1; c <= 0xff; c++) {
  if (c !== 0xad) LATIN1_PRINTABLE.push(String.fromCharCode(c));
}
const SPECIALS = [...'\u20ac\u2122\u2022\u2026\u2013\u2014\u201a\u2018\u2019\u201e\u201c\u201d\u2030'];

const ALL_CHARS = [...LATIN1_PRINTABLE, ...SPECIALS];
for (const c of ALL_CHARS) {
  if (!/[0-9A-Za-z]/.test(c) && !(c in CHAR_SLUGS)) {
    throw new Error(`no fixture slug for ${c} (U+${c.codePointAt(0)!.toString(16)})`);
  }
}

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
