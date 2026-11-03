import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
export type { Barcode1DProps as Code93Props } from './barcode1d';

export const code93CoreConfig: Barcode1DCoreConfig = {
  label: 'Code 93',
  icon: '|93|',
  placeholderContent: 'CODE93',
  group: 'code-1d',
  propSpecs: BARCODE_1D_PROP_SPECS,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? 'Y' : 'N';
    const check = p.checkDigit ? 'Y' : 'N';
    return `^BA${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? 'Y' : 'N'},${check}`;
  },
  // Labelary draws Code 93's start/stop as a square; data shows without
  // the (non-displayed) check chars, so no formatHri.
  hri: { startStopGlyph: 'square' },
};

export const code93 = createBarcode1DCore(code93CoreConfig);
