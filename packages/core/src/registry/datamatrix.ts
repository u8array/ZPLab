import type { ObjectTypeCore } from '../types/ObjectType';
import { fieldPosZ, fdFieldFor } from './zplHelpers';
import { DATAMATRIX_FD_ESCAPE } from '../lib/dataMatrixFd';
import { planGs1Fd } from '../lib/gs1Plan';
import { moduleTooSmallPreflight } from '../lib/barcodeScannability';
import { type ZplRotation } from './rotation';
import { GS1_CONTENT_SPEC } from './gs1FieldSpec';

export const DIMENSION_MIN = 1;
export const DIMENSION_MAX = 12;

/** ECC 200 square symbol sizes (rows = columns) the firmware accepts for ^BX c/r. */
export const DM_SQUARE_SIZES = [
  10, 12, 14, 16, 18, 20, 22, 24, 26, 32, 36, 40, 44, 48, 52,
  64, 72, 80, 88, 96, 104, 120, 132, 144,
] as const;

/** ECC 200 rectangular (DMRE) symbol sizes as [rows, columns]. */
export const DM_RECT_SIZES = [
  [8, 18], [8, 32], [12, 26], [12, 36], [16, 36], [16, 48],
] as const;

const dmGs1Fd = (s: string): string => planGs1Fd(s, 'datamatrix').fd;

export interface DataMatrixProps {
  content: string;
  dimension: number;   // module size in dots
  quality: 0 | 50 | 80 | 100 | 140 | 200;  // 0 = auto
  rotation: ZplRotation;
  /** GS1 DataMatrix mode: content is a GS1 element string; emit a leading FNC1
   *  and GS separators via the ^BX escape param (g=_). */
  gs1: boolean;
  /** ^BX a param: 2 = rectangular symbol (ECC 200 only — the firmware prints
   *  quality 0-140 square regardless). Absent/1 = square. */
  aspectRatio?: 1 | 2;
  /** ^BX c/r params: forced symbol size. Absent = firmware auto-sizing. */
  columns?: number;
  rows?: number;
}

// One switch for the capability flag and the emitter's chip resolution.
const CONTROL_CHARS = true;

export const datamatrix: ObjectTypeCore<DataMatrixProps> = {
  label: 'DataMatrix',
  icon: '▦',
  zplCmd: '^BX',
  group: 'code-2d',
  bindable: true,
  controlChars: CONTROL_CHARS,
  typedContent: true,
  defaultProps: {
    content: '',
    dimension: 5,
    quality: 200,
    rotation: 'N',
    gs1: false,
  },
  placeholderContent: '1234567890',
  // A forced c/r size can be too small for the sample; auto-size the fallback.
  sampleProps: { columns: undefined, rows: undefined },
  defaultSize: { width: 150, height: 150 },

  uniformScaleProp: { name: 'dimension', min: DIMENSION_MIN, max: DIMENSION_MAX },

  preflight: moduleTooSmallPreflight<DataMatrixProps>('dimension'),

  // GS1 mode restricts the editor to the GS1 charset (and enables the element-
  // string paste shortcut); plain ECC200 accepts a wide byte range, unfiltered.
  contentSpec: (props) => ((props as DataMatrixProps).gs1 ? GS1_CONTENT_SPEC : undefined),
  gs1Capable: true,

  // GS1 mode FNC1-escapes the payload; shared with the CSV batch override.
  // Non-GS1 content is arbitrary bytes, emitted verbatim (the printer owns any
  // ^BX escape sequences it contains).
  fdTransform: (obj) => (obj.props.gs1 ? dmGs1Fd : undefined),

  toZPL: (obj, ctx) => {
    const p = obj.props;
    // ^BXo,h,s,c,r,f,g,a. The format ID (f) applies to quality 0-140 only and
    // is intentionally dropped on canonicalization. g=_ (GS1 escape char) and
    // the transform compose with ^FN/variable binding via fdFieldFor.
    const params: (string | number)[] = [
      p.rotation,
      p.dimension,
      p.quality,
      p.columns ?? '',
      p.rows ?? '',
      '',
      p.gs1 ? DATAMATRIX_FD_ESCAPE : '',
      isRectangular(p) ? 2 : '',
    ];
    while (params.at(-1) === '') params.pop();
    return [
      fieldPosZ(obj),
      `^BX${params.join(',')}`,
      fdFieldFor(p.content, ctx, p.gs1 ? dmGs1Fd : undefined, undefined, CONTROL_CHARS && !p.gs1),
    ].join('');
  },
};

/** Rectangular is a quality-200 feature; below that the firmware prints square. */
export function isRectangular(p: DataMatrixProps): boolean {
  return p.aspectRatio === 2 && p.quality === 200;
}

/** Whether [rows, columns] is one of the DMRE rectangular sizes. */
export function isDmRectPair(rows: number, columns: number): boolean {
  return DM_RECT_SIZES.some(([r, c]) => r === rows && c === columns);
}

/** Forceable [rows, columns] sizes for the symbol's shape, capacity-ordered. */
export function dmSizePairs(p: DataMatrixProps): readonly (readonly [number, number])[] {
  return isRectangular(p) ? DM_RECT_SIZES : DM_SQUARE_SIZES.map((s) => [s, s] as const);
}

/** Patch for a quality change: crossing the ECC-200 boundary invalidates the
 *  stored symbol size and shape (c/r value ranges and the a param are
 *  tier-specific, e.g. odd 9-49 below 200 vs even 10-144 at 200). */
export function qualityPatch(
  p: DataMatrixProps,
  quality: DataMatrixProps['quality'],
): Partial<DataMatrixProps> {
  if ((quality === 200) === (p.quality === 200)) return { quality };
  return { quality, aspectRatio: undefined, columns: undefined, rows: undefined };
}

/** bwip `version` string for an explicit, firmware-valid symbol size;
 *  undefined = auto-size (also for pairs the encoder would reject). */
export function dmVersionString(p: DataMatrixProps): string | undefined {
  const { columns, rows } = p;
  if (!columns || !rows || p.quality !== 200) return undefined;
  const valid = dmSizePairs(p).some(([r, c]) => r === rows && c === columns);
  return valid ? `${rows}x${columns}` : undefined;
}
