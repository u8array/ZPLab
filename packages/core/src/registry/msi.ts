import { createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { formatMsiHri } from './hriFormatters';
export type { Barcode1DProps as MsiProps } from "./barcode1d";

export const msiCoreConfig: Barcode1DCoreConfig = {
  label: "MSI",
  icon: "MSI",
  placeholderContent: '12345678',
  group: 'legacy',
  // MSI standard specifies a 2:1 wide:narrow ratio, which bwip-js hardcodes
  // internally. ZPL ^BY defaults to 3.0, so we must override to keep canvas
  // and Labelary preview in sync.
  byRatio: 2,
  hri: { formatHri: formatMsiHri },
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    // ^BMo,e,h,f,g,e2; e: A=no check, B=1 Mod 10 (spec p.122, ZD230-measured:
    // A is one digit narrower); C/D re-emit verbatim. e2 only when set, so
    // designs without it keep the 5-param wire.
    const checkType = p.checkDigit ? (p.msiCheckMode ?? "B") : "A";
    const e2 = p.msiHriCheck ? ",Y" : "";
    return `^BM${p.rotation},${checkType},${p.height},${interp},${p.printInterpretationAbove ? "Y" : "N"}${e2}`;
  },
  contentSpec: { charset: '0-9' },
};

export const msi = createBarcode1DCore(msiCoreConfig);
