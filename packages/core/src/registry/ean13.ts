import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { formatEan13Hri } from './hriFormatters';
export type { Barcode1DProps as Ean13Props } from './barcode1d';

export const ean13CoreConfig: Barcode1DCoreConfig = {
  label: 'EAN-13',
  icon: 'EAN',
  placeholderContent: '590123412345',
  group: 'code-1d',
  propSpecs: BARCODE_1D_PROP_SPECS,
  serialisable: false,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? 'Y' : 'N';
    return `^BE${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? 'Y' : 'N'}`;
  },
  hri: { formatHri: formatEan13Hri },
  contentSpec: { charset: '0-9', maxLength: 12 },
};

export const ean13 = createBarcode1DCore(ean13CoreConfig);
