import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
export type { Barcode1DProps as Standard2of5Props } from "./barcode1d";

export const standard2of5CoreConfig: Barcode1DCoreConfig = {
  label: "Standard 2 of 5",
  icon: "S25",
  placeholderContent: '12345678',
  group: 'legacy',
  propSpecs: BARCODE_1D_PROP_SPECS,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    return `^BJ${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? "Y" : "N"}`;
  },
  contentSpec: { charset: '0-9' },
};

export const standard2of5 = createBarcode1DCore(standard2of5CoreConfig);
