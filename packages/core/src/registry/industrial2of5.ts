import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
export type { Barcode1DProps as Industrial2of5Props } from "./barcode1d";

export const industrial2of5CoreConfig: Barcode1DCoreConfig = {
  label: "Industrial 2 of 5",
  icon: "I25",
  placeholderContent: '12345678',
  group: 'legacy',
  propSpecs: BARCODE_1D_PROP_SPECS,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    return `^BI${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? "Y" : "N"}`;
  },
  contentSpec: { charset: '0-9' },
};

export const industrial2of5 = createBarcode1DCore(industrial2of5CoreConfig);
