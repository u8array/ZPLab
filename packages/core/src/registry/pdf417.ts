import type { ObjectTypeCore } from "../types/ObjectType";
import { fieldPosZ, fdFieldFor } from "./zplHelpers";
import { commitStacked2DTransform } from "./transformHelpers";
import { moduleTooSmallPreflight } from "../lib/barcodeScannability";
import { type ZplRotation } from "./rotation";

/** ^BY module width with ^B7 is 2 to 10 (spec p.82), unlike the general 1. */
const PDF417_MODULE_WIDTH_MIN = 2;

export interface Pdf417Props {
  content: string;
  rowHeight: number;
  securityLevel: number; // 0–8
  columns: number; // 1–30, 0 = auto
  moduleWidth: number;
  rotation: ZplRotation;
}

// One switch for the capability flag and the emitter's chip resolution.
const CONTROL_CHARS = true;

export const pdf417: ObjectTypeCore<Pdf417Props> = {
  label: "PDF417",
  icon: "▥",
  zplCmd: "^B7",
  group: "code-2d",
  barcodeClass: 'stacked2d',
  bindable: true,
  controlChars: CONTROL_CHARS,
  defaultProps: {
    content: '',
    rowHeight: 2,
    securityLevel: 0,
    columns: 0,
    moduleWidth: 2,
    rotation: 'N',
  },
  placeholderContent: '1234567890',
  defaultSize: { width: 300, height: 150 },

  moduleWidthMin: PDF417_MODULE_WIDTH_MIN,
  preflight: moduleTooSmallPreflight<Pdf417Props>('moduleWidth'),
  commitTransform: (obj, ctx) => commitStacked2DTransform(obj, ctx, PDF417_MODULE_WIDTH_MIN),

  toZPL: (obj, ctx) => {
    const p = obj.props;
    return [
      fieldPosZ(obj),
      `^BY${p.moduleWidth}`,
      `^B7${p.rotation},${p.rowHeight},${p.securityLevel},${p.columns},,,`,
      fdFieldFor(p.content, ctx, undefined, undefined, CONTROL_CHARS),
    ]
      .filter(Boolean)
      .join("");
  },
};
