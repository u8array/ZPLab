import type { LabelConfig } from "../../types/LabelConfig";
import type { LabelObject } from "../../types/Group";
import type { Variable } from "../../types/Variable";
import type { PrinterProfile } from "../../types/PrinterProfile";
import type { BlockOverlay } from "../zplOverlay/overlay";

export type ImportFindingKind =
  | "partial"
  | "browserLimit"
  | "unknown"
  | "replayRisk"
  | "deviceAction"
  | "lossyEdit"
  | "fnRenumbered"
  | "fnDefaultDropped"
  | "mixedPageGeometry";

/**
 * One import finding. Created per-occurrence so each entry can be navigated
 * to its source page in the UI; cross-page dedup happens (if at all) in the
 * import service's report buckets.
 */
export interface ImportFinding {
  kind: ImportFindingKind;
  /** Command token. For 'partial' the bare code (e.g. "^A@"); for
   *  'browserLimit' / 'unknown' the full token including parameters
   *  (e.g. "^IM,R:LOGO.GRF"); for 'lossyEdit' a human-readable reason. */
  command: string;
  /** Page index (^XA block) this finding originated from, stamped by the
   *  single-pass parser. */
  pageIndex: number;
  /** Which divergence a 'mixedPageGeometry' finding reports, so consumers
   *  pick their message without sniffing `command`. */
  cause?: 'size' | 'jm';
}

export interface ImportReport {
  findings: ImportFinding[];
  // The buckets below are command-code dedup views for these five kinds only.
  // Every other kind (lossyEdit, fnRenumbered, fnDefaultDropped) lives solely
  // in `findings`; iterate `findings` for a kind-complete view.
  /** Commands imported with known loss. Deduplicated by command code. */
  partial: string[];
  /** Commands skipped because they require printer hardware or file storage. */
  browserLimit: string[];
  /** Commands not recognised at all. */
  unknown: string[];
  /** Setup-Script commands (^ST, ^KN, …): profile-backed, routable on import. */
  replayRisk: string[];
  /** Device actions (^JC, ^JR, …): run on re-emit, no profile field, not routable. */
  deviceAction: string[];
}

/** One ^XA…^XZ format from a single-pass parse. Slices reference the same
 *  object/variable instances as the flat ParsedZPL arrays. */
export interface ParsedPage {
  objects: LabelObject[];
  /** This page's ^FN slots (per-format scope; cross-page merge is the
   *  import service's job). */
  variables: Variable[];
  findings: ImportFinding[];
  /** Source-patch overlay for byte-verbatim replay, present only when
   *  `captureOverlay` is set and every parsed object linked to a source span;
   *  `undefined` means the block regenerates from the model. */
  overlay?: BlockOverlay;
  /** ^PW/^LL-derived size in effect at this page's close (pre-sidecar), so the
   *  import can keep the first block's geometry as the label size. */
  labelSize: { widthMm?: number; heightMm?: number };
  /** labelConfig accumulated through this page's close (pre-sidecar, never
   *  reset): page 0 equals block 0's config, which the single-label import
   *  reads so block-scoped fields like ^PQ can't leak from later blocks. */
  labelConfig: Partial<LabelConfig>;
  /** Page 0 only: stream had no ^XA wrapper (bare field paste). Re-export
   *  regenerates the wrapper, so the overlay is suppressed by the caller. */
  bare?: boolean;
}

export interface ParsedZPL {
  /** One entry per ^XA block (single-pass; stream-persistent state like
   *  ^MU/^CC/^CW carries across pages). At least one page, possibly empty. */
  pages: ParsedPage[];
  /** ^XA blocks set different explicit ^PW/^LL: a single-label design keeps
   *  only one size, so callers reject or warn. Diverging ^JM densities are
   *  folded into the import service's flag of the same name, not this one. */
  mixedPageGeometry: boolean;
  labelConfig: Partial<LabelConfig>;
  /** EEPROM-persistent printer-state extracted from any Setup-Script
   *  commands in the stream (^JZ, ^JT, ~TA, ^ST, ^KD, ^SL, ^KL, ^SE,
   *  ^SZ, ^KN). Caller decides whether to merge into the active profile. */
  printerProfile: Partial<PrinterProfile>;
  /** Full device paths of fonts uploaded via `~DY` (TTF/OTF) in this
   *  stream. A path also claimed by a `^CW` alias or referenced by a
   *  `^A@` direct path is a design font (in `labelConfig.customFonts` or
   *  the design objects); an unclaimed path is a Setup-Script font.
   *  The service derives `printerProfile.setupFonts` from this set. */
  uploadedFontPaths: string[];
  /** Full device paths referenced by a `^A@` direct-path font. The
   *  service treats these as design fonts so an uploaded font used
   *  without a `^CW` alias is not misclassified as a Setup-Script font. */
  referencedFontPaths: string[];
  /** Every in-range ^FN slot the tokenizer saw, including on passthrough-only
   *  fields; import renumbering must avoid these (overlays replay the bytes). */
  sourceFnNumbers: ReadonlySet<number>;
}

export type Handler = (p: string[], rest: string, cmd: string) => void;

/** Pattern-matched handler entry: used when a command's key is
 *  variable (e.g. `^A{font}` with `{font}` ∈ 0..Z) so an exact-key
 *  table cannot express the dispatch. Each handler module owns its
 *  own wildcards and exports them alongside the exact-match table. */
export interface Wildcard {
  matches: (cmd: string) => boolean;
  handle: Handler;
}

/** Result of decoding any GF-shaped graphic into an image-cache entry. */
export interface DecodedGraphic {
  imageId: string;
  widthDots: number;
  heightDots: number;
  /** Verbatim `^GF{format},total,data,bpr,DATA` reconstruction kept on
   *  the image so round-trip emit can splice the same byte stream back
   *  into either `^GF` (inline) or `~DY` (preamble) without re-encoding. */
  gfaCache: string;
  crcOk: boolean;
}

/** Entry in the `~DY → ^XG` lookup map: a graphic uploaded earlier in the
 *  stream. Structurally a `DecodedGraphic` without the per-decode CRC flag;
 *  that lives on the partialCmds set instead of on every map entry. */
export type UploadedGraphic = Omit<DecodedGraphic, "crcOk">;
