import { createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { formatInterleaved2of5Hri } from './hriFormatters';
export type { Barcode1DProps as Interleaved2of5Props } from './barcode1d';

export const interleaved2of5CoreConfig: Barcode1DCoreConfig = {
  label: 'Interleaved 2 of 5',
  icon: 'I25',
  placeholderContent: '12345678',
  group: 'code-1d',
  hri: { formatHri: formatInterleaved2of5Hri },
  zplCommand: (p) => {
    const interp = p.printInterpretation ? 'Y' : 'N';
    const check = p.checkDigit ? 'Y' : 'N';
    return `^B2${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? 'Y' : 'N'},${check}`;
  },
  contentSpec: { charset: '0-9' },
};

export const interleaved2of5 = createBarcode1DCore(interleaved2of5CoreConfig);
