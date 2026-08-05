// Headless barcode dimension kernel: bwip option building, pixel-dims
// providers and the footprint measurement shared by the app canvas and the
// MCP sidecar. bwip-js is injected (BwipEngine) so core carries no copy of
// BWIPP and each host binds its own build (browser / generic).

import type { LeafObject } from "../registry";
import type { LabelObject } from "../types/Group";
import { clampCodablockColumns, CODABLOCK_PREVIEW_COLUMNS_MIN } from "../registry/codablock";
import { EC_PERCENT_MIN, EC_PERCENT_MAX } from "../registry/aztec";
import { upceData6FromFd } from "../registry/hriFormatters";
import type { Gs1DatabarProps } from "../registry/gs1databar";
import { isAxisSwapped, objectRotation } from "../registry/rotation";
import { dotsToPx, mmToDots, pxToDots } from "./coordinates";
import {
  GS1_DATABAR_DEFAULT_SEGMENTS,
  GS1_DATABAR_EXPANDED_SYMBOLOGIES,
  gtin14WithCheck,
} from "./gs1";
import { planGs1Fd } from "./gs1Plan";
import { code128ControlBwipRaw, code128FdToSymbols, code128PlainFd, code128SymbolsToBwipRaw } from "./code128Subset";
import { isRectangular, dmVersionString, type DataMatrixProps } from "../registry/datamatrix";
import { MAXICODE_WIDTH_MM, MAXICODE_HEIGHT_MM } from "../registry/maxicode";
import { micropdf417ModeDims, micropdf417ModeFits } from "../registry/micropdf417";
import {
  applyBindingToObject,
  getObjectStringContent,
  type ClockResolveCtx,
} from "./variableBinding";
import { ctrlParityFor } from "../registry";
import type { Variable } from "../types/Variable";
import { qrBwipOptions } from "./qrGraphic";
import {
  barSubRect,
  EAN_TEXT_ZONE_DOTS,
  EAN_UPC_TYPES,
  GS1_DATABAR_PADDING_ROWS,
  GS1_DATABAR_SPEC_HEIGHT_MODULES,
  LOGMARS_TEXT_ZONE_DOTS,
  MAXICODE_INK_MARGIN_PX,
  upcSuppTextZoneDots,
} from "./bwipConstants";
import {
  firstRawEntry,
  POSTAL_PITCH_MODULES,
  ZEBRA_WIDTH_BAR_TYPES,
  ZEBRA_WIDTH_BCID,
  zebraWidthBarGeometry,
  zebraWidthBarText,
  type ZebraWidthBarType,
} from "./barcodeRawGeometry";
import { code11CheckDigits } from "./barcodeCheckDigits";
import { barcodeTextZoneDots, barcodeZoneAbove } from "./barcodeHri";
import { placeholderContentFor, samplePropsFor } from "../registry/placeholderContent";

/** The bwip-js surface the kernel needs; any build satisfies it. */
export interface BwipEngine {
  raw(opts: object): unknown;
  render(opts: object, drawing: object): unknown;
}

/** ^B0 `d` param (AztecProps.ecLevel) -> bwip bcid + size options: 5-95 is EC%,
 *  101-104/201-232 forces that layer count, 300 is the fixed Rune. Out-of-band
 *  percents (1-4/96-99) fall to auto sizing; flagged by aztecEcLevelOutOfRange. */
export function aztecBwipOptions(ecLevel: number): Record<string, unknown> {
  // Round so a non-integer never reaches bwip's `layers`; NaN falls to default.
  const ec = Math.round(ecLevel) || 0;
  if (ec === 300) return { bcid: "azteccode", format: "rune" };
  if (ec >= 201 && ec <= 232) return { bcid: "azteccode", format: "full", layers: ec - 200 };
  if (ec >= 101 && ec <= 104) return { bcid: "azteccodecompact", layers: ec - 100 };
  if (ec >= EC_PERCENT_MIN && ec <= EC_PERCENT_MAX) return { bcid: "azteccodecompact", eclevel: ec };
  return { bcid: "azteccodecompact" };
}

/** Second-chance options when the encoder rejects the spec-honest primary:
 *  Aztec auto grows compact into full-range (firmware auto spans both, compact
 *  alone caps at 4 layers) and MicroPDF417 drops the mode-pinned rows (BWIPP
 *  rejects combos the ^BF table allows, e.g. 1x11 with 4 digits). Null when no
 *  fallback applies. */
export function bwipRetryOptions(
  opts: Record<string, unknown>,
): Record<string, unknown> | null {
  if (opts.bcid === "azteccodecompact" && opts.layers === undefined) {
    return { ...opts, bcid: "azteccode" };
  }
  if (opts.bcid === "micropdf417" && opts.rows !== undefined) {
    // Bridges the BWIPP gap below the mode's capacity; over-capacity content
    // never reaches here (buildBwipOptions yields no options for it).
    const { rows: _rows, ...rest } = opts;
    return rest;
  }
  return null;
}

const GS1_DATABAR_BCID: Record<Gs1DatabarProps["symbology"], string> = {
  1: "databaromni",
  2: "databartruncated",
  3: "databarstacked",
  4: "databarstackedomni",
  5: "databarlimited",
  6: "databarexpanded",
  7: "databarexpandedstacked",
};

const BCID: Partial<Record<LabelObject["type"], string>> = {
  code128: "code128",
  code39: "code39",
  ean13: "ean13",
  ean8: "ean8",
  upca: "upca",
  upce: "upce",
  interleaved2of5: "interleaved2of5",
  code93: "code93",
  code11: "code11",
  industrial2of5: "industrial2of5",
  standard2of5: "iata2of5",   // ZPL ^BJ matches bwip IATA 2 of 5, not code2of5
  codabar: "rationalizedCodabar",
  logmars: "code39",
  msi: "msi",
  // plessey/planet/postal are absent: they render via bwip raw geometry at
  // ^BY widths (bcid from ZEBRA_WIDTH_BCID).
  // Placeholder; real bcid resolved per-symbology via GS1_DATABAR_BCID.
  gs1databar: "databaromni",
  pdf417: "pdf417",
  qrcode: "qrcode",
  datamatrix: "datamatrix",
  aztec: "azteccodecompact",
  maxicode: "maxicode",
  micropdf417: "micropdf417",
  codablock: "codablockf",
  // Placeholder; ean2 vs ean5 resolved from content length.
  upcEanExtension: "ean5",
  code49: "code49",
};

