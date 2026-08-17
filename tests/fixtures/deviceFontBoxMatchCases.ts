/** Heights are exact cell multiples (mag 1-3) plus one off-multiple
 *  case per font that must snap to mag 1, proving our rounding agrees
 *  with the firmware's. */
import { DEVICE_FONT_CELLS } from '@zplab/core/lib/labelGeometry/deviceFonts';
import { charSlug } from './charSlug';

export interface DeviceFontBoxMatchCase {
  id: string;
  fontId: string;
  fontHeight: number;
  /** Width parameter of `^A{id},h,w`. 0 = derive from height. */
  fontWidth: number;
  text: string;
  rotation: 'N' | 'I' | 'B';
  x: number;
  y: number;
  posType?: 'FO' | 'FT';
  /** ^FB stacks explicit \& lines; ^TB wraps into a fixed clip box. */
  block?:
    | { mode: 'fb'; widthDots: number; lines: number; spacing: number }
    | { mode: 'tb'; widthDots: number; heightDots: number };
}

interface FontPlan {
  fontId: string;
  magStep: number;
  magWidthStep: number;
  chars: string[];
}

// Chars per font: a digit, a wide cap, and where the font has
// lowercase a descender ('p') for baseline reach. B is caps-only and
// H (OCR-A) drops lowercase, so they test 'W' instead.
const ULD_CHARS = ['5', 'M', 'p'];
const CAPS_CHARS = ['5', 'M', 'W'];

const FONT_PLANS: FontPlan[] = Object.entries(DEVICE_FONT_CELLS).map(
  ([fontId, cell]) => ({
    fontId,
    magStep: cell.magStep,
    magWidthStep: cell.magWidthStep,
    chars: fontId === 'B' || fontId === 'H' ? CAPS_CHARS : ULD_CHARS,
  }),
);

const MAGS = [1, 2, 3];

const magCases: DeviceFontBoxMatchCase[] = FONT_PLANS.flatMap((plan) =>
  MAGS.flatMap((mag) =>
    plan.chars.map((c) => ({
      id: `f${plan.fontId}_m${mag}_${charSlug(c)}`,
      fontId: plan.fontId,
      fontHeight: plan.magStep * mag,
      fontWidth: 0,
      text: c.repeat(3),
      rotation: 'N' as const,
      x: 100,
      y: 100,
    })),
  ),
);

/** Off-multiple heights: 1.4x the cell must round down to mag 1 on
 *  both sides. */
const snapCases: DeviceFontBoxMatchCase[] = FONT_PLANS.map((plan) => ({
  id: `f${plan.fontId}_snap`,
  fontId: plan.fontId,
  fontHeight: Math.round(plan.magStep * 1.4),
  fontWidth: 0,
  text: '505',
  rotation: 'N' as const,
  x: 100,
  y: 100,
}));

/** Width sweeps: explicit `^A,h,w` with w decoupled from h exercises
 *  the magW path (untested by the w=0 cases above), plus one high-mag
 *  case. Two chars and a tighter origin keep font G inside the 812-dot
 *  label at mag 5. */
const sweepCases: DeviceFontBoxMatchCase[] = FONT_PLANS.flatMap((plan) =>
  [
    { h: 3, w: 1, slug: 'w1' },
    { h: 3, w: 5, slug: 'w5' },
    { h: 5, w: 0, slug: 'm5' },
  ].map(({ h, w, slug }) => ({
    id: `f${plan.fontId}_${slug}`,
    fontId: plan.fontId,
    fontHeight: plan.magStep * h,
    fontWidth: w > 0 ? plan.magWidthStep * w : 0,
    text: 'M5',
    rotation: 'N' as const,
    x: 20,
    y: 20,
  })),
);

/** Rotated fields anchor at the cell edge and extend along the reading
 *  direction, so their position exercises the deterministic cell-grid
 *  extent (deviceFontInkWidthDots) end to end. */
const rotatedCases: DeviceFontBoxMatchCase[] = ['A', 'E', 'G'].flatMap((fontId) => {
  const plan = FONT_PLANS.find((f) => f.fontId === fontId);
  if (!plan) throw new Error(`no plan for ${fontId}`);
  return (['I', 'B'] as const).flatMap((rotation) =>
    [1, 2].map((mag) => ({
      id: `f${fontId}_rot${rotation}_m${mag}`,
      fontId,
      fontHeight: plan.magStep * mag,
      fontWidth: 0,
      text: 'M5i',
      rotation,
      x: 300,
      y: 150,
    })),
  );
});

/** Multi-line blocks: the firmware stacks device-font lines by the
 *  snapped cell height (+ ^FB spacing), not the requested height; FT
 *  pins the block bottom. h=84 snaps to 60, so a wrong pitch basis is
 *  a 24-dot-per-line error the gate cannot miss. */
const blockCases: DeviceFontBoxMatchCase[] = [
  { id: 'fG_fb', fontId: 'G', fontHeight: 84, fontWidth: 0, text: 'MMM\\&MMM\\&MMM',
    rotation: 'N', x: 50, y: 50, block: { mode: 'fb', widthDots: 700, lines: 3, spacing: 0 } },
  { id: 'fG_fb_sp10', fontId: 'G', fontHeight: 84, fontWidth: 0, text: 'MMM\\&MMM\\&MMM',
    rotation: 'N', x: 50, y: 50, block: { mode: 'fb', widthDots: 700, lines: 3, spacing: 10 } },
  { id: 'fG_fb_ft', fontId: 'G', fontHeight: 84, fontWidth: 0, text: 'MMM\\&MMM\\&MMM',
    rotation: 'N', x: 50, y: 700, posType: 'FT', block: { mode: 'fb', widthDots: 700, lines: 3, spacing: 0 } },
  { id: 'fA_fb', fontId: 'A', fontHeight: 20, fontWidth: 0, text: 'MMM\\&MMM\\&MMM',
    rotation: 'N', x: 50, y: 50, block: { mode: 'fb', widthDots: 700, lines: 3, spacing: 0 } },
  { id: 'fG_tb', fontId: 'G', fontHeight: 84, fontWidth: 0, text: 'MMM MMM MMM',
    rotation: 'N', x: 50, y: 50, block: { mode: 'tb', widthDots: 250, heightDots: 400 } },
  { id: 'fG_tb_ft', fontId: 'G', fontHeight: 84, fontWidth: 0, text: 'MMM MMM MMM',
    rotation: 'N', x: 50, y: 700, posType: 'FT', block: { mode: 'tb', widthDots: 250, heightDots: 400 } },
  { id: 'fG_tb_rotI', fontId: 'G', fontHeight: 84, fontWidth: 0, text: 'MMM MMM MMM',
    rotation: 'I', x: 600, y: 600, block: { mode: 'tb', widthDots: 250, heightDots: 400 } },
  { id: 'fG_fb_rotI', fontId: 'G', fontHeight: 84, fontWidth: 0, text: 'MMM\\&MMM\\&MMM',
    rotation: 'I', x: 600, y: 600, block: { mode: 'fb', widthDots: 250, lines: 3, spacing: 0 } },
];

export const deviceFontBoxMatchCases: DeviceFontBoxMatchCase[] = [
  ...magCases,
  ...snapCases,
  ...sweepCases,
  ...rotatedCases,
  ...blockCases,
];
