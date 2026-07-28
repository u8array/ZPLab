import type { Code49Props } from "../../../registry/code49";
import { clampCodablockColumns } from "../../../registry/codablock";
import { isDmRectPair, type DataMatrixProps } from "../../../registry/datamatrix";
import type { Gs1DatabarProps } from "../../../registry/gs1databar";
import type { MaxicodeProps } from "../../../registry/maxicode";
import { GS1_DATABAR_DEFAULT_SEGMENTS } from "../../gs1";
import type { ParserState } from "../context";
import { dotsFor, int, readRotation } from "../helpers";
import type { Handler } from "../types";

/** ^B* barcode commands + shared ^BY defaults. Touches `field` and `defaults`. */
export function createBarcodeHandlers(s: ParserState): Record<string, Handler> {
  const { field, defaults } = s;
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
      field.fieldType = type;
      field.bcRotation = readRotation(p[0]);
      field.bcHeight = dots(p[hIdx], defaults.byHeight || 100);
      field.bcInterp = (p[iIdx] ?? iDefault) === "Y";
      // The g-param (interpretation line above) always sits right after f.
      field.bcInterpAbove = (p[iIdx + 1] ?? "N") === "Y";
      field.bcCheck = cIdx >= 0 ? (p[cIdx] ?? "N") === "Y" : false;
    };

  const handleAztec: Handler = (p) => {
    field.fieldType = "aztec";
    field.bcRotation = readRotation(p[0]);
    field.aztecMag = int(p[1], 4);
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
      field.bcGs1 = (p[5] ?? "").toUpperCase() === "D";
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
      field.fieldType = "code49";
      field.bcRotation = readRotation(p[0]);
      field.bcHeight = dots(p[1], defaults.byHeight || 20);
      field.bcInterp = (p[2] ?? "N") === "Y";
      const m = (p[3] ?? "A").toUpperCase();
      field.bcCode49Mode = /^[A0-5]$/.test(m)
        ? (m as Code49Props["mode"])
        : "A";
    },

    // MSI: check logic is "any letter except N" (not simple "Y"); keep inline.
    // ^BMN,{checkType},{height},{interp},N  (checkType: A/B/C/D=enabled, N=none)
    BM(p) {
      field.fieldType = "msi";
      field.bcRotation = readRotation(p[0]);
      field.bcCheck = (p[1] ?? "N") !== "N";
      field.bcHeight = dots(p[2], defaults.byHeight || 100);
      field.bcInterp = (p[3] ?? "Y") === "Y";
      field.bcInterpAbove = (p[4] ?? "N") === "Y";
    },

    // GS1 Databar: different param layout, also updates defaults.byModuleWidth.
    // ^BRo,{symbology},{magnification},{separator},{height},{segments}
    BR(p) {
      field.fieldType = "gs1databar";
      field.bcRotation = readRotation(p[0]);
      // p[2] is the ^BR magnification multiplier (1-10), not a dot
      // quantity. Out-of-range falls back to ^BY at flush time.
      const mag = int(p[2]);
      field.gsMagnification = mag >= 1 && mag <= 10 ? mag : undefined;
      field.gsSymbology = (int(p[1], 1) as Gs1DatabarProps["symbology"]) || 1;
      field.gsSegments =
        p[5] !== undefined
          ? int(p[5], GS1_DATABAR_DEFAULT_SEGMENTS)
          : undefined;
    },

    // ^BQ orientation slot is decorative; canonicalized to N on emit.
    BQ(p) {
      field.fieldType = "qrcode";
      field.qrModel = int(p[1], 2);
      field.qrMag = int(p[2], 4);
    },

    // ^BXo,h,s,c,r,f,g,a; DataMatrix. p[6] = GS1 escape char, p[7] = aspect
    // ratio (quality-200 only; below that firmware prints square). p[5]
    // (format ID, quality 0-140 only) is intentionally dropped and
    // canonicalized away on emit.
    BX(p) {
      field.fieldType = "datamatrix";
      field.bcRotation = readRotation(p[0]);
      field.dmDim = dots(p[1], 5);
      field.dmQuality = int(p[2], 200) as DataMatrixProps["quality"];
      // c/r and the a param are ECC-200 features; below that the firmware
      // auto-sizes a square symbol, so drop them to keep the model consistent
      // with the preview (dmVersionString ignores them there anyway).
      const q200 = field.dmQuality === 200;
      const cols = q200 ? int(p[3], 0) || undefined : undefined;
      const rows = q200 ? int(p[4], 0) || undefined : undefined;
      field.dmCols = cols;
      field.dmRows = rows;
      field.dmEscape = p[6] || undefined;
      // A forced c/r pair decides the shape — the firmware honors it over the
      // a param; only an auto-sized symbol takes its shape from a.
      const rect = cols && rows ? isDmRectPair(rows, cols) : int(p[7], 1) === 2;
      field.dmAspect = q200 && rect ? 2 : undefined;
    },

    // ^B7N,{rowHeight},{securityLevel},{columns},,,; PDF417
    B7(p) {
      field.fieldType = "pdf417";
      field.bcRotation = readRotation(p[0]);
      field.pdfRowHeight = dots(p[1], 10);
      field.pdfSecurity = int(p[2], 0);
      field.pdfColumns = int(p[3], 0);
    },

    // ^B0N,{magnification},... / ^BON,...; Aztec (^B0 and ^BO are synonyms)
    B0: handleAztec,
    BO: handleAztec,

    // ^BDm,{symbolNumber},{totalSymbols}: Maxicode (spec p106; fixed
    // physical size, no orientation slot). Structured-append params are
    // read but pinned to (1,1) on emit.
    BD(p) {
      field.fieldType = "maxicode";
      const m = int(p[0], 4);
      field.maxicodeMode = (m >= 2 && m <= 6 ? m : 4) as MaxicodeProps["mode"];
    },

    // ^BFN,{rowHeight}: MicroPDF417
    BF(p) {
      field.fieldType = "micropdf417";
      field.bcRotation = readRotation(p[0]);
      field.mpdfRowHeight = dots(p[1], 10);
    },

    // ^BBN,{rowHeight},{security},{numCharsPerRow},{numRows},{mode}: CODABLOCK.
    // c (p[3]) is the stacking control we model; r (p[4]) and mode (p[5]) are
    // canonicalized on emit (r left to the firmware, mode pinned to F).
    BB(p) {
      field.fieldType = "codablock";
      field.bcRotation = readRotation(p[0]);
      field.cbRowHeight = dots(p[1], 10);
      field.cbSecurity = (p[2] ?? "Y") === "N" ? "N" : "Y";
      // int(p[3], 0) || undefined: a missing OR empty c both fall back to the
      // default (matches the dm cols/rows idiom above), not to the clamp floor.
      field.cbColumns = clampCodablockColumns(int(p[3], 0) || undefined);
    },

    // ^BTo,w1,r1,h1,w2,h2: TLC39 (Code 39 + optional MicroPDF417 stack)
    BT(p) {
      field.fieldType = "tlc39";
      field.bcRotation = readRotation(p[0]);
      // w1 (Code 39 narrow bar) overrides ^BY when present; undefined
      // means fall back to defaults.byModuleWidth at flush time.
      field.tlcModuleWidth = dots(p[1], 0) || undefined;
      // p[2] (r1) intentionally dropped, canonicalized on emit.
      field.tlcHeight = dots(p[3], defaults.byHeight || 40);
      field.tlcMicroPdfRowHeight = dots(p[4], 4);
      // Zebra ^BT h2 range is 1-10; firmware snaps to a valid linked
      // MicroPDF417 row count {4,6,8,10} on print.
      const rows = int(p[5], 4);
      field.tlcMicroPdfRows = rows >= 1 && rows <= 10 ? rows : 4;
    },
  };
}
