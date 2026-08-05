import type { LabelObject } from "../../types/Group";
import type { LabelConfig } from "../../types/LabelConfig";
import type { PrinterProfile } from "../../types/PrinterProfile";
import type { Variable } from "../../types/Variable";
import type { TextProps } from "../../registry/text";
import type { SerialMode } from "../../registry/serialField";
import type { Code49Props } from "../../registry/code49";
import type { Gs1DatabarProps } from "../../registry/gs1databar";
import type { DataMatrixProps } from "../../registry/datamatrix";
import type { MaxicodeProps } from "../../registry/maxicode";
import { CODABLOCK_DEFAULT_COLUMNS, type CodablockProps } from "../../registry/codablock";
import type { ZplRotation } from "../../registry/rotation";
import { DEFAULT_CLOCK_CHARS, type ClockChars } from "../fcTemplate";
import { effectiveDpmm } from "../../types/LabelConfig";
import { getDecoder } from "./helpers";
import type { UploadedGraphic } from "./types";

/** Pending ^GB stash so a filled-black box commits just before the following
 *  field, sitting behind it (e.g. the black box an ^FR text knocks out of). */
export interface PendingReverseBg {
  x: number;
  y: number;
  w: number;
  h: number;
  t: number;
  color: "B" | "W";
  rounding: number;
  reverseFlag: boolean | undefined;
  comment?: string;
  /** ^FO vs ^FT at the stashed ^GB, so a deferred box commit anchors correctly. */
  positionType?: "FO" | "FT";
  /** z-justification at the stashed ^GB ('R' = right corner). */
  justify?: "L" | "R";
  /** Overlay capture only: source span of the ^GB field, recorded at its ^FS so
   *  the box it later produces on its deferred commit can be linked to its
   *  original bytes. */
  span?: { start: number; end: number };
}

/** Shared parse accumulators; pages slice the arrays via offset marks, the
 *  document-wide fields hand back via `ParsedZPL`. */
export interface ParserResult {
  objects: LabelObject[];
  labelConfig: Partial<LabelConfig>;
  printerProfile: Partial<PrinterProfile>;
  variables: Variable[];
  partialCmds: Set<string>;
  browserLimit: string[];
  unknown: string[];
  /** Setup-Script commands seen (profile-backed, routable on import). */
  replayRisk: string[];
  /** Device-action commands seen (no profile field, not routable). */
  deviceAction: string[];
  /** Every in-range ^FN slot the tokenizer saw, including on fields that end
   *  up passthrough-only (no Variable). Import renumbering must avoid these:
   *  overlays replay the original bytes. */
  sourceFnNumbers: Set<number>;
}

/** Label-frame state from ^LH / ^LT / ^LR; per spec these are persistent
 *  printer defaults that survive ^XZ until overridden or power-cycled. */
export interface LabelFrameState {
  lhX: number;
  lhY: number;
  ltY: number;
  /** ^LR persists across labels per spec (printer default). Per-field
   *  ^FR lives on `field` (resets at ^FS). */
  lrActive: boolean;
}

/** `fnComment` snapshots pending comment at ^FN so a later ^FX between
 *  ^FN and ^FS doesn't pollute the variable's auto-name. */
export interface CommentState {
  pending: string | undefined;
  fnNumber: number | null;
  fnComment: string | undefined;
}

/** Command-format state, mixed scope: embedChar/clockChars reset at ^XA and
 *  fhActive at page close; prefix/delimiter chars, unitScale, and fhDecoder
 *  are printer-persistent and carry across pages. */
export interface FormatState {
  embedChar: string;
  clockChars: ClockChars;
  fhActive: boolean;
  fhDelimiter: string;
  fhDecoder: TextDecoder;
  // Command prefix characters, mutated by ^CC/~CC, ^CT/~CT, ^CD/~CD.
  // The tokenizer reads caretChar/tildeChar on every char scan so mid-stream
  // changes take effect on the very next command.
  caretChar: string;
  tildeChar: string;
  delimiterChar: string;
  /** ^MU a-slot dot multiplier: 1 (D), dpmm*25.4 (I), dpmm (M).
   *  Internal model is dots-canonical; I/M sources get scaled on read.
   *  Survives ^XA per spec (^MU carries field-by-field until overridden). */
  unitScale: number;
  /** ^MU a-slot mode, kept so ^JM can re-derive unitScale (both persist). */
  muMode: 'D' | 'I' | 'M';
  /** ^JM density; persistent across formats (p269). Resolved at each ^XA by a
   *  format-head lookahead (last ^JM before the first ^FS wins), so ^MU-scaled
   *  reads already see the final density and never need a late-^JM replay. */
  jmDensity?: 'A' | 'B';
  /** True while the stream sits in a format head (^XA up to the first ^FS), the
   *  only place a ^JM declares a density (p269). A wrapper-less body counts as
   *  its own head; between ^XZ and the next ^XA nothing does. */
  inFormatHead: boolean;
}

