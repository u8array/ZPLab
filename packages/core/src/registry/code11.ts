import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { formatCode11Hri } from './hriFormatters';
export type { Barcode1DProps as Code11Props } from "./barcode1d";

export const code11CoreConfig: Barcode1DCoreConfig = {
  label: "Code 11",
  icon: "C11",
  placeholderContent: '12345',
  group: 'legacy',
  propSpecs: BARCODE_1D_PROP_SPECS,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    const check = p.checkDigit ? "Y" : "N";
    return `^B1${p.rotation},${check},${p.height},${interp},${p.printInterpretationAbove ? "Y" : "N"}`;
  },
  hri: { formatHri: formatCode11Hri, startStopGlyph: 'triangle' },
  contentSpec: { charset: '0-9\\-' },
};

export const code11 = createBarcode1DCore(code11CoreConfig);