export const BWIP_SCALE = 2;
const BWIP_2D_INTERNAL_SCALE = 2;

// bwip-js codablockf lays out each row 6 modules narrower than Zebra firmware
// (measured on a ZD230: bwip width = 11*c+57, firmware = 11*c+63, a constant +6
// of per-row overhead bwip omits). Added to the footprint so the canvas matches
// the print for text and column-filling data; short numeric data the firmware
// compacts down stays approximate (use the printer preview for exact size).
const CODABLOCK_FIRMWARE_MODULE_OFFSET = 6;

/** GS1 mode: bwip auto-inserts FNC1 from the (AI)… element string; content
 *  the catalog cannot segment encodes as raw FNC1 markers instead of failing
 *  on a guessed element string (the `_1` escapes print it fine, see Gs1FdLoss). */
export function dmBwipInput(p: DataMatrixProps): { bcid: string; text: string; parsefnc?: boolean } {
  const rect = isRectangular(p);
  if (p.gs1) {
    const plan = planGs1Fd(p.content, "datamatrix");
    if (plan.bwipParsefncText !== null) {
      return {
        bcid: rect ? "datamatrixrectangular" : "datamatrix",
        text: plan.bwipParsefncText,
        parsefnc: true,
      };
    }
    return { bcid: rect ? "gs1datamatrixrectangular" : "gs1datamatrix", text: plan.bwipText || " " };
  }
  return { bcid: rect ? "datamatrixrectangular" : "datamatrix", text: p.content || " " };
}

// Mirrors Zebra's columns=0 auto-heuristic. Empirically validated against
// Labelary at 8dpmm across content 10..120 chars (mixed text and all-numeric;
// secLevel 0 and 2 probed at length, 1 only at short content): the column
// choice matches throughout, only inner codewords and the all-numeric row
// count diverge (see visualRegression bounds mode).
function estimatePdf417Columns(content: string, securityLevel: number): number {
  const dataCodewords = Math.ceil((content.length || 1) / 2.3);
  const eccCodewords = Math.pow(2, securityLevel + 1);
  const totalCodewords = dataCodewords + eccCodewords;
  return Math.max(1, Math.min(30, Math.floor(Math.sqrt(totalCodewords / 4))));
}

// bwip reduces PDF417 rowheight to this internal minimum when the requested
// row count exceeds what the data strictly requires.
const BWIP_PDF417_MIN_ROWHEIGHT = 3;

export type EanUpcType = "ean13" | "ean8" | "upca" | "upce";

/** Integer-aligned per-module render scale; avoids non-integer upscaling. */
export function get1DBwipScale(
  moduleWidth: number,
  scale: number,
  dpmm: number,
): number {
  return Math.max(1, Math.round(dotsToPx(moduleWidth, scale, dpmm)));
}

function bwipScale1D(
  moduleWidth: number,
  renderScale: number | undefined,
  renderDpmm: number | undefined,
): number {
  return renderScale != null && renderDpmm != null
    ? get1DBwipScale(moduleWidth, renderScale, renderDpmm)
    : BWIP_SCALE;
}

export interface BwipRawLinear {
  sbs?: number[];
  bbs?: number[];
  /** HRI fragments: [char, xModule, yModule, fontName, fontSizeUnits]. */
  txt?: [string, number, number, string, number][];
}

/** One HRI digit as bwip places it. Zebra/Labelary render the whole HRI
 *  line at one size, so only the position is taken from bwip (its built-in
 *  shrink of the floated system/check digits is ignored). */
export interface EanUpcHriFragment {
  char: string;
  xModule: number;
}

/** bwip raw geometry (bars + HRI text) for an EAN/UPC symbol. UPC-E
 *  accepts 6-digit content but bwip rejects it, so pre-pad with the
 *  number-system digit as the firmware does. Shared by the bars and HRI
 *  paths so both encode the identical symbol. */
export function rawEanUpc(bwip: BwipEngine, type: EanUpcType, text: string): BwipRawLinear | null {
  // UPC-E: always feed bwip the canonical 7-digit form (NS 0 + 6 data),
  // NS-aware so a content that already carries the prefix is not doubled.
  const encoded = type === "upce" ? `0${upceData6FromFd(text)}` : text;
  try {
    const stack = bwip.raw({ bcid: type, text: encoded, includetext: true }) as BwipRawLinear[];
    return stack?.[0] ?? null;
  } catch {
    return null;
  }
}

/** EAN/UPC HRI digit positions from bwip's text geometry (the engine
 *  Labelary renders with): floats, guard splits and per-type layout
 *  come for free, grid-accurate at any width. */
export function getEanUpcHriFragmentsWith(
  bwip: BwipEngine,
  type: EanUpcType,
  text: string,
): EanUpcHriFragment[] {
  const txt = rawEanUpc(bwip, type, text)?.txt;
  if (!txt || txt.length === 0) return [];
  return txt.map((t) => ({ char: t[0], xModule: t[1] }));
}

// Forcing Code B keeps module count in sync with Labelary (^BC default).
// Returns null for chars outside ASCII 32..126.
function toCode128BRaw(text: string): string | null {
  if (!text) return null;
  const parts = ["^104"]; // Start B
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return null;
    parts.push(`^${String(code - 32).padStart(3, "0")}`);
  }
  return parts.join("");
}

