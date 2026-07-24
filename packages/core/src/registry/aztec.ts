import type { ObjectTypeCore } from "../types/ObjectType";
import { fieldPosZ, fdFieldFor } from "./zplHelpers";
import { moduleTooSmallPreflight } from "../lib/barcodeScannability";
import { type ZplRotation } from "./rotation";

export const MAGNIFICATION_MIN = 1;
export const MAGNIFICATION_MAX = 10;
export const EC_LEVEL_MIN = 0;
// NumberInput can't express the discontinuous AztecProps domain; use the
// highest valid value (Rune = 300) as the upper bound.
export const EC_LEVEL_MAX = 300;

export interface AztecProps {
  content: string;
  magnification: number; // module size in dots
  ecLevel: number; // 0=default, 1-99=error correction %, 101-104=compact, 201-232=full, 300=rune
  rotation: ZplRotation;
}

// One switch for the capability flag and the emitter's chip resolution.
const CONTROL_CHARS = true;

export const aztec: ObjectTypeCore<AztecProps> = {
  label: "Aztec",
  icon: "◇",
  zplCmd: "^B0",
  group: "code-2d",
  bindable: true,
  controlChars: CONTROL_CHARS,
  typedContent: true,
  defaultProps: {
    content: '',
    magnification: 4,
    ecLevel: 0,
    rotation: 'N',
  },
  placeholderContent: '1234567890',
  defaultSize: { width: 200, height: 200 },

  uniformScaleProp: { name: 'magnification', min: MAGNIFICATION_MIN, max: MAGNIFICATION_MAX },

  preflight: moduleTooSmallPreflight<AztecProps>('magnification'),

  toZPL: (obj, ctx) => {
    const p = obj.props;
    // ^B0 a,b,c,d,e,f,g = orientation, magnification, ecic, errorControl,
    // menuSymbol, numberOfSymbols, structuredID. ecLevel=0 is Zebra's
    // documented default for errorControl, so emitting it as-is is valid.
    return [
      fieldPosZ(obj),
      `^B0${p.rotation},${p.magnification},N,${p.ecLevel}`,
      fdFieldFor(p.content, ctx, undefined, undefined, CONTROL_CHARS),
    ].join("");
  },
};
