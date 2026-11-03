import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { formatUpceHri, upceData6FromFd } from './hriFormatters';
export type { Barcode1DProps as UpcEProps } from './barcode1d';

export const upceCoreConfig: Barcode1DCoreConfig = {
  label: 'UPC-E',
  icon: 'UPE',
  placeholderContent: '012345',
  group: 'code-1d',
  propSpecs: BARCODE_1D_PROP_SPECS,
  serialisable: false,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? 'Y' : 'N';
    // ^B9 params: rotation, height, interpretation, interpretationAbove.
    return `^B9${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? 'Y' : 'N'}`;
  },
  hri: { formatHri: formatUpceHri },
  // ^B9 needs the number-system digit in ^FD (else Labelary lints/re-pads).
  // NS-aware so an already-prefixed content is not double-prefixed. NS
  // assumed 0 (spec allows 0 or 1; NS 1 round-trips lossily, see ticket).
  // Empty stays empty: the padding would otherwise fabricate a scannable
  // 0000000 UPC-E from a blank field, breaking the empty-^FD invariant.
  fdContent: (c) => (c === '' ? '' : `0${upceData6FromFd(c)}`),
  contentSpec: { charset: '0-9', maxLength: 6 },
};

export const upce = createBarcode1DCore(upceCoreConfig);
