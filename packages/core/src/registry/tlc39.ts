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
  /** Code 39 wide:narrow ratio (^BT r1, 2.0-3.0, default 2). */
  wideRatio: number;
  /** Code 39 height in dots (the dominant visible component). */
  height: number;
  /** MicroPDF417 narrow bar width in dots (^BT w2, 1-10, default 2). */
  microPdfModuleWidth: number;
  /** MicroPDF417 row height in dots (^BT h2, 1-255, default 4). The row
   *  COUNT has no ZPL param: the firmware derives it from the serial
   *  (always 4 columns, smallest version from 6 rows up, ZD230-measured). */
  microPdfRowHeight: number;
  rotation: ZplRotation;
}

// Single list for metadata, preflight and resize; one place to grow.
const EXTRA_MODULE_WIDTH_PROPS = ['microPdfModuleWidth'] as const;

export const tlc39: ObjectTypeCore<Tlc39Props> = {
  label: "TLC39",
  icon: "▦T",
  zplCmd: "^BT",
  group: "legacy",
  bindable: true,
  extraModuleWidthProps: EXTRA_MODULE_WIDTH_PROPS,
  preflight: limitedSupportPreflight<Tlc39Props>(['moduleWidth', 'w1'], ['microPdfModuleWidth', 'w2']),
  defaultProps: {
    content: '',
    moduleWidth: 2,
    wideRatio: 2,
    height: 40,
    microPdfModuleWidth: 2,
    microPdfRowHeight: 4,
    rotation: "N",
  },
  placeholderContent: '123456,SERIAL',
  defaultSize: { width: 200, height: 80 },

  commitTransform: (obj, ctx) =>
    commitBarcodeWidthHeightTransform(obj, ctx, EXTRA_MODULE_WIDTH_PROPS),

  toZPL: (obj, ctx) => {
    const p = obj.props;
    return [
      fieldPosZ(obj),
      `^BY${p.moduleWidth}`,
      `^BT${p.rotation},${p.moduleWidth},${p.wideRatio},${p.height},${p.microPdfModuleWidth},${p.microPdfRowHeight}`,
      fdFieldFor(p.content, ctx),
    ]
      .filter(Boolean)
      .join("");
  },
};