/** ^MU a-slot scale for object/body dot reads, at the EFFECTIVE (^JM-adjusted)
 *  density: I = eff·25.4, M = eff, D = 1. ^PW/^LL bypass this and read at the
 *  PHYSICAL density instead (ZD230-verified, ^JM-independent). */
export function deriveUnitScale(
  format: Pick<FormatState, "muMode" | "jmDensity">,
  dpmm: number,
): number {
  const eff = effectiveDpmm({ dpmm, jmDensity: format.jmDensity });
  return format.muMode === "I" ? eff * 25.4 : format.muMode === "M" ? eff : 1;
}

/** Persistent defaults for following fields (^CF, ^FW, ^FB, ^BY). */
export interface DefaultsState {
  cfHeight: number;
  cfWidth: number;
  cfFontId: string | undefined;
  fwRotation: TextProps["rotation"];
  /** ^FW z: default justification for fields whose ^FO/^FT omits z. */
  fwJustify: "L" | "R";
  fbWidth: number;
  fbLines: number;
  fbSpacing: number;
  fbJustify: TextProps["blockJustify"];
  fbHangingIndent: number;
  /** >0 marks ^TB (text block) mode, carrying the block height in dots.
   *  ^TB shares fbWidth for the wrap width but emits/decodes differently. */
  tbHeight: number;
  /** 0 = no ^BY height; barcode handlers fall back to 100. */
  byModuleWidth: number;
  byHeight: number;
}

/** ^CW aliases + ~DY uploads; span the whole parse across ^XA blocks. */
export interface FontsState {
  aliases: Map<string, string>;
  downloadedFontPaths: Set<string>;
  downloadedGraphics: Map<string, UploadedGraphic>;
  /** Full device paths referenced by a ^A@ direct-path font (no ^CW
   *  alias). Lets the import classify such an uploaded font as a design
   *  font rather than a Setup-Script font. */
  referencedFontPaths: Set<string>;
}

/** Per-field accumulator, consumed and reset by flushField at ^FS. */
export interface FieldState {
  // Position (^FO / ^FT, pre-shift, before label.lh*/lt* offsets)
  x: number;
  y: number;
  positionIsFT: boolean;
  /** ^FO/^FT z-justification: 'R' (z=1) anchors graphics at the right corner. */
  justify: "L" | "R";
  // Type discriminator + pending ^FD payload
  fieldType: string | null;
  pendingFD: string | null;
  /** ^FE armed for the next ^FD only (spec p.191); reset at ^FS. */
  feArmed: boolean;
  /** ^FC armed for the next ^FD only (spec p.1614); reset at ^FS. */
  fcArmed: boolean;
  /** ^FR: single-field reverse, reset on ^FS / new ^FO / ^FT. */
  frActive: boolean;
  /** ^FP direction (H/V/R); per-field, reset to 'H' at ^FS. */
  fpDirection: "H" | "V" | "R";
  /** ^FP inter-character gap in dots; per-field, reset to 0 at ^FS. */
  fpCharGap: number;
  // Text-field cached params
  textRot: TextProps["rotation"];
  textH: number;
  textW: number;
  // Barcode pending (set by ^B*, consumed by flushField)
  bcHeight: number;
  bcInterp: boolean;
  bcInterpAbove: boolean;
  bcCheck: boolean;
  bcMsiCheckMode: "C" | "D" | undefined;
  bcMsiHriCheck: boolean;
  bcRotation: ZplRotation;
  /** ^BC m=D (UCC/EAN) → GS1-128; consumed by the code128 case in flushField. */
  bcGs1: boolean;
  bcCode49Mode: Code49Props["mode"];
  // ^GS symbol pending
  symRot: ZplRotation;
  symH: number;
  symW: number;
  // GS1 Databar pending
  gsSymbology: Gs1DatabarProps["symbology"];
  gsSegments: number | undefined;
  /** ^BR p[2] magnification multiplier (1-10). Per spec NOT a dot
   *  quantity; kept separate from `defaults.byModuleWidth` so a stray
   *  ^BR doesn't overwrite real dot widths from ^BY. */
  gsMagnification: number | undefined;
  // 2D matrix pending
  qrMag: number;
  qrModel: number;
  dmDim: number;
  dmQuality: DataMatrixProps["quality"];
  /** ^BX escape char (g param); set => GS1 DataMatrix field data. */
  dmEscape: string | undefined;
  /** ^BX a param, normalized by the BX handler. */
  dmAspect: DataMatrixProps["aspectRatio"];
  /** ^BX c/r params: forced symbol size; undefined = auto. */
  dmCols: number | undefined;
  dmRows: number | undefined;
  // Stacked-2D pending
  pdfRowHeight: number;
  pdfSecurity: number;
  pdfColumns: number;
  aztecMag: number;
  maxicodeMode: MaxicodeProps["mode"];
  maxicodeNumber: number;
  maxicodeTotal: number;
  mpdfRowHeight: number;
  mpdfMode: number;
  cbRowHeight: number;
  cbColumns: number;
  cbSecurity: CodablockProps["securityLevel"];
  // TLC39 pending
  tlcModuleWidth: number | undefined;
  tlcWideRatio: number;
  tlcHeight: number;
  tlcMicroPdfModuleWidth: number;
  tlcMicroPdfRowHeight: number;
  // Pending font reference (^A@ or ^A{id}), mutually exclusive
  pendingPrinterFontName: string | undefined;
  pendingFontId: string | undefined;
  // ^SN / ^SF serialisation pending
  snPending: boolean;
  snIncrement: number;
  snMode: SerialMode["zplMode"];
}

