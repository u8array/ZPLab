import type { PropSpecs } from '../types/propSpec';
import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig, type Barcode1DProps } from './barcode1d';
import { formatMsiHri } from './hriFormatters';

export const MSI_CHECK_MODES = ['C', 'D'] as const;

export interface MsiProps extends Barcode1DProps {
  /** ^BM e beyond the boolean (C = 2x Mod 10, D = Mod 11 + Mod 10); set by
   *  import, not the panel. */
  msiCheckMode?: (typeof MSI_CHECK_MODES)[number];
  /** ^BM e2: HRI includes the check digits. Set by import, not the panel. */
  msiHriCheck?: boolean;
}

export const MSI_PROP_SPECS: PropSpecs<MsiProps> = {
  ...BARCODE_1D_PROP_SPECS,
  msiCheckMode: { type: 'string', values: MSI_CHECK_MODES },
  msiHriCheck: { type: 'boolean' },
};

export const msiCoreConfig: Barcode1DCoreConfig<MsiProps> = {
  label: "MSI",
  icon: "MSI",
  placeholderContent: '12345678',
  group: 'legacy',
  propSpecs: MSI_PROP_SPECS,
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
