import type { ObjectTypeCore } from "../types/ObjectType";
import { fieldPosZ, fdFieldFor } from "./zplHelpers";
import { clamp, commitStacked2DTransform } from "./transformHelpers";
import { moduleTooSmallPreflight } from "../lib/barcodeScannability";
import { type ZplRotation } from "./rotation";

/** CODABLOCK A requires ^BY module width >= 2 (spec). */
const CODABLOCK_MODULE_WIDTH_MIN = 2;

/** CODABLOCK ^BB c (chars per row): the ZPL spec range, kept faithfully so an
 *  imported c is preserved on re-emit. Row count derives from data length ÷ c;
 *  the firmware collapses to one row unless c is given (verified on a ZD230: r
 *  alone does not stack). */
export const CODABLOCK_COLUMNS_MIN = 2;
export const CODABLOCK_COLUMNS_MAX = 62;
export const CODABLOCK_DEFAULT_COLUMNS = 6;
/** bwip-js codablockf rejects columns below 4, so the on-canvas preview (and the
 *  panel input that steers new values) floor here; the model/emit still carry
 *  the true 2-62 so print and round-trip stay faithful for an imported c of 2-3. */
export const CODABLOCK_PREVIEW_COLUMNS_MIN = 4;

/** Clamp to the ^BB c range; also backfills legacy objects and imports that
 *  predate the columns prop (undefined → default). */
export function clampCodablockColumns(columns: number | undefined): number {
  if (columns == null || !Number.isFinite(columns)) return CODABLOCK_DEFAULT_COLUMNS;
  return clamp(CODABLOCK_COLUMNS_MIN, CODABLOCK_COLUMNS_MAX, Math.round(columns));
}

export interface CodablockProps {
  content: string;
  moduleWidth: number; // bar width in dots
  rowHeight: number; // row height in dots
  columns: number; // ^BB c: data chars per row; drives the stacked row count
  securityLevel: "Y" | "N"; // security check
  rotation: ZplRotation;
}

export const codablock: ObjectTypeCore<CodablockProps> = {
  label: "CODABLOCK",
  icon: "▥B",
  zplCmd: "^BB",
  group: "code-2d",
  barcodeClass: 'stacked2d',
  bindable: true,
  preflight: moduleTooSmallPreflight<CodablockProps>('moduleWidth'),
  defaultProps: {
    content: '',
    moduleWidth: 2,
    rowHeight: 2,
    columns: CODABLOCK_DEFAULT_COLUMNS,
    securityLevel: "Y",
    rotation: 'N',
  },
  // Alphanumeric so the default drag renders at the firmware width (numeric
  // data the printer compacts, which the canvas can only approximate).
  placeholderContent: 'CODABLOCK',
  defaultSize: { width: 250, height: 120 },

  moduleWidthMin: CODABLOCK_MODULE_WIDTH_MIN,
  commitTransform: (obj, ctx) => commitStacked2DTransform(obj, ctx, CODABLOCK_MODULE_WIDTH_MIN),

  toZPL: (obj, ctx) => {
    const p = obj.props;
    // ^BB{orientation},{rowHeight},{security},{numCharsPerRow},{numRows},{mode}.
    // Set chars/row (c) and leave rows (r) empty: the firmware derives the row
    // count from the data and stacks only when c is present (r alone does not
    // stack, verified on a ZD230). Mode F (Code 128) matches the codablockf preview.
    return [
      `^BY${p.moduleWidth}`,
      fieldPosZ(obj),
      `^BB${p.rotation},${p.rowHeight},${p.securityLevel},${clampCodablockColumns(p.columns)},,F`,
      fdFieldFor(p.content, ctx),
    ]
      .filter(Boolean)
      .join("");
  },
};
