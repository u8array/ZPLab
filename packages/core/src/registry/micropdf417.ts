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
      `^BY${p.moduleWidth}`,
      fieldPosZ(obj),
      `^BF${p.rotation},${p.rowHeight},${p.mode}`,
      fdFieldFor(p.content, ctx, undefined, undefined, CONTROL_CHARS),
    ]
      .filter(Boolean)
      .join("");
  },
};
