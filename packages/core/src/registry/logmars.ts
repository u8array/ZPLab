import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { formatLogmarsHri } from "./hriFormatters";
import { LOGMARS_TEXT_ABOVE_GAP_DOTS } from "../lib/bwipConstants";
export type { Barcode1DProps as LogmarsProps } from "./barcode1d";

export const logmarsCoreConfig: Barcode1DCoreConfig = {
  label: "LOGMARS",
  icon: "LOG",
  placeholderContent: 'LOGMARS1',
  group: 'legacy',
  propSpecs: BARCODE_1D_PROP_SPECS,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    return `^BL${p.rotation},${p.height},${interp}`;
  },
  hri: {
    textAbove: true,
    aboveGapDots: LOGMARS_TEXT_ABOVE_GAP_DOTS,
    formatHri: formatLogmarsHri,
  },
  contentSpec: { charset: '0-9A-Za-z\\-. $/+%' },
};

export const logmars = createBarcode1DCore(logmarsCoreConfig);