export function buildBwipOptions(
  obj: LeafObject,
  renderScale?: number,
  renderDpmm?: number,
): Record<string, unknown> | null {
  const bcid = BCID[obj.type];
  if (!bcid) return null;

  // bwip always renders upright; Konva renderer applies visual rotation.
  let opts: Record<string, unknown>;

  switch (obj.type) {
    case "ean13":
    case "ean8":
    case "upca":
    case "upce": {
      const p = obj.props;
      const scale = bwipScale1D(p.moduleWidth, renderScale, renderDpmm);
      let text: string;
      if (obj.type === "upce") {
        const r = p.content || "000000";
        text = r.length === 6 ? `0${r}` : r;
      } else {
        text = p.content || "0";
      }
      opts = { bcid, text, scale, height: 10 };
      break;
    }
    case "code49": {
      const p = obj.props;
      const scale = bwipScale1D(p.moduleWidth, renderScale, renderDpmm);
      // Clamp to bwip's 8..50 range; guards JSON loads that bypass registry.
      const rawRow = Math.round(p.height / Math.max(p.moduleWidth, 1));
      const rowheight = Math.min(50, Math.max(8, rawRow));
      opts = {
        bcid,
        text: p.content || "0",
        scale,
        rowheight,
      };
      // bwip's mode is numeric 0-5; 'A' (auto) is the no-option case.
      if (p.mode !== "A") {
        const m = parseInt(p.mode, 10);
        if (Number.isInteger(m) && m >= 0 && m <= 5) {
          (opts as Record<string, unknown>).mode = m;
        }
      }
      break;
    }
    case "upcEanExtension": {
      const p = obj.props;
      const scale = bwipScale1D(p.moduleWidth, renderScale, renderDpmm);
      // bwip splits ^BS into ean2/ean5 by length; non-2 falls back to ean5.
      // HRI rendered as separate Konva overlay (Zebra puts it above bars)
      // so rotation lands at the firmware anchor.
      const text = p.content || "00000";
      const variantBcid = text.length === 2 ? "ean2" : "ean5";
      opts = {
        bcid: variantBcid,
        text,
        scale,
        height: 10,
        includetext: false,
      };
      break;
    }
    case "code128": {
      const p = obj.props;
      const scale = bwipScale1D(p.moduleWidth, renderScale, renderDpmm);
      // GS1-128 renders from the emit plan; unparsed content is the raw
      // mode-D read (leading FNC1 plus literals, see the plan's parsefnc doc).
      if (p.gs1) {
        const plan = planGs1Fd(p.content, "code128");
        opts = plan.bwipParsefncText !== null
          ? { bcid: "code128", text: plan.bwipParsefncText, parsefnc: true, scale, height: 10 }
          : { bcid: "gs1-128", text: plan.bwipText || "(01)00000000000000", scale, height: 10 };
        break;
      }
      const text = p.content || "0";
      // Control bytes render from the same symbol plan the emitter writes as
      // subset invocations, so canvas width equals printed width by
      // construction. This is planCode128Fd's whole mode in bwip symbol
      // values; keep the two branches in lockstep with code128Plan.ts.
      const ctrlRaw = code128ControlBwipRaw(text);
      if (ctrlRaw) {
        opts = { bcid, text: ctrlRaw, raw: true, scale, height: 10 };
        break;
      }
      // Interpret the EMITTED payload: the printer only reads the
      // fdPlainEscape form, and a bare `>` diverges from the model content.
      const fdText = code128PlainFd(text);
      if (/>[0-9:;<=]/.test(fdText)) {
        const symbols = code128FdToSymbols(fdText);
        if (symbols) {
          opts = { bcid, text: code128SymbolsToBwipRaw(symbols), raw: true, scale, height: 10 };
          break;
        }
      }
      const rawB = toCode128BRaw(text);
      if (rawB) {
        opts = { bcid, text: rawB, raw: true, scale, height: 10 };
      } else {
        opts = { bcid, text, scale, height: 10 };
      }
      break;
    }
    case "code39":
    case "interleaved2of5":
    case "industrial2of5":
    case "standard2of5":
    case "codabar": {
      const p = obj.props;
      const scale = bwipScale1D(p.moduleWidth, renderScale, renderDpmm);
      // Zebra silently uppercases for these symbologies; bwip-js throws.
      const needsUpper = obj.type === "code39" || obj.type === "codabar";
      const raw = p.content || "0";
      const text = needsUpper ? raw.toUpperCase() : raw;
      // ^B3/^B2 e encode Mod 43 / Mod 10 into the bars (ZD230-measured: +1
      // char / +1 digit pair). Codabar's e-slot is a spec-fixed N and the
      // 2of5 pair has no check param.
      const includecheck =
        (obj.type === "code39" || obj.type === "interleaved2of5") && !!p.checkDigit;
      opts = { bcid, text, scale, height: 10, ...(includecheck && { includecheck }) };
      break;
    }
    case "code93": {
      const p = obj.props;
      const scale = bwipScale1D(p.moduleWidth, renderScale, renderDpmm);
      // Zebra ^BA always encodes the C+K check chars; the ZPL e param only
      // gates the HRI. Without includecheck bwip's symbol is 18 modules short.
      opts = { bcid, text: p.content || "0", scale, height: 10, includecheck: true };
      break;
    }
    case "code11": {
      const p = obj.props;
      const scale = bwipScale1D(p.moduleWidth, renderScale, renderDpmm);
      // Zebra ^B1 always encodes check digit(s); e picks one (Y) or two (N).
      // bwip's includecheck flips the count by data length instead, so the
      // digits are computed app-side and appended to the bar data.
      const raw = p.content || "0";
      const text = raw + code11CheckDigits(raw, !p.checkDigit);
      opts = { bcid, text, scale, height: 10 };
      break;
    }
    case "msi": {
      const p = obj.props;
      const scale = bwipScale1D(p.moduleWidth, renderScale, renderDpmm);
      // ^BM e encodes the check into the bars (ZD230-measured: B is one
      // digit wider than A); C/D select bwip's double-check variants.
      opts = {
        bcid, text: p.content || "0", scale, height: 10,
        ...(p.checkDigit && {
          includecheck: true,
          ...(p.msiCheckMode && {
            checktype: p.msiCheckMode === "C" ? "mod1010" : "mod1110",
          }),
        }),
      };
      break;
    }
    case "logmars": {
      const p = obj.props;
      const scale = bwipScale1D(p.moduleWidth, renderScale, renderDpmm);
      // LOGMARS is a Code39 subset; same uppercase rule applies.
      opts = {
        bcid,
        text: (p.content || "0").toUpperCase(),
        scale,
        height: 10,
        includecheck: true,
      };
      break;
    }
    case "gs1databar": {
      const p = obj.props;
      const scale = bwipScale1D(p.magnification, renderScale, renderDpmm);
      const sym = p.symbology;
      const isExpanded = GS1_DATABAR_EXPANDED_SYMBOLOGIES.has(sym);
      // bwip needs (AI)data parens; model stores raw digits.
      // Sym 1..5 require AI 01 + valid 14-digit GTIN with check; Expanded
      // renders from the emit plan (unparsed stays verbatim).
      const text = isExpanded
        ? planGs1Fd(p.content, "databar").bwipText
        : `(01)${gtin14WithCheck(p.content)}`;
      opts = {
        bcid: GS1_DATABAR_BCID[sym],
        text,
        scale,
        height: 10,
        paddingheight: GS1_DATABAR_PADDING_ROWS,
        ...(sym === 7 ? { segments: p.segments ?? GS1_DATABAR_DEFAULT_SEGMENTS } : {}),
      };
      break;
    }
    case "pdf417": {
      const p = obj.props;
      const columns =
        p.columns || estimatePdf417Columns(p.content, p.securityLevel);
      opts = {
        bcid,
        text: p.content || " ",
        scale: BWIP_SCALE,
        rowheight: Math.max(
          1,
          Math.round(p.rowHeight / Math.max(p.moduleWidth, 1)),
        ),
        columns,
        // ZPL securityLevel 0 = auto → ECC level 0 (minimum). 1–8 map directly
        // to bwip eclevel 1–8 (empirically validated against Labelary).
        eclevel: String(p.securityLevel),
      };
      break;
    }
    case "qrcode": {
      const p = obj.props;
      // Shared with the rotated ^GFA emit so screen and print cannot diverge.
      opts = { ...qrBwipOptions(p.content, p.errorCorrection), scale: BWIP_SCALE };
      break;
    }
    case "datamatrix": {
      const p = obj.props;
      const version = dmVersionString(p);
      opts = {
        ...dmBwipInput(p),
        scale: BWIP_SCALE,
        ...(version ? { version } : {}),
      };
      break;
    }
    case "aztec": {
      const p = obj.props;
      // Map ^B0 d-param (ecLevel) to bwip bcid/format/size so the preview matches
      // the print: compact/full layer count and Rune drive the actual symbol size.
      opts = { ...aztecBwipOptions(p.ecLevel), text: p.content || " ", scale: BWIP_SCALE };
      break;
    }
    case "maxicode": {
      const p = obj.props;
      opts = { bcid, text: p.content || " ", scale: BWIP_SCALE, mode: p.mode };
      break;
    }
    case "micropdf417": {
      const p = obj.props;
      // ^BF mode pins the symbol version; without it bwip auto-sizes to the
      // minimal fit and the footprint diverges from the print (up to 2x).
      // Over-capacity content encodes in BWIPP but prints NOTHING, so it
      // yields no options at all (the canvas rejects it with an error).
      const version = micropdf417ModeDims(p.mode);
      if (!micropdf417ModeFits(version.columns, version.rows, p.content ?? "")) return null;
      opts = {
        bcid,
        text: p.content || " ",
        scale: BWIP_SCALE,
        columns: version.columns,
        rows: version.rows,
        rowheight: Math.max(
          1,
          Math.round(p.rowHeight / Math.max(p.moduleWidth, 1)),
        ),
      };
      break;
    }
    case "codablock": {
      const p = obj.props;
      opts = {
        bcid,
        text: p.content || " ",
        scale: BWIP_SCALE,
        // Pin columns to the ^BB c value so the preview tracks the columns
        // control, but floor at bwip's minimum of 4 (the model/emit keep the
        // true 2-62). Approximate only: bwip counts Code 128 codewords while the
        // firmware counts characters, so numeric data stacks into fewer rows on
        // the printer (codablock stays "unverified").
        columns: Math.max(CODABLOCK_PREVIEW_COLUMNS_MIN, clampCodablockColumns(p.columns)),
        rowheight: Math.max(
          8,
          Math.round(p.rowHeight / Math.max(p.moduleWidth, 1)),
        ),
      };
      break;
    }
    default:
      return null;
  }

  return opts;
}

