import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { checkDigitPreflight } from '../lib/eanUpcValidate';
import { fixedDigits } from './firmwareRules';
import { formatEan8Hri } from './hriFormatters';
export type { Barcode1DProps as Ean8Props } from './barcode1d';

export const ean8CoreConfig: Barcode1DCoreConfig = {
  label: 'EAN-8',
  icon: 'E8',
  placeholderContent: '1234567',
  firmwareData: (c) => fixedDigits(c, 7),
  valuePreflight: checkDigitPreflight('ean8'),
  group: 'code-1d',
  propSpecs: BARCODE_1D_PROP_SPECS,
  serialisable: false,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? 'Y' : 'N';
    return `^B8${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? 'Y' : 'N'}`;
  },
  hri: { formatHri: formatEan8Hri },
  contentSpec: { charset: '0-9', maxLength: 7 },
};

export const ean8 = createBarcode1DCore(ean8CoreConfig);
