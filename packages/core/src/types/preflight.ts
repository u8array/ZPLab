import type { LabelConfig } from './LabelConfig';
import type { Unit } from '../lib/units';

export const PREFLIGHT_SEVERITIES = ['error', 'warning'] as const;
export type PreflightSeverity = (typeof PREFLIGHT_SEVERITIES)[number];

export interface PreflightFinding {
  objectId: string;
  kind: PreflightKind;
  severity: PreflightSeverity;
  /** Optional human-readable specifics (encoder message, measured value),
   *  shown after the kind label in the badge list. */
  detail?: string;
}

/** Single source for the kinds and their severity, so canvas styling and badge
 *  tiering can't drift apart. Each new producer adds its kind here. */
export const PREFLIGHT_SEVERITY = {
  offLabelOutside: 'error',
  offLabelClipped: 'warning',
  renderFailed: 'error',
  blockTooNarrow: 'error',
  barcodeTooSmall: 'warning',
  // The printer recomputes the check digit, so the symbol scans as a different number than the one typed.
  checkDigitMismatch: 'warning',
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
  // The payloads use every ^FE/^FC candidate char, so export cannot arm the
  // markers and they print as literal text. Still prints, so warn.
  markerArmFailed: 'warning',
  // Split from markerValueUnsafe: not a scan-corruption but GS1-INVALID data
  // (wrong fixed-AI width, charset, date) from a substitution; it still
  // prints, so warn rather than block.
  gs1ValueInvalid: 'warning',
  // Static GS1 content that does not segment: it ships verbatim (FNC1
  // positions unknown), so the scan risk is real but printing works.
  gs1ContentUnparsed: 'warning',
  // The encoder cannot produce the printer-pinned symbol version, so the
  // preview draws a near variant into the true footprint; the print itself
  // is unaffected.
  previewApproximate: 'warning',
  // A blank field is legal ZPL and a normal drafting state; it prints a gap,
  // so warn rather than block. Mirrors the canvas placeholder.
  emptyContent: 'warning',
  // A legacy/niche symbology whose ZPL is valid but may print nothing, see
  // limitedSupportPreflight.
  printerSupportLimited: 'warning',
  // A rotated QR prints as a static graphic: variable/serial values are baked
  // at export, the printer no longer substitutes them per label.
  qrRotatedStatic: 'warning',
  // A rotated Model 1 QR prints as Model 2, which legacy scanners may reject.
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
} satisfies Record<string, PreflightSeverity>;

export type PreflightKind = keyof typeof PREFLIGHT_SEVERITY;
export const PREFLIGHT_KINDS = Object.keys(PREFLIGHT_SEVERITY) as readonly PreflightKind[];

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