export type FnDefaultCandidate = { value: string; decoded: boolean } | null;

export interface ParserState {
  result: ParserResult;
  label: LabelFrameState;
  comment: CommentState;
  format: FormatState;
  defaults: DefaultsState;
  fonts: FontsState;
  reverseBg: PendingReverseBg | null;
  field: FieldState;
  /** ^FN slots declared bare (`^FN<n>^FD…^FS`, no field): marker-less by
   *  design, so the post-^FS serial orphan cleanup must not remove them. */
  bareDeclaredFns: Set<number>;
  /** ^FN slots whose single-bind marker a post-^FS ^SN stripped. Orphan
   *  cleanup runs at page close, not here: the slot is shared, so a later
   *  field or embed may still reference the variable (spec p.200). */
  serialStrippedFns: Set<number>;
  /** Index into result.variables where the current ^XA format's slots begin.
   *  ^FN is per-format scoped, so find-or-reuse must not reach into an earlier
   *  page's variables; advanced at each page close. */
  varScopeStart: number;
  /** True once the stream's first ^XA opened a format. A ^JM before it has no
   *  head for the lookahead to latch onto, so the ^JM handler reports it partial
   *  instead of silently dropping it. */
  sawXa: boolean;
  /** A ^BC ^FD kept verbatim whose re-emit the plain escape rewrites (bare
   *  `>` in an unadopted stream): regen changes bytes, so the page is only
   *  byte-exact through its overlay. */
  bcFdRegenLossy: boolean;
  /** Per ^FN slot: the bound consumers' default candidate. `null` = consumers
   *  disagreed; `decoded` = at least one consumer actually decoded (a bare
   *  wire-form echo must not override a header declaration). */
  fnDefaultCandidates: Map<number, FnDefaultCandidate>;
}

/** trimEnd: `token` carries `rest` up to the next command, which in multi-line
 *  ZPL includes the trailing newline (noise in this diagnostic surface). */
export function pushBrowserLimit(result: ParserResult, token: string): void {
  result.browserLimit.push(token.trimEnd());
}

/** Default text height: ^CF override, else ZPL baseline 30. */
export function getDefaultTextH(defaults: DefaultsState): number {
  return defaults.cfHeight || 30;
}

/** Default text width: ^CF override, else 0 (= auto-from-height). */
export function getDefaultTextW(defaults: DefaultsState): number {
  return defaults.cfWidth || 0;
}

/** ^FO vs ^FT discriminator for emit sites. */
export function getPosType(field: FieldState): "FT" | "FO" {
  return field.positionIsFT ? "FT" : "FO";
}

/** Sticky GS1/^BX mode flags would act on any later field, so every flush
 *  path drops them with the flushed field. */
export function resetSymbologyModeFlags(field: FieldState): void {
  field.bcGs1 = false;
  field.dmEscape = undefined;
  field.dmQuality = 200;
  field.bcMsiCheckMode = undefined;
  field.bcMsiHriCheck = false;
}

/** Reset the field-scoped ^FB/^TB block defaults. They bind to a single field
 *  and clear at its ^FS (and at an ^XA that closes with a field left open). */
export function resetFieldBlockDefaults(defaults: DefaultsState): void {
  defaults.fbWidth = 0;
  defaults.fbLines = 1;
  defaults.fbSpacing = 0;
  defaults.fbJustify = "L";
  defaults.fbHangingIndent = 0;
  defaults.tbHeight = 0;
}

/** Format-scoped reset at an ^XA boundary; printer-persistent state (^MU,
 *  ^CC/^CT/^CD, ^CI, ^CW/fonts, ^CF/^BY, ^LH/^LT/^LR) carries on. Field state
 *  resets too: a page closing mid-field must not leak a dangling ^FH/^FB. */
