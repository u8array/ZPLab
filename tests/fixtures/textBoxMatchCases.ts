/** Box-match regression cases.
 *
 *  Compares our local @napi-rs/canvas render (using PrintLab ZPL) to
 *  Labelary's DEFAULT-font render (CG Triumvirate via ^A0) — the same
 *  output that lands on the user's printer. This is the gate for "will
 *  the printed bbox match what the editor showed?", independent of
 *  whether the user embeds our custom font in their ZPL.
 *
 *  Pattern is `char × 3` at multiple sizes so each diagnostic case has
 *  enough glyphs to surface per-char advance drift without amplifying
 *  string-specific kerning artefacts.
 *
 *  Sizes cover the common label range: 20 (small fineprint) through 80
 *  (header text). Skipping intermediate sizes here keeps the fixture
 *  set focused. */
import { charSlug } from './charSlug';

export interface TextBoxMatchCase {
  id: string;
  fontHeight: number;
  /** Width parameter of `^A0,h,w`. 0 = use height (Zebra default).
   *  Anything else stretches each glyph horizontally by w/h. */
  fontWidth: number;
  text: string;
  rotation: 'N';
  x: number;
  y: number;
}

const SIZES = [20, 30, 50, 80];

const CHARS = [
  // Digits: most common label content, all should share the same
  // advance class in CG Triumvirate.
  '0', '5', '9',
  // Alpha caps: spans narrow ('I') / medium ('A') / wide ('W').
  'A', 'M', 'W',
  // Lowercase: includes a descender ('p') for vertical reach checks.
  'a', 'i', 'p',
  // Punctuation Zebra renders unusually wide (hyphen and equals each
  // got advance = 72 vs. our digits at 38) — these are the classes
  // most likely to drift if hmtx stays out of sync with the live font.
  '-', '.', '=',
];



const uniformCases: TextBoxMatchCase[] = SIZES.flatMap((h) =>
  CHARS.map((c) => ({
    id: `h${String(h).padStart(2, '0')}_${charSlug(c)}`,
    fontHeight: h,
    fontWidth: 0,
    text: c.repeat(3),
    rotation: 'N' as const,
    x: 200,
    y: 200,
  })),
);

/** Stretched cases: `^A0,h,w` with w != h. Mirrors the configurations
 *  seen in real ZPL imports (e.g. ^A0N,87,72 from shipping labels).
 *  Each pair runs both axes so a regression in scaleX direction is
 *  caught at width-narrower and width-wider configurations. */
const stretchedCases: TextBoxMatchCase[] = [
  { id: 'h87_w72_201',  fontHeight: 87, fontWidth: 72, text: '201',          rotation: 'N', x: 200, y: 200 },
  { id: 'h39_w57_long', fontHeight: 39, fontWidth: 57, text: '160940002422', rotation: 'N', x: 200, y: 200 },
  { id: 'h50_w30_num',  fontHeight: 50, fontWidth: 30, text: '12345',        rotation: 'N', x: 200, y: 200 },
  { id: 'h30_w60_alpha', fontHeight: 30, fontWidth: 60, text: 'ABC',          rotation: 'N', x: 200, y: 200 },
];

/** Long multi-word lines: char x3 cases contain no spaces, so space
 *  advance drift and per-char accumulation over realistic label text
 *  only show up here. */
const longTextCases: TextBoxMatchCase[] = [
  { id: 'h50_shipto',  fontHeight: 50, fontWidth: 0, text: 'SHIP TO: 123 MAIN STREET',       rotation: 'N', x: 20, y: 200 },
  { id: 'h30_mixed',   fontHeight: 30, fontWidth: 0, text: 'Artikel: 4711-XL Gewicht 12,5kg', rotation: 'N', x: 20, y: 200 },
];

export const textBoxMatchCases: TextBoxMatchCase[] = [
  ...uniformCases,
  ...stretchedCases,
  ...longTextCases,
];
