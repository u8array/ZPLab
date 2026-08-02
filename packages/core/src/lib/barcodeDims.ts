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
  gs1ContentToElementString,
} from "./gs1";
import { code128ControlBwipRaw, code128FdToSymbols, code128PlainFd, code128SymbolsToBwipRaw } from "./code128Subset";
import { isRectangular, dmVersionString, type DataMatrixProps } from "../registry/datamatrix";
import { MAXICODE_WIDTH_MM, MAXICODE_HEIGHT_MM } from "../registry/maxicode";
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
  MICROPDF417_PX_PER_ROW,
  MICROPDF417_QUIET_ZONE_ROWS,
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

function isAi01ElevenDigitFragment(content: string): boolean {
  return /^01\d{11}$/.test(content);
}

function gs1BwipText(content: string): string {
  if (isAi01ElevenDigitFragment(content)) return `(99)${content}`;
  // Catalog parser handles variable AIs (GS-separated); falls back to the
  // legacy fixed-AI wrapper for content it can't cleanly segment.
  return gs1ContentToElementString(content);
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

/** GS1 mode: bwip auto-inserts FNC1 from the (AI)… element string. */
export function dmBwipInput(p: DataMatrixProps): { bcid: string; text: string } {
  const rect = isRectangular(p);
  return {
    bcid: p.gs1
      ? (rect ? "gs1datamatrixrectangular" : "gs1datamatrix")
      : (rect ? "datamatrixrectangular" : "datamatrix"),
    text: (p.gs1 ? gs1ContentToElementString(p.content) : p.content) || " ",
  };
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
      // GS1-128: feed the (AI)data element string; not gs1BwipText, whose (99)
      // shortcut is a DataBar convention that would desync bars from HRI/^FD.
      if (p.gs1) {
        opts = { bcid: "gs1-128", text: gs1ContentToElementString(p.content) || "(01)00000000000000", scale, height: 10 };
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
      opts = { bcid, text, scale, height: 10 };
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
      // Zebra always encodes Mod10 in MSI; ^BM e=N only suppresses the HRI digit.
      opts = { bcid, text: p.content || "0", scale, height: 10, includecheck: true };
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
      // Sym 1..5 require AI 01 + valid 14-digit GTIN with check.
      const text = isExpanded
        ? gs1BwipText(p.content)
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
      opts = {
        bcid,
        text: p.content || " ",
        scale: BWIP_SCALE,
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
      const numRows = micropdfDataRows(ch);
      const w =
        (cw / BWIP_SCALE) * dotsToPx(p.moduleWidth, scale, dpmm);
      const h = numRows * dotsToPx(p.rowHeight, scale, dpmm);
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

/** Valid MicroPDF417 row counts in TLC39's linked 4-column geometry. */
const TLC39_MICROPDF_ROW_COUNTS = [4, 6, 8, 10] as const;

/** Snap to the nearest valid row count, bwip-js throws on any other value. */
export function snapTlc39MicroPdfRows(requested: number): number {
  if (!Number.isFinite(requested)) return 4;
  for (const r of TLC39_MICROPDF_ROW_COUNTS) if (requested <= r) return r;
  return 10;
}

/** Data-row count from a bwip-js MicroPDF417 canvas height (assumes scale=BWIP_SCALE). */
function micropdfDataRows(canvasHeight: number): number {
  return Math.max(
    0,
    canvasHeight / (BWIP_SCALE * MICROPDF417_PX_PER_ROW)
      - MICROPDF417_QUIET_ZONE_ROWS,
  );
}

/** Split on first comma: ECI for Code 39, serial for MicroPDF417 (leading "S" stripped). */
export function splitTlc39Content(content: string): { eci: string; serial: string } {
  if (!content) return { eci: "", serial: "" };
  const comma = content.indexOf(",");
  if (comma < 0) return { eci: content, serial: "" };
  const eci = content.slice(0, comma);
  let serial = content.slice(comma + 1);
  if (serial.startsWith("S")) serial = serial.slice(1);
  return { eci, serial };
}

export interface Tlc39RenderProps {
  content: string;
  moduleWidth: number;
  height: number;
  microPdfRowHeight: number;
  microPdfRows: number;
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
function bwipDims(bwip: BwipEngine, opts: Record<string, unknown>): CanvasDims | null {
  try {
    const d = bwip.render(opts, dimsDrawing());
    return d && typeof d === "object" ? (d as CanvasDims) : null;
  } catch {
    return null;
  }
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
export function roundedDims(width: number, height: number): CanvasDims {
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

export interface Tlc39CompositeLayout {
  width: number;
  height: number;
  mpdfPxH: number;
  code39PxH: number;
}

/** TLC39 composite layout (MicroPDF417 over Code 39, shared width): single
 *  source for kernel dims and canvas renderer so the two cannot drift. */
export function tlc39CompositeLayout(
  code39W: number,
  mpdfW: number,
  mpdfH: number,
  code39H: number,
): Tlc39CompositeLayout {
  const width = Math.max(1, Math.round(Math.max(code39W, mpdfW)));
  const mpdfPxH = Math.max(1, Math.round(mpdfH));
  const code39PxH = Math.max(1, Math.round(code39H));
  return { width, height: mpdfPxH + code39PxH, mpdfPxH, code39PxH };
}

/** TLC39 composite dims (MicroPDF417 on top, Code 39 below; shared width). */
function tlc39DimsPx(
  bwip: BwipEngine,
  props: Tlc39RenderProps,
  scale: number,
  dpmm: number,
): CanvasDims | null {
  const { eci, serial } = splitTlc39Content(props.content);
  const bwipScale = get1DBwipScale(props.moduleWidth, scale, dpmm);
  const modulePx = dotsToPx(props.moduleWidth, scale, dpmm);
  const code39H = dotsToPx(props.height, scale, dpmm);

  const code39Dims = (text: string): CanvasDims | null =>
    bwipDims(bwip, {
      bcid: "code39",
      text: text || " ",
      scale: bwipScale,
      height: 10,
      includetext: false,
    });

  if (!serial) {
    const src = code39Dims(eci);
    if (!src) return null;
    return roundedDims((src.width / bwipScale) * modulePx, code39H);
  }

  // "T" linkage flag only appended after MicroPDF actually renders.
  const snappedRows = snapTlc39MicroPdfRows(props.microPdfRows);
  const mpdfSrc = bwipDims(bwip, {
    bcid: "micropdf417",
    text: serial,
    scale: BWIP_SCALE,
    rows: snappedRows,
    // TLC39 spec: linked MicroPDF417 is fixed at 4 columns.
    columns: 4,
  });
  const mpdfOk = mpdfSrc !== null;

  const code39Src = code39Dims(mpdfOk ? `${eci}T` : eci);
  if (!code39Src) return null;
  const code39W = (code39Src.width / bwipScale) * modulePx;

  if (!mpdfOk) return roundedDims(code39W, code39H);

  const mpdfW = (mpdfSrc.width / BWIP_SCALE) * modulePx;
  const mpdfH = snappedRows * dotsToPx(props.microPdfRowHeight, scale, dpmm);
  const layout = tlc39CompositeLayout(code39W, mpdfW, mpdfH, code39H);
  return { width: layout.width, height: layout.height };
}

/** Headless twin of the app's canvas measureBarcodeFootprintDots: identical
 *  blank/sample fallback and zone math, dims from the injected bwip engine.
 *  Measures at scale = dpmm (px = dots), intrinsic to a headless measure. */
export function measureBarcodeFootprintDotsWith(
  bwip: BwipEngine,
  obj: LeafObject,
  dpmm: number,
): { w: number; h: number } | null {
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
  if (dim.w <= 0 || dim.h <= 0) return null;
  return { w: pxToDots(dim.w, dpmm, dpmm), h: pxToDots(dim.h, dpmm, dpmm) };
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
