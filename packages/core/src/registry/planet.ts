import { BARCODE_1D_PROP_SPECS, createBarcode1DCore, type Barcode1DCoreConfig } from './barcode1d';
import { planetData } from './firmwareRules';
export type { Barcode1DProps as PlanetProps } from "./barcode1d";

export const planetCoreConfig: Barcode1DCoreConfig = {
  label: "Planet Code",
  icon: "✉P",
  placeholderContent: '12345678901',
  firmwareData: planetData,
  // ZD230-measured: the line shows the digits as sent, without the fill.
  hri: { formatHri: (content) => content.replace(/\D/g, '') },
  group: 'legacy',
  propSpecs: BARCODE_1D_PROP_SPECS,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    return `^B5${p.rotation},${p.height},${interp},${p.printInterpretationAbove ? "Y" : "N"}`;
  },
  contentSpec: { charset: '0-9' },
};

export const planet = createBarcode1DCore(planetCoreConfig);