/**
 * Barcode bbox in pixels. `(w, h)` is the firmware-reserved footprint
 * including text zones; `(barLeftPx, barTopPx, barW, barH)` is the bar
 * sub-rect for drawing the bitmap.
 */
export interface BarcodeDisplaySize {
  w: number;
  h: number;
  barW: number;
  barH: number;
  barLeftPx: number;
  barTopPx: number;
  /** Upright (rotation=N) layout for inner-rotated-Group renderers. */
  upright: {
    w: number;
    h: number;
    barW: number;
    barH: number;
    barLeftPx: number;
    barTopPx: number;
  };
  /** Sub-rect of bwip canvas to render, skipping internal padding (e.g.
   *  GS1 DataBar paddingheight). Undefined = full canvas. */
  bitmapCrop?: { x: number; y: number; width: number; height: number };
}

/** Rendered-surface pixel size; a real canvas satisfies it structurally. */
export interface CanvasDims {
  width: number;
  height: number;
}

export function getDisplaySize(
  obj: LeafObject,
  canvas: CanvasDims | null,
  scale: number,
  dpmm: number,
): BarcodeDisplaySize {
  if (!canvas) {
    return {
      w: 0, h: 0, barW: 0, barH: 0, barLeftPx: 0, barTopPx: 0,
      upright: { w: 0, h: 0, barW: 0, barH: 0, barLeftPx: 0, barTopPx: 0 },
    };
  }

  const rotation = objectRotation(obj.props);
  const isQuarter = isAxisSwapped(rotation);
  const upright = getUprightDisplaySize(obj, canvas.width, canvas.height, scale, dpmm);

  // Bbox after rotation: R/B swap upright w/h; N/I keep them.
  const w = isQuarter ? upright.h : upright.w;
  const h = isQuarter ? upright.w : upright.h;

  const textZonePx = dotsToPx(barcodeTextZoneDots(obj), scale, dpmm);
  const zoneAbove = barcodeZoneAbove(obj);

  // Map the upright "below the bars" zone onto the rotated bbox: it travels
  // around the rectangle as the symbol rotates (shared with groupRotation's bbox).
  const { barTop: barTopPx, barLeft: barLeftPx, barW, barH } = barSubRect(
    rotation,
    zoneAbove,
    textZonePx,
    w,
    h,
  );

  // Crop GS1 DataBar paddingheight rows so bars fill the firmware-reserved height.
  let bitmapCrop: BarcodeDisplaySize["bitmapCrop"];
  if (obj.type === "gs1databar") {
    const bwipSc = get1DBwipScale(obj.props.magnification, scale, dpmm);
    const padPx = GS1_DATABAR_PADDING_ROWS * bwipSc;
    if (canvas.height > 2 * padPx) {
      bitmapCrop = {
        x: 0,
        y: padPx,
        width: canvas.width,
        height: canvas.height - 2 * padPx,
      };
    }
  } else if (obj.type === "maxicode") {
    const m = MAXICODE_INK_MARGIN_PX;
    bitmapCrop = {
      x: m.left,
      y: m.top,
      width: canvas.width - m.left - m.right,
      height: canvas.height - m.top - m.bottom,
    };
  }

  const uprightView = {
    w: upright.w,
    h: upright.h,
    barLeftPx: 0,
    barTopPx: zoneAbove && textZonePx > 0 ? textZonePx : 0,
    barW: upright.w,
    barH: textZonePx > 0 ? upright.h - textZonePx : upright.h,
  };

  return { w, h, barW, barH, barLeftPx, barTopPx, upright: uprightView, bitmapCrop };
}

