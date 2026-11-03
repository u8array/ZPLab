import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
export type { Barcode1DProps as PostalProps } from "./barcode1d";

export const postalCoreConfig: Barcode1DCoreConfig = {
  label: "POSTNET",
  icon: "✉Z",
  placeholderContent: '12345',
  group: 'legacy',
  propSpecs: BARCODE_1D_PROP_SPECS,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    // ^BZ{orientation},{height},{interp},{interpAbove}
    return `^BZ${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? "Y" : "N"}`;
  },
  contentSpec: { charset: '0-9' },
};

export const postal = createBarcode1DCore(postalCoreConfig);
