import type { PropSpecs } from '../types/propSpec';
import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig, type Barcode1DProps } from './barcode1d';
import { code128ControlFd, code128PlainFd } from '../lib/code128Subset';
import { code128Mode } from '../lib/code128Plan';
import { formatCode128Hri } from './hriFormatters';

/** Absent is N, and D comes from `gs1`. */
export const CODE128_STORED_MODES = ['A'] as const;

export interface Code128Props extends Barcode1DProps {
  /** GS1-128 mode (`^BC…,D`). */
  gs1?: boolean;
  /** ^BC m=A, the firmware's automatic subsets; `gs1` wins. */
  mode?: (typeof CODE128_STORED_MODES)[number];
}

export const CODE128_PROP_SPECS: PropSpecs<Code128Props> = {
  ...BARCODE_1D_PROP_SPECS,
  gs1: { type: 'boolean' },
  mode: { type: 'string', values: CODE128_STORED_MODES },
};

export const code128CoreConfig: Barcode1DCoreConfig<Code128Props> = {
  label: 'Code 128',
  icon: '|||',
  placeholderContent: '12345678',
  group: 'code-1d',
  gs1Capable: true,
  propSpecs: CODE128_PROP_SPECS,
  // Code Set A covers the C0 range.
  controlChars: true,
  ctrlFdEncode: code128ControlFd,
  fdPlainEscape: code128PlainFd,
  hri: { formatHri: formatCode128Hri },
  zplCommand: (p) => {
    const interp = p.printInterpretation ? 'Y' : 'N';
    const check = p.checkDigit ? 'Y' : 'N';
    // m=N is the bare command, so a plain field round-trips byte-identically.
    const mode = code128Mode(p);
    return `^BC${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? 'Y' : 'N'},${check}${mode === 'N' ? '' : `,${mode}`}`;
  },
};

export const code128 = createBarcode1DCore(code128CoreConfig);
