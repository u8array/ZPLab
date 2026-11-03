import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
export type { Barcode1DProps as CodabarProps } from "./barcode1d";

export const codabarCoreConfig: Barcode1DCoreConfig = {
  label: "Codabar",
  icon: "CBA",
  placeholderContent: 'A12345A',
  group: 'legacy',
  propSpecs: BARCODE_1D_PROP_SPECS,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    const check = p.checkDigit ? "Y" : "N";
    return `^BK${p.rotation},${check},${p.height},${interp},${p.printInterpretationAbove ? "Y" : "N"}`;
  },
  contentSpec: { charset: '0-9A-Da-d\\-$:/.+' },
};

export const codabar = createBarcode1DCore(codabarCoreConfig);