function getUprightDisplaySize(
  obj: LeafObject,
  cw: number,
  ch: number,
  scale: number,
  dpmm: number,
): { w: number; h: number } {
  // bwip at bwipSc=1 renders 1 extra px; bwipSc>=2 is exact. extraPx corrects.
  switch (obj.type) {
    case "plessey": {
      // Canvas from renderZebraWidthBars at integer module scale; whole-module
      // widths, so the generic module mapping is exact (no bwip extra-px).
      const modulePx = dotsToPx(obj.props.moduleWidth, scale, dpmm);
      const bwipSc = get1DBwipScale(obj.props.moduleWidth, scale, dpmm);
      const w = (cw / bwipSc) * modulePx;
      const h = dotsToPx(obj.props.height, scale, dpmm);
      return { w, h };
    }
    case "planet":
    case "postal": {
      // The 2.5-module pitch rounds into the canvas width at odd module
      // scales; recover the bar count and rebuild the exact module width.
      const modulePx = dotsToPx(obj.props.moduleWidth, scale, dpmm);
      const bwipSc = get1DBwipScale(obj.props.moduleWidth, scale, dpmm);
      const bars = Math.round((cw - bwipSc) / (POSTAL_PITCH_MODULES * bwipSc)) + 1;
      const w = ((bars - 1) * POSTAL_PITCH_MODULES + 1) * modulePx;
      const h = dotsToPx(obj.props.height, scale, dpmm);
      return { w, h };
    }
    case "gs1databar": {
      const modulePx = dotsToPx(obj.props.magnification, scale, dpmm);
      const bwipSc = get1DBwipScale(obj.props.magnification, scale, dpmm);
      const w = (cw / bwipSc) * modulePx;
      // bwip renders most non-stacked variants at omni (33-module) height;
      // use spec module count instead. Sym 7 cannot be Labelary-validated
      // (input format mismatch) so bwip-natural height is best-effort.
      const specModules = GS1_DATABAR_SPEC_HEIGHT_MODULES[obj.props.symbology];
      const h = specModules !== undefined
        ? specModules * modulePx
        : (ch / bwipSc) * modulePx;
      return { w, h };
    }
    case "code128": {
      const modulePx = dotsToPx(obj.props.moduleWidth, scale, dpmm);
      const bwipSc = get1DBwipScale(obj.props.moduleWidth, scale, dpmm);
      const w = (cw / bwipSc) * modulePx;
      const h = dotsToPx(obj.props.height, scale, dpmm);
      return { w, h };
    }
    case "ean13":
    case "ean8":
    case "upca":
    case "upce": {
      // 13-dot text zone reserved by firmware even when interpretation=N.
      const modulePx = dotsToPx(obj.props.moduleWidth, scale, dpmm);
      const bwipSc = get1DBwipScale(obj.props.moduleWidth, scale, dpmm);
      const extraPx = bwipSc === 1 ? 1 : 0;
      const w = ((cw - extraPx) / bwipSc) * modulePx;
      const h = dotsToPx(obj.props.height + EAN_TEXT_ZONE_DOTS, scale, dpmm);
      return { w, h };
    }
    case "upcEanExtension": {
      // ^BS prints HRI ABOVE bars; zone only reserved when interpretation=Y
      // (f=N collapses to bar height, unlike main EAN/UPC). Labelary 80h: Y=98, N=80.
      const modulePx = dotsToPx(obj.props.moduleWidth, scale, dpmm);
      const bwipSc = get1DBwipScale(obj.props.moduleWidth, scale, dpmm);
      const extraPx = bwipSc === 1 ? 1 : 0;
      const w = ((cw - extraPx) / bwipSc) * modulePx;
      const zone = obj.props.printInterpretation
        ? upcSuppTextZoneDots(obj.props.moduleWidth)
        : 0;
      const h = dotsToPx(obj.props.height + zone, scale, dpmm);
      return { w, h };
    }
    case "logmars": {
      // Spec reserves text zone above bars regardless of printInterpretation.
      const modulePx = dotsToPx(obj.props.moduleWidth, scale, dpmm);
      const bwipSc = get1DBwipScale(obj.props.moduleWidth, scale, dpmm);
      const extraPx = bwipSc === 1 ? 1 : 0;
      const w = ((cw - extraPx) / bwipSc) * modulePx;
      const h = dotsToPx(obj.props.height + LOGMARS_TEXT_ZONE_DOTS, scale, dpmm);
      return { w, h };
    }
    case "code49": {
      // Labelary only renders HRI for ^B4; bwip is ground truth (same as ^BB).
      const p = obj.props;
      const rawRow = Math.round(p.height / Math.max(p.moduleWidth, 1));
      const rowheightUnits = Math.min(50, Math.max(8, rawRow));
      const modulePx = dotsToPx(p.moduleWidth, scale, dpmm);
      const bwipSc = get1DBwipScale(p.moduleWidth, scale, dpmm);
      const numRows = Math.max(1, Math.round(ch / (rowheightUnits * bwipSc)));
      const w = (cw / bwipSc) * modulePx;
      const h = numRows * dotsToPx(rowheightUnits * p.moduleWidth, scale, dpmm);
      return { w, h };
    }
    case "code39":
    case "interleaved2of5":
    case "code93":
    case "code11":
    case "industrial2of5":
    case "standard2of5":
    case "codabar":
    case "msi": {
      const modulePx = dotsToPx(obj.props.moduleWidth, scale, dpmm);
      const bwipSc = get1DBwipScale(obj.props.moduleWidth, scale, dpmm);
      const extraPx = bwipSc === 1 ? 1 : 0;
      const w = ((cw - extraPx) / bwipSc) * modulePx;
      const h = dotsToPx(obj.props.height, scale, dpmm);
      return { w, h };
    }
    case "pdf417": {
      const p = obj.props;
      const numRows = ch / (BWIP_PDF417_MIN_ROWHEIGHT * BWIP_SCALE);
      // PDF417 module width: 17*(columns+4)+1.
      const columns =
        p.columns || estimatePdf417Columns(p.content, p.securityLevel);
      const modulesW = 17 * (columns + 4) + 1;

      const w = dotsToPx(modulesW * p.moduleWidth, scale, dpmm);
      const h = numRows * dotsToPx(p.rowHeight, scale, dpmm);
      return { w, h };
    }
    case "qrcode": {
      const modulePx = dotsToPx(obj.props.magnification, scale, dpmm);
      const size =
        (cw / (BWIP_SCALE * BWIP_2D_INTERNAL_SCALE)) * modulePx;
      return { w: size, h: size };
    }
    case "datamatrix": {
      // Rectangular symbols have cw ≠ ch; both map through the same module px.
      const modulePx = dotsToPx(obj.props.dimension, scale, dpmm);
      const denom = BWIP_SCALE * BWIP_2D_INTERNAL_SCALE;
      return { w: (cw / denom) * modulePx, h: (ch / denom) * modulePx };
    }
    case "aztec": {
      const modulePx = dotsToPx(obj.props.magnification, scale, dpmm);
      const size =
        (cw / (BWIP_SCALE * BWIP_2D_INTERNAL_SCALE)) * modulePx;
      return { w: size, h: size };
    }
    case "maxicode": {
      // Fixed physical symbol: size tracks dpmm. Quantise through mmToDots, the
      // path resolveDefaultSizeDots takes, so both round half-dot ties alike and
      // the footprint can't flip with the zoom level.
      const w = dotsToPx(mmToDots(MAXICODE_WIDTH_MM, dpmm), scale, dpmm);
      const h = dotsToPx(mmToDots(MAXICODE_HEIGHT_MM, dpmm), scale, dpmm);
      return { w, h };
    }
    case "micropdf417": {
      const p = obj.props;
      // Row count comes from the ^BF mode, not the rendered canvas: the
      // firmware prints the mode's rows even where the BWIPP-gap retry drew
      // a taller fallback symbol (ZD230-measured, mode 0 stays 11 rows).
      const w =
        (cw / BWIP_SCALE) * dotsToPx(p.moduleWidth, scale, dpmm);
      const h = micropdf417ModeDims(p.mode).rows * dotsToPx(p.rowHeight, scale, dpmm);
      return { w, h };
    }
    case "codablock": {
      const p = obj.props;
      const specRowheight = Math.max(
        8,
        Math.round(p.rowHeight / Math.max(p.moduleWidth, 1)),
      );
      const w =
        (cw / BWIP_SCALE + CODABLOCK_FIRMWARE_MODULE_OFFSET) *
        dotsToPx(p.moduleWidth, scale, dpmm);
      const h =
        (ch / BWIP_SCALE) *
        (dotsToPx(p.rowHeight, scale, dpmm) / specRowheight);
      return { w, h };
    }
    default: {
      return { w: cw, h: ch };
    }
  }
}

