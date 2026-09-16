import type { PropSpecs } from '../types/propSpec';
import type { ObjectTypeCore } from "../types/ObjectType";
import { fieldPosZ, fdFieldFor } from "./zplHelpers";
import { commitBarcodeWidthHeightTransform, moduleWidthSpec } from "./transformHelpers";
import { limitedSupportPreflight } from "../lib/barcodeScannability";
import { type ZplRotation, ROTATION_SPEC } from "./rotation";

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

export const TLC39_PROP_SPECS: PropSpecs<Tlc39Props> = {
  content: { type: 'string' },
  moduleWidth: moduleWidthSpec(),
  wideRatio: { type: 'number', min: 2, max: 3, scale: 'never' },
  height: { type: 'number', scale: 'dots' },
  microPdfModuleWidth: moduleWidthSpec(),
  microPdfRowHeight: { type: 'number', scale: 'dots' },
  rotation: ROTATION_SPEC,
};

export const tlc39: ObjectTypeCore<Tlc39Props> = {
  label: "TLC39",
  icon: "▦T",
  zplCmd: "^BT",
  group: "legacy",
  bindable: true,
  preflight: limitedSupportPreflight<Tlc39Props>(['moduleWidth', 'w1'], ['microPdfModuleWidth', 'w2']),
  propSpecs: TLC39_PROP_SPECS,
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
    commitBarcodeWidthHeightTransform(obj, ctx, TLC39_PROP_SPECS),

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
