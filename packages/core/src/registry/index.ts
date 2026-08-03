import type { ObjectTypeCore } from '../types/ObjectType';
import type { LeafType, ObjectRegistryMap } from './leafObject';
import { resolveContentSpec, type ContentSpec } from './contentSpec';
import type { CtrlParity } from '../lib/markerResolve';

export type { LeafObject, LeafType } from './leafObject';

import { text } from './text';
import { code128 } from './code128';
import { code39 } from './code39';
import { ean13 } from './ean13';
import { qrcode } from './qrcode';
import { datamatrix } from './datamatrix';
import { box } from './box';
import { ellipse } from './ellipse';
import { line } from './line';
import { image } from './image';
import { upca } from './upca';
import { ean8 } from './ean8';
import { upce } from './upce';
import { interleaved2of5 } from './interleaved2of5';
import { code93 } from './code93';
import { pdf417 } from './pdf417';
import { code11 } from './code11';
import { industrial2of5 } from './industrial2of5';
import { standard2of5 } from './standard2of5';
import { codabar } from './codabar';
import { logmars } from './logmars';
import { msi } from './msi';
import { plessey } from './plessey';
import { gs1databar } from './gs1databar';
import { planet } from './planet';
import { postal } from './postal';
import { aztec } from './aztec';
import { micropdf417 } from './micropdf417';
import { codablock } from './codablock';
import { upcEanExtension } from './upcEanExtension';
import { code49 } from './code49';
import { maxicode } from './maxicode';
import { tlc39 } from './tlc39';
import { symbol } from './symbol';

// Graphic shape primitives (no `props.rotation`): box/ellipse/line. They
// quarter-turn via geometry (w/h swap, or a line's angle), unlike image which
// shares `group: 'shape'` but cannot turn. Shared by single-object rotation,
// tidy classification and multi-resize scaling (content types move only).
// `satisfies` catches a typo/rename; the Set stays string-keyed so
// `.has(obj.type)` (a string) type-checks.
export const SHAPE_PRIMITIVE_TYPES: ReadonlySet<string> = new Set(
  ['box', 'ellipse', 'line'] as const satisfies readonly LeafType[],
);

// satisfies = exhaustiveness check; export type stays permissive.
const _ObjectRegistry = {
  // text
  text,
  symbol,
  // code-1d (modern, frequency order)
  code128,
  ean13,
  upca,
  code39,
  interleaved2of5,
  gs1databar,
  ean8,
  upce,
  upcEanExtension,
  code93,
  // code-2d (frequency order)
  qrcode,
  datamatrix,
  pdf417,
  aztec,
  maxicode,
  micropdf417,
  codablock,
  // legacy (palette bottom): still-used first, oldest/rarest last
  codabar,
  logmars,
  code49,
  tlc39,
  postal,
  planet,
  code11,
  msi,
  standard2of5,
  industrial2of5,
  plessey,
  // shape
  box,
  ellipse,
  line,
  image,
} satisfies ObjectRegistryMap;

/** Per-type Core entries. Literal-key access catches typos; use
 *  {@link getEntry} for dynamic `LabelObject['type']` lookups. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ObjectRegistry: Record<LeafType, ObjectTypeCore<any>> = _ObjectRegistry;

/** Dimensional truth for emit/rotation/bounds consumers, derived from each
 *  entry's `barcodeClass`: a symbology missing here would silently lose
 *  HRI/transformer/bounds behaviour, so membership is never hand-maintained
 *  and is pinned by registry-isolation.test. */
export const BARCODE_1D_TYPES: ReadonlySet<string> = new Set(
  (Object.keys(ObjectRegistry) as LeafType[]).filter((t) => ObjectRegistry[t].barcodeClass === '1d'),
);

export const STACKED_2D_TYPES: ReadonlySet<string> = new Set(
  (Object.keys(ObjectRegistry) as LeafType[]).filter((t) => ObjectRegistry[t].barcodeClass === 'stacked2d'),
);

/** True when this type's emitter serializes fieldJustify (graphicAnchor for
 *  graphics, the z echo for the rest, the gated printerAnchoredX for 1D).
 *  Over-broad for gated 1D by design: precisely judging the R+N transition
 *  here would duplicate emit logic, and over-stamping only regenerates bytes. */
export function emitsFieldJustify(type: string, emit1dZJustify = false): boolean {
  return emit1dZJustify || !BARCODE_1D_TYPES.has(type);
}

/** Dynamic lookup for `LabelObject['type']`; undefined for non-leaf (e.g. `'group'`). */
export function getEntry(type: string): (typeof ObjectRegistry)[LeafType] | undefined {
  return (ObjectRegistry as Record<string, (typeof ObjectRegistry)[LeafType] | undefined>)[type];
}

/** Single evaluation point for {@link ObjectTypeCore.gs1Active}. */
export function isGs1Active(
  entry: (typeof ObjectRegistry)[LeafType] | undefined,
  props: object | undefined,
): boolean {
  if (!entry || !props) return false;
  if (entry.gs1Active) return entry.gs1Active(props);
  return entry.gs1Capable === true && (props as { gs1?: boolean }).gs1 === true;
}

/** Emitter parity for control-key chips: they resolve to bytes only on a
 *  `controlChars` type outside GS1 mode. Callers pass this into the binding
 *  resolvers (variableBinding sits in the registry's init chain and must not
 *  resolve GS1 activity itself). */
export function objectResolvesCtrl(obj: { type: string; props?: object }): boolean {
  const entry = getEntry(obj.type);
  return entry?.controlChars === true && !isGs1Active(entry, obj.props);
}

/** {@link objectResolvesCtrl} refined by how the byte survives to the symbol,
 *  so a preview renders what the firmware prints (see {@link CtrlParity}). */
export function ctrlParityFor(obj: { type: string; props?: object }): CtrlParity {
  if (!objectResolvesCtrl(obj)) return "literal";
  return getEntry(obj.type)?.ctrlNeedsOwnEscape ? "byteOutsideTemplate" : "byte";
}

/** The object's effective content spec: its entry's rule resolved against props. */
export function specForObject(obj: { type: string; props?: object }): ContentSpec | undefined {
  return resolveContentSpec(getEntry(obj.type)?.contentSpec, obj.props ?? {});
}