/** Code 39 bar/space runs in narrow modules with the printer's TLC39
 *  geometry (ZD230-decoded 2026-08-03): wide bars scale with r1 (bwip
 *  hardcodes ratio 3), intercharacter gaps stay 1 module, and the LINKED
 *  form prints the complete `*eci*` symbol, a 10-module gap, then the
 *  linkage character `T` alone at 1.4*h1 tall. `tallFromModule` marks where
 *  that tall region starts (null when unlinked: plain Code 39). */
export interface Tlc39Code39Runs {
  runs: number[];
  totalModules: number;
  tallFromModule: number | null;
}

function code39RawRuns(bwip: BwipEngine, text: string, wideRatio: number): number[] | null {
  let entry: { sbs?: number[] };
  try {
    entry = firstRawEntry(bwip.raw({ bcid: "code39", text: text || " " }));
  } catch {
    return null;
  }
  if (!entry.sbs?.length) return null;
  const runs = entry.sbs.map((w, i) =>
    i % 10 === 9 ? 1 : Number(w) >= 3 ? wideRatio : 1,
  );
  // bwip appends a gap after the stop char; the symbol ends on its last bar.
  if (runs.length % 10 === 0) runs.pop();
  return runs;
}

export function tlc39Code39Runs(
  bwip: BwipEngine,
  eci: string,
  wideRatio: number,
  linked: boolean,
): Tlc39Code39Runs | null {
  const runs = code39RawRuns(bwip, eci, wideRatio);
  if (!runs) return null;
  let tallFromModule: number | null = null;
  if (linked) {
    // The lone T sits at elements 10-18 of bwip's `*T*` render.
    const tRuns = code39RawRuns(bwip, "T", wideRatio)?.slice(10, 19);
    if (tRuns?.length === 9) {
      tallFromModule = runs.reduce((a, b) => a + b, 0) + TLC39_LINK_GAP_MODULES;
      runs.push(TLC39_LINK_GAP_MODULES, ...tRuns);
    }
  }
  return { runs, totalModules: runs.reduce((a, b) => a + b, 0), tallFromModule };
}

/** Split on first comma: ECI for Code 39, serial for MicroPDF417. */
export function splitTlc39Content(content: string): { eci: string; serial: string } {
  if (!content) return { eci: "", serial: "" };
  const comma = content.indexOf(",");
  if (comma < 0) return { eci: content, serial: "" };
  return { eci: content.slice(0, comma), serial: content.slice(comma + 1) };
}

export interface Tlc39RenderProps {
  content: string;
  moduleWidth: number;
  wideRatio: number;
  height: number;
  microPdfModuleWidth: number;
  microPdfRowHeight: number;
}

/** Drawing that mirrors bwip's DrawingBuiltin sizing (integer scale, padding,
 *  rotation swap) but records the surface size instead of rasterizing. */
const noop = () => undefined;

