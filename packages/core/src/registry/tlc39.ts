import type { ObjectTypeCore } from "../types/ObjectType";
import { fieldPosZ, fdFieldFor } from "./zplHelpers";
import { commitBarcodeWidthHeightTransform } from "./transformHelpers";
import { limitedSupportPreflight } from "../lib/barcodeScannability";
import { type ZplRotation } from "./rotation";

export interface Tlc39Props {
  /** TLC39 data: `<ECI>,<serial>`. ECI is 6 digits; serial is up to
   *  25 alphanumeric characters (rendered as MicroPDF417 stacked on
   *  top of the Code 39 base line). Comma is the canonical separator
   *  per spec. */
  content: string;
  /** Code 39 narrow bar width in dots (1-10, default from ^BY). */
  moduleWidth: number;
  /** Code 39 height in dots (the dominant visible component). */
  height: number;
  /** MicroPDF417 row height in dots (1-255, default 4). */
  microPdfRowHeight: number;
  /** MicroPDF417 row count. Zebra ^BT h2 accepts 1-10 (narrower than
   *  standalone ^BF since TLC39's linked MicroPDF is fixed at 4 columns);
   *  firmware snaps to a valid row count {4,6,8,10}. Default 4. */
  microPdfRows: number;
  rotation: ZplRotation;
}

export const tlc39: ObjectTypeCore<Tlc39Props> = {
  label: "TLC39",
  icon: "▦T",
  zplCmd: "^BT",
  group: "legacy",
  bindable: true,
  preflight: limitedSupportPreflight<Tlc39Props>('moduleWidth'),
  defaultProps: {
    content: '',
    moduleWidth: 2,
    height: 40,
    microPdfRowHeight: 4,
    microPdfRows: 4,
    rotation: "N",
  },
  placeholderContent: '123456,SERIAL',
  defaultSize: { width: 200, height: 80 },

  commitTransform: commitBarcodeWidthHeightTransform,

  toZPL: (obj, ctx) => {
    const p = obj.props;
    return [
      `^BY${p.moduleWidth}`,
      fieldPosZ(obj),
      // r1 (wide:narrow ratio) is not exposed as a prop; emit the
      // canonical "2" so the field round-trips.
      `^BT${p.rotation},${p.moduleWidth},2,${p.height},${p.microPdfRowHeight},${p.microPdfRows}`,
      fdFieldFor(p.content, ctx),
    ]
      .filter(Boolean)
      .join("");
  },
};
