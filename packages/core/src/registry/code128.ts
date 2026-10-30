import { createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { code128ControlFd, code128PlainFd } from '../lib/code128Subset';
import { code128Mode } from '../lib/code128Plan';
import { formatCode128Hri } from './hriFormatters';
export type { Barcode1DProps as Code128Props } from './barcode1d';

export const code128CoreConfig: Barcode1DCoreConfig = {
  label: 'Code 128',
  icon: '|||',
  placeholderContent: '12345678',
  group: 'code-1d',
  gs1Capable: true,
  autoModeCapable: true,
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