function dimsDrawing() {
  let opts: Record<string, unknown> = {};
  let dims: CanvasDims | null = null;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    setopts(o: Record<string, unknown>) { opts = o; },
    scale(sx: number, sy: number): [number, number] {
      if (opts.bcid === "swissqrcode") return [sx, sy];
      return [(sx | 0) || 1, (sy | 0) || 1];
    },
    measure() { return { width: 0, ascent: 0, descent: 0 }; },
    init(width: number, height: number) {
      const w = width + n(opts.paddingleft) + n(opts.paddingright);
      const h = height + n(opts.paddingtop) + n(opts.paddingbottom);
      const swap = opts.rotate === "L" || opts.rotate === "R";
      dims = swap ? { width: h, height: w } : { width: w, height: h };
    },
    // Rasterization is discarded; only the surface size matters.
    line: noop, polygon: noop, hexagon: noop, ellipse: noop, fill: noop, text: noop,
    end() { return dims; },
  };
}

/** bwip surface size for `opts`, matching toCanvas' canvas dims; null on
 *  encode failure (bwip yields `false` when nothing was drawn). */
function bwipDimsExact(bwip: BwipEngine, opts: Record<string, unknown>): CanvasDims | null {
  try {
    const d = bwip.render(opts, dimsDrawing());
    return d && typeof d === "object" ? (d as CanvasDims) : null;
  } catch {
    return null;
  }
}

function bwipDims(bwip: BwipEngine, opts: Record<string, unknown>): CanvasDims | null {
  const first = bwipDimsExact(bwip, opts);
  if (first) return first;
  const retry = bwipRetryOptions(opts);
  return retry ? bwipDimsExact(bwip, retry) : null;
}

/** Total EAN/UPC symbol width in modules (sum of the raw bar/space widths). */
export function eanUpcTotalModules(g: BwipRawLinear): number {
  let total = 0;
  for (const w of g.sbs ?? []) total += w;
  return total;
}

/** Rendered-surface pixel dims for `obj`, replicating each renderBarcodeCanvas
 *  path without a canvas. */
function barcodeDimsPx(
  bwip: BwipEngine,
  obj: LeafObject,
  scale: number,
  dpmm: number,
): CanvasDims | null {
  if (obj.type === "tlc39") {
    return tlc39DimsPx(bwip, obj.props as Tlc39RenderProps, scale, dpmm);
  }
  if (ZEBRA_WIDTH_BAR_TYPES.has(obj.type)) {
    const p = obj.props as { content?: string; moduleWidth: number; height: number };
    const modulePx = get1DBwipScale(p.moduleWidth, scale, dpmm);
    const heightPx = Math.max(1, Math.round(dotsToPx(p.height, scale, dpmm)));
    try {
      const text = zebraWidthBarText(obj.type as ZebraWidthBarType, p.content ?? "");
      const entry = firstRawEntry(bwip.raw({ bcid: ZEBRA_WIDTH_BCID[obj.type as ZebraWidthBarType], text }));
      const geo = zebraWidthBarGeometry(obj.type as ZebraWidthBarType, entry, modulePx, heightPx);
      if (!geo) return null;
      return { width: Math.max(1, Math.round(geo.width)), height: heightPx };
    } catch {
      return null;
    }
  }
  if (EAN_UPC_TYPES.has(obj.type)) {
    const p = obj.props as { moduleWidth?: number; height: number };
    const modulePxInt = get1DBwipScale(p.moduleWidth ?? 2, scale, dpmm);
    const barH = Math.round(dotsToPx(p.height, scale, dpmm));
    const tailH = Math.max(0, Math.round(dotsToPx(EAN_TEXT_ZONE_DOTS, scale, dpmm)));
    if (modulePxInt <= 0 || barH <= 0) return null;
    const g = rawEanUpc(bwip, obj.type as EanUpcType, getObjectStringContent(obj) ?? "");
    if (!g?.sbs) return null;
    const totalModules = eanUpcTotalModules(g);
    if (totalModules <= 0) return null;
    return { width: totalModules * modulePxInt, height: barH + tailH };
  }
  const opts = buildBwipOptions(obj, scale, dpmm);
  if (!opts) return null;
  return bwipDims(bwip, opts);
}

