import type { LabelConfig } from './LabelConfig';
import type { Unit } from '../lib/units';

export type PreflightSeverity = 'error' | 'warning';

/** Distinct preflight problem kinds. Producers: geometry (off-label), render
 *  (encode failure), and per-type pure checks (block-too-narrow, barcode module
 *  too small). Each new producer adds its kind here. */
export type PreflightKind =
  | 'offLabelOutside'
  | 'offLabelClipped'
  | 'renderFailed'
  | 'blockTooNarrow'
  | 'barcodeTooSmall'
  | 'textOverset'
  | 'imageMissing'
  | 'suspiciousChars'
  | 'markerValueUnsafe'
  | 'gs1ValueInvalid'
  | 'emptyContent'
  | 'printerSupportLimited'
  | 'qrRotatedStatic'
  | 'qrRotatedModel2'
  | 'maxicodeModeMissingScm'
  | 'aztecEcLevelOutOfRange'
  | 'unknownType';

export interface PreflightFinding {
  objectId: string;
  kind: PreflightKind;
  severity: PreflightSeverity;
  /** Optional human-readable specifics (encoder message, measured value),
   *  shown after the kind label in the badge list. */
  detail?: string;
}

/** Single source for kind -> severity so canvas styling and badge tiering can't
 *  drift apart. */
export const PREFLIGHT_SEVERITY: Record<PreflightKind, PreflightSeverity> = {
  offLabelOutside: 'error',
  offLabelClipped: 'warning',
  renderFailed: 'error',
  blockTooNarrow: 'error',
  barcodeTooSmall: 'warning',
  textOverset: 'warning',
  // Warning, not error like blockTooNarrow, although both print blank: image
  // bytes may still be hydrating from storage, so the state can self-resolve.
  imageMissing: 'warning',
  // Invisible/ambiguous chars still encode fine; they just rarely belong, so
  // warn (the payload may scan into unexpected data) rather than block.
  suspiciousChars: 'warning',
  // Same tier: the barcode encodes, but the marker's print-time value carries
  // structural chars its typed encoding can't take, so it scans corrupted.
  markerValueUnsafe: 'warning',
  // Split from markerValueUnsafe: not a scan-corruption but GS1-INVALID data
  // (wrong fixed-AI width, charset, date) from a substitution; it still
  // prints, so warn rather than block.
  gs1ValueInvalid: 'warning',
  // A blank field is legal ZPL and a normal drafting state; it prints a gap,
  // so warn rather than block. Mirrors the canvas placeholder.
  emptyContent: 'warning',
  // A legacy/niche symbology (Code 49, TLC39) many printers, especially
  // entry-level, do not implement; the ZPL is valid but may print nothing.
  printerSupportLimited: 'warning',
  // A rotated QR prints as a static graphic: variable/serial values are baked
  // at export, the printer no longer substitutes them per label.
  qrRotatedStatic: 'warning',
  // The graphic encoder only produces Model 2 symbols, so a rotated Model 1
  // QR prints as Model 2 (legacy scanners may reject it).
  qrRotatedModel2: 'warning',
  // Modes 2/3 need a structured carrier message (GS-separated postcode,
  // country, service); without it the symbol cannot encode.
  maxicodeModeMissingScm: 'error',
  // Outside every defined ^B0 d-domain, or a percent the preview encoder
  // cannot show (printer accepts 1-99 per spec p64); export keeps the value.
  aztecEcLevelOutOfRange: 'warning',
  // A leaf whose type isn't in the registry: it has no emitter, so it prints
  // nothing. Only reachable via an imported/foreign design file.
  unknownType: 'error',
};

/** What a per-type `preflight` producer receives. Minimal on purpose (the
 *  label for dpmm, the display unit for measurement details) so the registry
 *  capability stays free of the lib-layer ObjectBoundsCtx and its import
 *  cycle. */
export interface PreflightCtx {
  label: LabelConfig;
  /** Active display unit; measurement details render in it. */
  unit: Unit;
}

/** A per-type producer's output: kind plus optional detail. computePreflight
 *  stamps the objectId and derives severity from PREFLIGHT_SEVERITY. */
export interface PreflightProducerResult {
  kind: PreflightKind;
  detail?: string;
}
