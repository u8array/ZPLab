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
  rotation: 'N';
  x: number;
  y: number;
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

export const deviceFontBoxMatchCases: DeviceFontBoxMatchCase[] = [
  ...magCases,
  ...snapCases,
  ...sweepCases,
];