/** Surface rounding shared by the TLC39 kernel dims and the canvas renderer. */
function roundedDims(width: number, height: number): CanvasDims {
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

export interface Tlc39CompositeLayout {
  width: number;
  height: number;
  mpdfX: number;
  mpdfY: number;
  mpdfPxW: number;
  mpdfPxH: number;
  code39Y: number;
  code39PxH: number;
  /** Tall-stop overhang above and below the Code 39 band (0 when unlinked). */
  stopOverhangPx: number;
}

/** TLC39 composite layout, single source for kernel dims and canvas renderer.
 *  ZD230-measured 2026-08-03: MicroPDF indents 1*w1, the gap below it is
 *  1*w1, and the linked stop char overhangs the Code 39 band by h1/5 on both
 *  sides (12 @ h1=60, 21 @ h1=100; round() accepts the 1-dot drift). */
export function tlc39CompositeLayout(
  code39W: number,
  mpdfW: number,
  mpdfH: number,
  code39H: number,
  modulePx: number,
  linked: boolean,
): Tlc39CompositeLayout {
  const code39PxW = Math.max(1, Math.round(code39W));
  const code39PxH = Math.max(1, Math.round(code39H));
  if (!linked) {
    return {
      width: code39PxW, height: code39PxH,
      mpdfX: 0, mpdfY: 0, mpdfPxW: 0, mpdfPxH: 0,
      code39Y: 0, code39PxH, stopOverhangPx: 0,
    };
  }
  const mpdfX = Math.round(modulePx);
  const mpdfPxW = Math.max(1, Math.round(mpdfW));
  const mpdfPxH = Math.max(1, Math.round(mpdfH));
  const gap = Math.round(modulePx);
  const stopOverhangPx = Math.round(code39PxH / 5);
  // The stop char may poke above the MicroPDF; shift everything down then.
  const topOverflow = Math.max(0, stopOverhangPx - (mpdfPxH + gap));
  const code39Y = topOverflow + mpdfPxH + gap;
  return {
    width: Math.max(code39PxW, mpdfX + mpdfPxW),
    height: code39Y + code39PxH + stopOverhangPx,
    mpdfX, mpdfY: topOverflow, mpdfPxW, mpdfPxH,
    code39Y, code39PxH, stopOverhangPx,
  };
}

// ZD230-measured 4-column row ladder (details: tlc39MicroPdfDims).
const TLC39_4COL_ROWS: readonly number[] = [6, 8, 10, 12, 15, 20, 26, 32, 38, 44];

/** Modules between the Code 39 stop and the tall linkage T (ZD230-decoded). */
const TLC39_LINK_GAP_MODULES = 10;

/** Firmware-derived row target: the smallest linked version whose Table-5
 *  capacity (digits / alpha / byte compaction) fits the serial. */
function tlc39TargetRows(serial: string): number | null {
  for (const rows of TLC39_4COL_ROWS) {
    if (micropdf417ModeFits(4, rows, serial)) return rows;
  }
  // Past every linked capacity: no version is print-true (BWIPP may still
  // encode 4x44); the caller degrades to the badged unlinked form.
  return null;
}

/** Linked TLC39 MicroPDF dims: always 4 columns, smallest version from 6
 *  rows up that fits the encoded serial (ZD230-measured; 4x4 is never
 *  chosen). A serial with non-alphanumeric bytes compacts in byte mode on
 *  the firmware where BWIPP would text-compact (measured: 39 chars with
 *  commas print 15 rows, BWIPP fits 10), so the row count is estimated
 *  byte-wise there. Returns bwip px dims plus the row count. */
export interface Tlc39MicroPdf {
  dims: CanvasDims;
  /** Rows of the DRAWN bwip symbol (>= targetRows when escalated). */
  rows: number;
  /** Firmware-derived row count; footprint and layout size to THIS so the
   *  approximated case keeps the print-true bounds (the drawn bitmap gets
   *  squeezed, mirroring the ^BF mode-gap handling). */
  targetRows: number;
  /** BWIPP could not render the firmware-derived version and the symbol
   *  escalated to a larger one. */
  approximated: boolean;
}

export function tlc39MicroPdfDims(
  bwip: BwipEngine,
  serial: string,
): Tlc39MicroPdf | null {
  // Exact renders only, from the firmware target upward: the generic
  // micropdf417 retry would silently fall back to auto rows and split
  // `rows` from `dims`, and BWIPP's own auto pick can diverge from the
  // Table-5 target near capacity. Escalation flags `approximated`.
  const target = tlc39TargetRows(serial);
  if (target === null) return null;
  for (const rows of TLC39_4COL_ROWS) {
    if (rows < target) continue;
    const dims = bwipDimsExact(bwip, {
      bcid: "micropdf417", text: serial, scale: BWIP_SCALE, columns: 4, rows,
    });
    if (dims) return { dims, rows, targetRows: target, approximated: rows > target };
  }
  return null;
}

/** TLC39 composite dims (MicroPDF417 on top, Code 39 below). */
function tlc39DimsPx(
  bwip: BwipEngine,
  props: Tlc39RenderProps,
  scale: number,
  dpmm: number,
): CanvasDims | null {
  const { eci, serial } = splitTlc39Content(props.content);
  const modulePx = dotsToPx(props.moduleWidth, scale, dpmm);
  const code39H = dotsToPx(props.height, scale, dpmm);

  // The tall "T" linkage char only appears after MicroPDF actually renders.
  const mpdf = serial ? tlc39MicroPdfDims(bwip, serial) : null;
  const geo = tlc39Code39Runs(bwip, eci, props.wideRatio, mpdf !== null);
  if (!geo) return null;
  const code39W = geo.totalModules * modulePx;

  if (!mpdf) return roundedDims(code39W, code39H);

  const mpdfW = (mpdf.dims.width / BWIP_SCALE) * dotsToPx(props.microPdfModuleWidth, scale, dpmm);
  const mpdfH = mpdf.targetRows * dotsToPx(props.microPdfRowHeight, scale, dpmm);
  const layout = tlc39CompositeLayout(code39W, mpdfW, mpdfH, code39H, modulePx, true);
  return { width: layout.width, height: layout.height };
}

/** Headless twin of the app's canvas measureBarcodeFootprintDots: identical
 *  blank/sample fallback and zone math, dims from the injected bwip engine.
 *  Measures at scale = dpmm (px = dots), intrinsic to a headless measure. */
function measureDisplayWith(
  bwip: BwipEngine,
  obj: LeafObject,
  dpmm: number,
): BarcodeDisplaySize | null {
  const blank = (getObjectStringContent(obj) ?? "").trim() === "";
  let target = obj;
  let dims = blank ? null : barcodeDimsPx(bwip, obj, dpmm, dpmm);
  if (!dims) {
    const sample = placeholderContentFor(obj.type, obj.props);
    if (!sample) return null;
    target = { ...obj, props: { ...samplePropsFor(obj.type, obj.props), content: sample } } as LeafObject;
    dims = barcodeDimsPx(bwip, target, dpmm, dpmm);
    if (!dims) return null;
  }
  const dim = getDisplaySize(target, dims, dpmm, dpmm);
  return dim.w > 0 && dim.h > 0 ? dim : null;
}

export function measureBarcodeFootprintDotsWith(
  bwip: BwipEngine,
  obj: LeafObject,
  dpmm: number,
): { w: number; h: number } | null {
  const dim = measureDisplayWith(bwip, obj, dpmm);
  return dim ? { w: pxToDots(dim.w, dpmm, dpmm), h: pxToDots(dim.h, dpmm, dpmm) } : null;
}

/** Headless twin of BarcodeObject's measured-bounds record: the full
 *  bar-rect, so objectBounds anchors FT/rotated fields exactly. */
export function measureBarcodeBoundsWith(
  bwip: BwipEngine,
  obj: LeafObject,
  dpmm: number,
): {
  width: number;
  height: number;
  barHeightDots: number;
  barLeftDots: number;
  barTopDots: number;
  uprightBarWDots: number;
  uprightBarHDots: number;
} | null {
  const dim = measureDisplayWith(bwip, obj, dpmm);
  if (!dim) return null;
  const d = (px: number) => pxToDots(px, dpmm, dpmm);
  return {
    width: d(dim.w),
    height: d(dim.h),
    barHeightDots: d(dim.barH),
    barLeftDots: d(dim.barLeftPx),
    barTopDots: d(dim.barTopPx),
    uprightBarWDots: d(dim.upright.barW),
    uprightBarHDots: d(dim.upright.barH),
  };
}

/** Marker resolution for measurement: variable defaults only, no dataset row
 *  or render mode, so a measured width never tracks transient preview state
 *  (the gated ^FT anchor is one byte per design; ^DF stores it once). */
export function resolveForMeasure<T extends LabelObject>(
  obj: T,
  variables: readonly Variable[],
  clock?: ClockResolveCtx,
): T {
  return applyBindingToObject(obj, variables, null, "preview", clock, ctrlParityFor(obj));
}
