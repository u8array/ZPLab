import { createBarcode1DPanel } from './barcode1d.panel';
import type { MsiProps } from '@zplab/core/registry/msi';

export const msiPanel = createBarcode1DPanel<MsiProps>({
  zplCommand: '^BM',
  locale: (t) => t.registry.msi,
  hasCheckDigit: true,
  hriAboveConfigurable: true,
  // Toggling drops the imported ^BM extras (C/D mode, e2 HRI digit): they
  // would otherwise stick invisibly to the emit.
  checkDigitPatch: (checkDigit) => ({ checkDigit, msiCheckMode: undefined, msiHriCheck: undefined }),
});
