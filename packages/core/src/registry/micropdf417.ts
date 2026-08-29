import type { ObjectTypeCore } from "../types/ObjectType";
import { fieldPosZ, fdFieldFor } from "./zplHelpers";
import { commitStacked2DTransform } from "./transformHelpers";
import { moduleTooSmallPreflight } from "../lib/barcodeScannability";
import { type ZplRotation } from "./rotation";

export interface MicroPdf417Props {
  content: string;
  moduleWidth: number; // bar width in dots
  rowHeight: number; // row height in dots
  mode: number;
  rotation: ZplRotation;
}

// One switch for the capability flag and the emitter's chip resolution.
const CONTROL_CHARS = true;

interface Micropdf417Mode {
  columns: number;
  rows: number;
  maxAlpha: number;
  maxDigits: number;
  /** ISO error-correction codewords; total codewords = columns * rows. The
   *  Table-5 "% of CWS for EC" column is exactly ecCodewords / total. */
  ecCodewords: number;
}

/** ^BF mode -> fixed symbol version and capacity, Table 5 (spec p.112). */
const MICROPDF417_MODE_DIMS: readonly Micropdf417Mode[] = [
  { columns: 1, rows: 11, maxAlpha: 6, maxDigits: 8, ecCodewords: 7 },
  { columns: 1, rows: 14, maxAlpha: 12, maxDigits: 17, ecCodewords: 7 },
  { columns: 1, rows: 17, maxAlpha: 18, maxDigits: 26, ecCodewords: 7 },
  { columns: 1, rows: 20, maxAlpha: 22, maxDigits: 32, ecCodewords: 8 },
  { columns: 1, rows: 24, maxAlpha: 30, maxDigits: 44, ecCodewords: 8 },
  { columns: 1, rows: 28, maxAlpha: 38, maxDigits: 55, ecCodewords: 8 },
  { columns: 2, rows: 8, maxAlpha: 14, maxDigits: 20, ecCodewords: 8 },
  { columns: 2, rows: 11, maxAlpha: 24, maxDigits: 35, ecCodewords: 9 },
  { columns: 2, rows: 14, maxAlpha: 36, maxDigits: 52, ecCodewords: 9 },
  { columns: 2, rows: 17, maxAlpha: 46, maxDigits: 67, ecCodewords: 10 },
  { columns: 2, rows: 20, maxAlpha: 56, maxDigits: 82, ecCodewords: 11 },
  { columns: 2, rows: 23, maxAlpha: 64, maxDigits: 93, ecCodewords: 13 },
  { columns: 2, rows: 26, maxAlpha: 72, maxDigits: 105, ecCodewords: 15 },
  { columns: 3, rows: 6, maxAlpha: 10, maxDigits: 14, ecCodewords: 12 },
  { columns: 3, rows: 8, maxAlpha: 18, maxDigits: 26, ecCodewords: 14 },
  { columns: 3, rows: 10, maxAlpha: 26, maxDigits: 38, ecCodewords: 16 },
  { columns: 3, rows: 12, maxAlpha: 34, maxDigits: 49, ecCodewords: 18 },
  { columns: 3, rows: 15, maxAlpha: 46, maxDigits: 67, ecCodewords: 21 },
  { columns: 3, rows: 20, maxAlpha: 66, maxDigits: 96, ecCodewords: 26 },
  { columns: 3, rows: 26, maxAlpha: 90, maxDigits: 132, ecCodewords: 32 },
  { columns: 3, rows: 32, maxAlpha: 114, maxDigits: 167, ecCodewords: 38 },
  { columns: 3, rows: 38, maxAlpha: 138, maxDigits: 202, ecCodewords: 44 },
  { columns: 3, rows: 44, maxAlpha: 162, maxDigits: 237, ecCodewords: 50 },
  { columns: 4, rows: 6, maxAlpha: 22, maxDigits: 32, ecCodewords: 12 },
  { columns: 4, rows: 8, maxAlpha: 34, maxDigits: 49, ecCodewords: 14 },
  { columns: 4, rows: 10, maxAlpha: 46, maxDigits: 67, ecCodewords: 16 },
  { columns: 4, rows: 12, maxAlpha: 58, maxDigits: 85, ecCodewords: 18 },
  { columns: 4, rows: 15, maxAlpha: 76, maxDigits: 111, ecCodewords: 21 },
  { columns: 4, rows: 20, maxAlpha: 106, maxDigits: 155, ecCodewords: 26 },
  { columns: 4, rows: 26, maxAlpha: 142, maxDigits: 208, ecCodewords: 32 },
  { columns: 4, rows: 32, maxAlpha: 178, maxDigits: 261, ecCodewords: 38 },
  { columns: 4, rows: 38, maxAlpha: 214, maxDigits: 313, ecCodewords: 44 },
  { columns: 4, rows: 44, maxAlpha: 250, maxDigits: 366, ecCodewords: 50 },
  { columns: 4, rows: 4, maxAlpha: 14, maxDigits: 20, ecCodewords: 8 },
];

/** Out-of-band modes fall to the spec default 0. */
export function micropdf417ModeDims(mode: number): { columns: number; rows: number } {
  const m = MICROPDF417_MODE_DIMS[mode] ?? { columns: 1, rows: 11 };
  return { columns: m.columns, rows: m.rows };
}

/** Byte-compaction capacity of a version (1 latch codeword, then 5 codewords
 *  per 6 bytes); null for an unknown columns/rows pair. */
export function micropdf417ByteCapacity(columns: number, rows: number): number | null {
  const m = MICROPDF417_MODE_DIMS.find((e) => e.columns === columns && e.rows === rows);
  if (!m) return null;
  const dataCw = columns * rows - m.ecCodewords;
  return Math.max(0, Math.floor(((dataCw - 1) * 6) / 5));
}

/** ZD230-measured: the firmware prints NOTHING beyond the Table-5 capacity,
 *  so no canvas fallback may render. Non-alphanumeric bytes compact in byte
 *  mode on the firmware, so they rate against the byte capacity. */
export function micropdf417ModeFits(columns: number, rows: number, text: string): boolean {
  const m = MICROPDF417_MODE_DIMS.find((e) => e.columns === columns && e.rows === rows);
  if (!m) return true;
  if (/^\d*$/.test(text)) return text.length <= m.maxDigits;
  if (/^[0-9A-Z ]*$/.test(text)) return text.length <= m.maxAlpha;
  return text.length <= (micropdf417ByteCapacity(columns, rows) ?? m.maxAlpha);
}

export const micropdf417: ObjectTypeCore<MicroPdf417Props> = {
  label: "MicroPDF417",
  icon: "▤",
  zplCmd: "^BF",
  group: "code-2d",
  barcodeClass: 'stacked2d',
  bindable: true,
  controlChars: CONTROL_CHARS,
  defaultProps: {
    content: '',
    moduleWidth: 2,
    rowHeight: 2,
    mode: 0,
    rotation: 'N',
  },
  placeholderContent: '1234',
  defaultSize: { width: 200, height: 100 },

  preflight: moduleTooSmallPreflight<MicroPdf417Props>('moduleWidth'),

  commitTransform: commitStacked2DTransform,

  toZPL: (obj, ctx) => {
    const p = obj.props;
    // ^BF{orientation},{rowHeight},{mode}
    return [
      fieldPosZ(obj),
      `^BY${p.moduleWidth}`,
      `^BF${p.rotation},${p.rowHeight},${p.mode}`,
      fdFieldFor(p.content, ctx, undefined, undefined, CONTROL_CHARS),
    ]
      .filter(Boolean)
      .join("");
  },
};
