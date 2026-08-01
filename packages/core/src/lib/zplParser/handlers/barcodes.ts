import type { Code49Props } from "../../../registry/code49";
import { clampCodablockColumns } from "../../../registry/codablock";
import { isDmRectPair, type DataMatrixProps } from "../../../registry/datamatrix";
import type { Gs1DatabarProps } from "../../../registry/gs1databar";
import { clampMaxicodeAppend, type MaxicodeProps } from "../../../registry/maxicode";
import { GS1_DATABAR_DEFAULT_SEGMENTS } from "../../gs1";
import type { ParserState } from "../context";
import { dotsFor, int, readRotation } from "../helpers";
import type { Handler } from "../types";

/** ^B* barcode commands + shared ^BY defaults. Touches `field` and `defaults`. */
export function createBarcodeHandlers(s: ParserState): Record<string, Handler> {
  // Read s.field live: resetFormatScopedState reassigns it at each page close, so
  // a destructured alias goes stale and later blocks write a dead object (barcode
  // degrades to text). `defaults` is only mutated in place, so aliasing it is safe.
  const { defaults } = s;
  const { dots } = dotsFor(s);

  // Factory for 1D barcodes: hIdx/iIdx/cIdx = param indices for height/interp/check.
  const mkBarcode =
    (
      type: string,
      hIdx: number,
      iIdx: number,
      iDefault = "Y",
      cIdx = -1,
    ): Handler =>
    (p) => {
      s.field.fieldType = type;
      s.field.bcRotation = readRotation(p[0]);
      s.field.bcHeight = dots(p[hIdx], defaults.byHeight || 100);
      s.field.bcInterp = (p[iIdx] ?? iDefault) === "Y";
      // The g-param (interpretation line above) always sits right after f.
      s.field.bcInterpAbove = (p[iIdx + 1] ?? "N") === "Y";
      s.field.bcCheck = cIdx >= 0 ? (p[cIdx] ?? "N") === "Y" : false;
    };

  const handleAztec: Handler = (p) => {
    s.field.fieldType = "aztec";
    s.field.bcRotation = readRotation(p[0]);
    s.field.aztecMag = int(p[1], 4);
  };

  return {
    // ── Barcode defaults ──────────────────────────────────────────────────
    // ^BY{moduleWidth},{ratio},{height}
    BY(p) {
      defaults.byModuleWidth = dots(p[0], 2);
      defaults.byHeight = dots(p[2], 0);
    },

    // ── 1D barcodes via mkBarcode(type, hIdx, iIdx, iDefault?, cIdx?) ─────
    // ^BCo,h,f,g,e,m; m=D (UCC/EAN) is GS1-128. Assigned every time so a later
    // plain ^BC clears it.
    BC: (p, rest, cmd) => {
      mkBarcode("code128", 1, 2, "Y", 4)(p, rest, cmd);
      s.field.bcGs1 = (p[5] ?? "").toUpperCase() === "D";
    },
    B3: mkBarcode("code39", 2, 3, "Y", 1), // ^B3N,c,h,i,N
    BE: mkBarcode("ean13", 1, 2), // ^BEN,h,i,N
    BU: mkBarcode("upca", 1, 2), // ^BUN,h,i,N,N
    B8: mkBarcode("ean8", 1, 2), // ^B8N,h,i,N
    B9: mkBarcode("upce", 1, 2), // ^B9N,h,i,N
    B2: mkBarcode("interleaved2of5", 1, 2, "Y", 4), // ^B2N,h,i,N,c
    BA: mkBarcode("code93", 1, 2, "Y", 4), // ^BAN,h,i,N,c
    B1: mkBarcode("code11", 2, 3, "Y", 1), // ^B1N,c,h,i,N
    BI: mkBarcode("industrial2of5", 1, 2), // ^BIN,h,i,N
    BJ: mkBarcode("standard2of5", 1, 2), // ^BJN,h,i,N
    BK: mkBarcode("codabar", 2, 3, "Y", 1), // ^BKN,c,h,i,N
    BL: mkBarcode("logmars", 1, 2, "N"), // ^BLN,h,i; interp default N
    BP: mkBarcode("plessey", 2, 3, "Y", 1), // ^BPN,c,h,i,N
    B5: mkBarcode("planet", 1, 2), // ^B5N,h,i,N
    BZ: mkBarcode("postal", 1, 2), // ^BZN,h,i,N
    BS: mkBarcode("upcEanExtension", 1, 2), // ^BSo,h,f (UPC/EAN supplement)

    // ^B4o,h,f,m; Code 49. Custom handler for the extra mode parameter.
    B4(p) {
      s.field.fieldType = "code49";
      s.field.bcRotation = readRotation(p[0]);
      s.field.bcHeight = dots(p[1], defaults.byHeight || 20);
      s.field.bcInterp = (p[2] ?? "N") === "Y";
      const m = (p[3] ?? "A").toUpperCase();
      s.field.bcCode49Mode = /^[A0-5]$/.test(m)
        ? (m as Code49Props["mode"])
        : "A";
    },

    // MSI: check logic is "any letter except N" (not simple "Y"); keep inline.
    // ^BMN,{checkType},{height},{interp},N  (checkType: A/B/C/D=enabled, N=none)
    BM(p) {
      s.field.fieldType = "msi";
      s.field.bcRotation = readRotation(p[0]);
      s.field.bcCheck = (p[1] ?? "N") !== "N";
      s.field.bcHeight = dots(p[2], defaults.byHeight || 100);
      s.field.bcInterp = (p[3] ?? "Y") === "Y";
      s.field.bcInterpAbove = (p[4] ?? "N") === "Y";
    },

    // GS1 Databar: different param layout, also updates defaults.byModuleWidth.
    // ^BRo,{symbology},{magnification},{separator},{height},{segments}
    BR(p) {
      s.field.fieldType = "gs1databar";
      s.field.bcRotation = readRotation(p[0]);
      // p[2] is the ^BR magnification multiplier (1-10), not a dot
      // quantity. Out-of-range falls back to ^BY at flush time.
      const mag = int(p[2]);
      s.field.gsMagnification = mag >= 1 && mag <= 10 ? mag : undefined;
      s.field.gsSymbology = (int(p[1], 1) as Gs1DatabarProps["symbology"]) || 1;
      s.field.gsSegments =
        p[5] !== undefined
          ? int(p[5], GS1_DATABAR_DEFAULT_SEGMENTS)
          : undefined;
    },

    // ^BQ orientation slot is decorative; canonicalized to N on emit.
    BQ(p) {
      s.field.fieldType = "qrcode";
      s.field.qrModel = int(p[1], 2);
      s.field.qrMag = int(p[2], 4);
    },

    // ^BXo,h,s,c,r,f,g,a; DataMatrix. p[6] = GS1 escape char, p[7] = aspect
    // ratio (quality-200 only; below that firmware prints square). p[5]
    // (format ID, quality 0-140 only) is intentionally dropped and
    // canonicalized away on emit.
    BX(p) {
      s.field.fieldType = "datamatrix";
      s.field.bcRotation = readRotation(p[0]);
      s.field.dmDim = dots(p[1], 5);
      s.field.dmQuality = int(p[2], 200) as DataMatrixProps["quality"];
      // c/r and the a param are ECC-200 features; below that the firmware
      // auto-sizes a square symbol, so drop them to keep the model consistent
      // with the preview (dmVersionString ignores them there anyway).
      const q200 = s.field.dmQuality === 200;
      const cols = q200 ? int(p[3], 0) || undefined : undefined;
      const rows = q200 ? int(p[4], 0) || undefined : undefined;
      s.field.dmCols = cols;
      s.field.dmRows = rows;
      s.field.dmEscape = p[6] || undefined;
      // A forced c/r pair decides the shape — the firmware honors it over the
      // a param; only an auto-sized symbol takes its shape from a.
      const rect = cols && rows ? isDmRectPair(rows, cols) : int(p[7], 1) === 2;
      s.field.dmAspect = q200 && rect ? 2 : undefined;
    },

    // ^B7N,{rowHeight},{securityLevel},{columns},,,; PDF417
    B7(p) {
      s.field.fieldType = "pdf417";
      s.field.bcRotation = readRotation(p[0]);
      s.field.pdfRowHeight = dots(p[1], 10);
      s.field.pdfSecurity = int(p[2], 0);
      s.field.pdfColumns = int(p[3], 0);
    },

    // ^B0N,{magnification},... / ^BON,...; Aztec (^B0 and ^BO are synonyms)
    B0: handleAztec,
    BO: handleAztec,

    // ^BDm,n,t: Maxicode (spec p106; fixed physical size, no orientation slot).
    // 2-6 is the whole value list, so an out-of-range m falls back to the same
    // 2 the firmware reads for an omitted one.
    BD(p) {
      s.field.fieldType = "maxicode";
      const m = int(p[0], 2);
      s.field.maxicodeMode = (m >= 2 && m <= 6 ? m : 2) as MaxicodeProps["mode"];
      s.field.maxicodeNumber = clampMaxicodeAppend(int(p[1], 1));
      s.field.maxicodeTotal = clampMaxicodeAppend(int(p[2], 1));
    },

    // ^BFN,{rowHeight}: MicroPDF417
    BF(p) {
      s.field.fieldType = "micropdf417";
      s.field.bcRotation = readRotation(p[0]);
      s.field.mpdfRowHeight = dots(p[1], 10);
    },

    // ^BBN,{rowHeight},{security},{numCharsPerRow},{numRows},{mode}: CODABLOCK.
    // c (p[3]) is the stacking control we model; r (p[4]) and mode (p[5]) are
    // canonicalized on emit (r left to the firmware, mode pinned to F).
    BB(p) {
      s.field.fieldType = "codablock";
      s.field.bcRotation = readRotation(p[0]);
      s.field.cbRowHeight = dots(p[1], 10);
      s.field.cbSecurity = (p[2] ?? "Y") === "N" ? "N" : "Y";
      // int(p[3], 0) || undefined: a missing OR empty c both fall back to the
      // default (matches the dm cols/rows idiom above), not to the clamp floor.
      s.field.cbColumns = clampCodablockColumns(int(p[3], 0) || undefined);
    },

    // ^BTo,w1,r1,h1,w2,h2: TLC39 (Code 39 + optional MicroPDF417 stack)
    BT(p) {
      s.field.fieldType = "tlc39";
      s.field.bcRotation = readRotation(p[0]);
      // w1 (Code 39 narrow bar) overrides ^BY when present; undefined
      // means fall back to defaults.byModuleWidth at flush time.
      s.field.tlcModuleWidth = dots(p[1], 0) || undefined;
      // p[2] (r1) intentionally dropped, canonicalized on emit.
      s.field.tlcHeight = dots(p[3], defaults.byHeight || 40);
      s.field.tlcMicroPdfRowHeight = dots(p[4], 4);
      // Zebra ^BT h2 range is 1-10; firmware snaps to a valid linked
      // MicroPDF417 row count {4,6,8,10} on print.
      const rows = int(p[5], 4);
      s.field.tlcMicroPdfRows = rows >= 1 && rows <= 10 ? rows : 4;
    },
  };
}
