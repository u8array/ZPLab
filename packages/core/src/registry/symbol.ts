import type { ObjectTypeCore } from '../types/ObjectType';
import { fieldPosZ } from './zplHelpers';
import { commitRotatedWidthHeightTransform } from './transformHelpers';
import type { ZplRotation } from './rotation';

/**
 * ZPL `^GS` Graphic Symbol. Five canonical glyphs Zebra firmware
 * renders from an internal font; used for legal markings on retail
 * and certification labels. Higher-letter codes exist in some firmware
 * but aren't portable; we ship the five every Zebra printer supports.
 */
export const GS_SYMBOLS = [
  { code: 'A', label: 'symbolRegistered', glyph: '®' },
  { code: 'B', label: 'symbolCopyright', glyph: '©' },
  { code: 'C', label: 'symbolTrademark', glyph: '™' },
  { code: 'D', label: 'symbolUL', glyph: 'UL' },
  { code: 'E', label: 'symbolCSA', glyph: 'CSA' },
] as const satisfies readonly { code: string; label: string; glyph: string }[];

export type SymbolCode = (typeof GS_SYMBOLS)[number]['code'];

/** Fallback when an import carries an unknown ^GS code (firmware-
 *  specific extension or hand-typed garbage). Matches Zebra's own
 *  default rendering; a © glyph that the user can immediately spot
 *  and replace via the Properties panel. */
export const DEFAULT_GS_SYMBOL: SymbolCode = 'B';
/** Resolved GS_SYMBOLS entry for the DEFAULT_GS_SYMBOL code. Renderers
 *  use this as a typed fallback when `find` returns undefined, so they
 *  can avoid non-null assertions on the lookup result. Looked up by
 *  code so reordering GS_SYMBOLS doesn't silently break the fallback. */
export const DEFAULT_GS_SYMBOL_META =
  GS_SYMBOLS.find((s) => s.code === DEFAULT_GS_SYMBOL) ?? GS_SYMBOLS[0];

/** Set of recognised ^GS codes; used by the parser to validate the
 *  ^FD payload without re-listing the letters. Single source of truth
 *  for which codes round-trip cleanly. */
export const GS_SYMBOL_CODES: ReadonlySet<string> = new Set(GS_SYMBOLS.map((s) => s.code));

export interface SymbolProps {
  /** Single-letter ZPL ^GS code that selects which symbol the printer
   *  renders. A=®, B=©, C=™, D=UL logo, E=CSA logo. */
  symbol: SymbolCode;
  height: number;
  width: number;
  rotation: ZplRotation;
}

export const symbol: ObjectTypeCore<SymbolProps> = {
  label: 'Symbol',
  icon: '©',
  zplCmd: '^GS',
  group: 'text' as const,
  defaultProps: {
    symbol: 'B',
    height: 30,
    width: 30,
    rotation: 'N',
  },
  defaultSize: { width: 30, height: 30 },

  toZPL: (obj) => {
    const p = obj.props;
    return `${fieldPosZ(obj)}^GS${p.rotation},${p.height},${p.width}^FD${p.symbol}^FS`;
  },

  commitTransform: commitRotatedWidthHeightTransform,
};
