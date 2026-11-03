import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
export type { Barcode1DProps as PlesseyProps } from "./barcode1d";

/** Plessey uses 2:1 wide:narrow (same as MSI), overriding the ZPL default of
 *  3.0. Single source for the ^BY emit AND the canvas bar-width remap. */
export const PLESSEY_RATIO = 2;

export const plesseyCoreConfig: Barcode1DCoreConfig = {
  label: "Plessey",
  icon: "PLS",
  placeholderContent: '12345678',
  group: 'legacy',
  propSpecs: BARCODE_1D_PROP_SPECS,
  byRatio: PLESSEY_RATIO,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    const check = p.checkDigit ? "Y" : "N";
    return `^BP${p.rotation},${check},${p.height},${interp},${p.printInterpretationAbove ? "Y" : "N"}`;
  },
  contentSpec: { charset: '0-9A-Fa-f' },
};

export const plessey = createBarcode1DCore(plesseyCoreConfig);