export function resetFormatScopedState(s: ParserState): void {
  s.result.partialCmds = new Set();
  s.varScopeStart = s.result.variables.length;
  s.serialStrippedFns.clear();
  s.bareDeclaredFns.clear();
  s.comment.pending = undefined;
  s.comment.fnNumber = null;
  s.comment.fnComment = undefined;
  s.field = freshFieldState();
  // ^FW justify persists across ^XA (like fwRotation); a later page's first
  // position-less field must inherit it, not the fresh-state 'L'.
  s.field.justify = s.defaults.fwJustify;
  s.format.fhActive = false;
  s.bcFdRegenLossy = false;
  s.fnDefaultCandidates = new Map();
  resetFieldBlockDefaults(s.defaults);
}

export function createParserState(): ParserState {
  return {
    result: {
      objects: [],
      labelConfig: {},
      printerProfile: {},
      variables: [],
      partialCmds: new Set<string>(),
      browserLimit: [],
      unknown: [],
      replayRisk: [],
      deviceAction: [],
      sourceFnNumbers: new Set<number>(),
    },
    label: {
      lhX: 0,
      lhY: 0,
      ltY: 0,
      lrActive: false,
    },
    comment: {
      pending: undefined,
      fnNumber: null,
      fnComment: undefined,
    },
    format: {
      embedChar: "#",
      clockChars: { ...DEFAULT_CLOCK_CHARS },
      fhActive: false,
      fhDelimiter: "_",
      fhDecoder: getDecoder("utf-8"),
      caretChar: "^",
      tildeChar: "~",
      delimiterChar: ",",
      unitScale: 1,
      muMode: "D",
      inFormatHead: false,
    },
    defaults: {
      cfHeight: 0,
      cfWidth: 0,
      cfFontId: undefined,
      fwRotation: "N",
      fwJustify: "L",
      fbWidth: 0,
      fbLines: 1,
      fbSpacing: 0,
      fbJustify: "L",
      fbHangingIndent: 0,
      tbHeight: 0,
      byModuleWidth: 2,
      byHeight: 0,
    },
    fonts: {
      aliases: new Map<string, string>(),
      downloadedFontPaths: new Set<string>(),
      downloadedGraphics: new Map<string, UploadedGraphic>(),
      referencedFontPaths: new Set<string>(),
    },
    reverseBg: null,
    bareDeclaredFns: new Set<number>(),
    serialStrippedFns: new Set<number>(),
    varScopeStart: 0,
    sawXa: false,
    bcFdRegenLossy: false,
    fnDefaultCandidates: new Map(),
    field: freshFieldState(),
  };
}

/** Pristine per-field state; also used at ^XA so a field left half-open by a
 *  missing ^FS cannot leak across the page boundary. */
export function freshFieldState(): FieldState {
  return {
    x: 0,
    y: 0,
    positionIsFT: false,
    justify: "L",
    fieldType: null,
    pendingFD: null,
    feArmed: false,
    fcArmed: false,
    frActive: false,
    fpDirection: "H",
    fpCharGap: 0,
    textRot: "N",
    textH: 30,
    textW: 0,
    bcHeight: 100,
    bcInterp: true,
    bcInterpAbove: false,
    bcCheck: false,
    bcMsiCheckMode: undefined,
    bcMsiHriCheck: false,
    bcRotation: "N",
    bcGs1: false,
    bcCode49Mode: "A",
    symRot: "N",
    symH: 30,
    symW: 30,
    gsSymbology: 1,
    gsSegments: undefined,
    gsMagnification: undefined,
    qrMag: 4,
    qrModel: 2,
    dmDim: 5,
    dmQuality: 200,
    dmEscape: undefined,
    dmAspect: undefined,
    dmCols: undefined,
    dmRows: undefined,
    pdfRowHeight: 10,
    pdfSecurity: 0,
    pdfColumns: 0,
    aztecMag: 4,
    maxicodeMode: 2,
    maxicodeNumber: 1,
    maxicodeTotal: 1,
    mpdfRowHeight: 10,
    mpdfMode: 0,
    cbRowHeight: 10,
    cbColumns: CODABLOCK_DEFAULT_COLUMNS,
    cbSecurity: "Y",
    tlcModuleWidth: undefined,
    tlcWideRatio: 2,
    tlcHeight: 40,
    tlcMicroPdfModuleWidth: 2,
    tlcMicroPdfRowHeight: 4,
    pendingPrinterFontName: undefined,
    pendingFontId: undefined,
    snPending: false,
    snIncrement: 1,
    snMode: "SN",
  };
}
