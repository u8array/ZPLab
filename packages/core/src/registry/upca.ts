import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { formatUpcaHri } from './hriFormatters';
export type { Barcode1DProps as UpcAProps } from './barcode1d';

export const upcaCoreConfig: Barcode1DCoreConfig = {
  label: 'UPC-A',
  icon: 'UPC',
  placeholderContent: '01234567890',
  group: 'code-1d',
  propSpecs: BARCODE_1D_PROP_SPECS,
  serialisable: false,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? 'Y' : 'N';
    // ^BU params: rotation, height, interpretation, above, checkDigit.
    // checkDigit=Y matches Zebra's default and the retail/UPC-A print
    // convention; the 12th digit floats right of the bars, analogous
    // to the system digit on the left.
    return `^BU${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? 'Y' : 'N'},Y`;
  },
  hri: { formatHri: formatUpcaHri },
  contentSpec: { charset: '0-9', maxLength: 11 },
};

export const upca = createBarcode1DCore(upcaCoreConfig);
