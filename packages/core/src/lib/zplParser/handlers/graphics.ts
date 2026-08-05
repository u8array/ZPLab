import type { BoxProps } from "../../../registry/box";
import type { EllipseProps } from "../../../registry/ellipse";
import type { ImageProps } from "../../../registry/image";
import type { LineProps } from "../../../registry/line";
import { loadFontBytesSync } from "../../fontCache";
import { formatStoragePath, parseStoragePath } from "../../storagePath";
import { getPosType, pushBrowserLimit, type ParserState } from "../context";
import { decodeGraphicToImage } from "../decoders/graphic";
import { preserveGfData } from "../decoders/gfa";
import { extractQrSidecar } from "../../qrGraphic";
import type { QrCodeProps } from "../../../registry/qrcode";
import { dotsFor, ftTopLeft, int, makeObj, readColor, readRotation } from "../helpers";
import type { Handler } from "../types";

import { newId } from "../../ids";
/** Characters of a `^GF`/`~DY` payload retained in browserLimit findings;
 *  rest is replaced with an ellipsis so a single multi-KB base64 blob
 *  doesn't drown out the import report. */
const IMPORT_FINDING_PAYLOAD_LIMIT = 80;

/** Helpers re-exported to parseZPL so flushField can commit a stashed reverse-bg
 *  box just before the field that follows it. */
export interface GraphicsExports {
  commitPendingReverseBg: () => void;
  pushGBObject: (
    x: number,
    y: number,
    w: number,
    h: number,
    t: number,
    color: "B" | "W",
    rounding: number,
    reverseFlag: boolean | undefined,
    comment: string | undefined,
    positionType: "FO" | "FT",
    justify: "L" | "R",
  ) => void;
  /** ^LR | ^FR; returns `undefined` (not `false`) when off. */
  getReverseFlag: () => boolean | undefined;
}

export interface GraphicsFamily {
  handlers: Record<string, Handler>;
  helpers: GraphicsExports;
}

/** Graphic primitives (^GB/^GC/^GD/^GE/^GF/^GS/^XG/~DY) + reverse-bg commit. */
export function createGraphicsHandlers(
  s: ParserState,
  takeComment: () => string | undefined,
): GraphicsFamily {
  const getReverseFlag = () => s.label.lrActive || s.field.frActive || undefined;
  const { dots } = dotsFor(s);

  const pushGBObject: GraphicsExports["pushGBObject"] = (
    gx, gy, w, h, t, color, rounding, reverseFlag, comment, positionType, justify,
  ) => {
    // ^FT graphic origin is a bottom corner (spec p.205): bottom-left, or
    // bottom-right when z=1 (justify R). The model stores the top-left, so
    // lift by the height and, for R, shift left by the width. ^FO is top-left.
    const topLeftY = positionType === "FT" ? gy - h : gy;
    const topLeftX = positionType === "FT" && justify === "R" ? gx - w : gx;
    let obj;
    if (h === t && w > t) {
      obj = makeObj(
        "line", topLeftX, topLeftY,
        { angle: 0, length: w, thickness: t, color, reverse: reverseFlag } satisfies LineProps,
        positionType, comment,
      );
    } else if (w === t && h > t) {
      obj = makeObj(
        "line", topLeftX, topLeftY,
        { angle: 90, length: h, thickness: t, color, reverse: reverseFlag } satisfies LineProps,
        positionType, comment,
      );
    } else {
      const filled = t >= Math.min(w, h);
      obj = makeObj(
        "box", topLeftX, topLeftY,
        { width: w, height: h, thickness: t, filled, color, rounding, reverse: reverseFlag } satisfies BoxProps,
        positionType, comment,
      );
    }
    if (justify === "R") obj.fieldJustify = "R";
    s.result.objects.push(obj);
  };

  /** Push a graphic of footprint w x h, converting the current ^FO/^FT field
   *  anchor to the model top-left and stamping fieldJustify. Shared by every
   *  graphic that anchors a bounding box (ellipse/circle/image). */
  const pushGraphic = (
    type: string,
    w: number,
    h: number,
    props: unknown,
    comment: string | undefined,
  ) => {
    const positionType = getPosType(s.field);
    const justify = s.field.justify;
    const { x, y } = ftTopLeft(s.field.x, s.field.y, w, h, positionType, justify);
    const obj = makeObj(type, x, y, props, positionType, comment);
    if (justify === "R") obj.fieldJustify = "R";
    s.result.objects.push(obj);
  };

  const commitPendingReverseBg = () => {
    if (!s.reverseBg) return;
    const bg = s.reverseBg;
    s.reverseBg = null;
    pushGBObject(bg.x, bg.y, bg.w, bg.h, bg.t, bg.color, bg.rounding, bg.reverseFlag, bg.comment, bg.positionType ?? "FO", bg.justify ?? "L");
  };

  const handlers: Record<string, Handler> = {
    GB(p) {
      // ^GB{w},{h},{t},{color},{rounding}
      // ZPL: w=0 or h=0 means "use thickness value" for that dimension
      const t = dots(p[2], 3);
      const rawW = dots(p[0], t);
      const rawH = dots(p[1], t);
      const w = rawW === 0 ? t : rawW;
      const h = rawH === 0 ? t : rawH;
      const color = readColor(p[3]);
      const rounding = int(p[4], 0);
      const gbComment = takeComment();

      // Stash filled-black non-rounded GBs as reverse-bg candidates for flushField.
      const filled = t >= Math.min(w, h);
      const reverseFlag = getReverseFlag();
      const positionType = getPosType(s.field);
      const justify = s.field.justify;
      if (filled && color === "B" && rounding === 0 && !reverseFlag) {
        commitPendingReverseBg();
        s.reverseBg = { x: s.field.x, y: s.field.y, w, h, t, color, rounding, reverseFlag, comment: gbComment, positionType, justify };
        return;
      }
      commitPendingReverseBg();
      pushGBObject(s.field.x, s.field.y, w, h, t, color, rounding, reverseFlag, gbComment, positionType, justify);
    },
    GD(p) {
      commitPendingReverseBg();
      // ^GD{w},{h},{t},{color},{orientation}
      // orientation: L = top-left→bottom-right, R = top-right→bottom-left
      const gdW = dots(p[0], 1);
      const gdH = dots(p[1], 1);
      const gdT = dots(p[2], 3);
      const gdColor = readColor(p[3]);
      const gdOri = (p[4] ?? "L").toUpperCase();
      const gdLen = Math.round(Math.sqrt(gdW * gdW + gdH * gdH));
      // ^FT anchors the ^GD bounding box at a bottom corner; lift to the box
      // top-left before recovering the start point (gdOri is the diagonal
      // direction, distinct from the z-justify "R").
      const posType = getPosType(s.field);
      const justify = s.field.justify;
      const { x: boxX, y: boxY } = ftTopLeft(s.field.x, s.field.y, gdW, gdH, posType, justify);
      // Recover start point and angle from the bounding-box top-left.
      // 'L': dx>0,dy>0 → obj.x=boxX, angle=atan2(h,w)
      // 'R': dx<0,dy>0 → obj.x=boxX+w, angle=atan2(h,-w)
      const gdObjX = gdOri === "R" ? boxX + gdW : boxX;
      const gdAngle = Math.round(
        gdOri === "R"
          ? (Math.atan2(gdH, -gdW) * 180) / Math.PI
          : (Math.atan2(gdH, gdW) * 180) / Math.PI,
      );
      const gdObj = makeObj(
        "line",
        gdObjX,
        boxY,
        {
          angle: gdAngle,
          length: gdLen,
          thickness: gdT,
          color: gdColor,
          reverse: getReverseFlag(),
        } satisfies LineProps,
        posType,
        takeComment(),
      );
      if (justify === "R") gdObj.fieldJustify = "R";
      s.result.objects.push(gdObj);
    },
    GF(_, rest) {
      commitPendingReverseBg();
      // Byte-counted payloads can be multi-KB binary; cap the finding text.
      const gfSummary =
        rest.length > IMPORT_FINDING_PAYLOAD_LIMIT
          ? `^GF${rest.trimEnd().slice(0, IMPORT_FINDING_PAYLOAD_LIMIT)}…`
          : `^GF${rest}`;
      // ^GF{A|B|C},{totalBytes},{totalBytes},{bytesPerRow},{payload}
      const format = rest[0]?.toUpperCase();
      if (format !== "A" && format !== "B" && format !== "C") {
        pushBrowserLimit(s.result, gfSummary);
        return;
      }

      // Extract params: skip "A," then find 3rd delimiter to separate params from data.
      // Respects ^CD-mutated delimiter so ^CD;^GFA;total;total;bpr;data still parses.
      const delim = s.format.delimiterChar;
      const gfRest = rest.slice(2); // "total,total,bytesPerRow,data..."
      let commaPos = -1;
      for (let n = 0; n < 3; n++) {
        commaPos = gfRest.indexOf(delim, commaPos + 1);
        if (commaPos === -1) break;
      }
      if (commaPos === -1) {
        pushBrowserLimit(s.result, gfSummary);
        return;
      }

      const gfParams = gfRest.slice(0, commaPos).split(delim);
      const gfBytesPerRow = int(gfParams[2], 0);
      // Everything after the 3rd comma is the (possibly compressed) graphic data
      const gfRawData = gfRest.slice(commaPos + 1);

      if (gfBytesPerRow <= 0) {
        pushBrowserLimit(s.result, gfSummary);
        return;
      }

      // Pass bytes-headers verbatim so re-export keeps the firmware buffer hint.
      const gfImage = decodeGraphicToImage(
        gfRawData,
        format,
        gfBytesPerRow,
        gfParams[0] ?? "",
        gfParams[1] ?? "",
        `imported_${newId().slice(0, 8)}.png`,
      );
      if (!gfImage) {
        // Undecodable, but the header still describes the bitmap, so preserve
        // the field verbatim instead of dropping it. Height is param c (field
        // count), not b (compressed length). Rebuild the header with the default
        // delimiter so a ^CD source still round-trips (generator never re-emits ^CD).
        const gfFieldCount = int(gfParams[1], 0);
        const opaqueWidth = gfBytesPerRow * 8;
        // Malformed c (<=0 or under one full row, flooring to a 0-dot sliver)
        // falls back to a square so the placeholder stays grabbable.
        const opaqueHeight = gfFieldCount > 0 ? Math.floor(gfFieldCount / gfBytesPerRow) : 0;
        const opaqueH = opaqueHeight > 0 ? opaqueHeight : opaqueWidth;
        s.result.partialCmds.add("^GF");
        pushGraphic(
          "image",
          opaqueWidth,
          opaqueH,
          {
            imageId: "",
            widthDots: opaqueWidth,
            heightDots: opaqueH,
            threshold: 128,
            rawGf: `^GF${format},${gfParams[0]},${gfParams[1]},${gfParams[2]},${preserveGfData(gfRawData, format, int(gfParams[0], -1))}`,
          } satisfies ImageProps,
          takeComment(),
        );
        return;
      }
      if (!gfImage.crcOk) s.result.partialCmds.add("^GF");
      const gfComment = takeComment();
      // Rotated-QR sidecar: rebuild the QR object, not an image. The emit anchors
      // via fieldPos, so keep the raw field coords, not pushGraphic's ftTopLeft.
      const sidecar = gfComment ? extractQrSidecar(gfComment) : null;
      if (sidecar) {
        const { qr, rest } = sidecar;
        const obj = makeObj(
          "qrcode",
          s.field.x,
          s.field.y,
          {
            content: qr.content,
            magnification: qr.magnification,
            errorCorrection: qr.errorCorrection,
            model: qr.model,
            rotation: qr.rotation,
          } satisfies QrCodeProps,
          getPosType(s.field),
          rest,
        );
        if (s.field.justify === "R") obj.fieldJustify = "R";
        s.result.objects.push(obj);
        return;
      }
      pushGraphic(
        "image",
        gfImage.widthDots,
        gfImage.heightDots,
        {
          imageId: gfImage.imageId,
          widthDots: gfImage.widthDots,
          heightDots: gfImage.heightDots,
          threshold: 128,
          _gfaCache: gfImage.gfaCache,
        } satisfies ImageProps,
        gfComment,
      );
    },
    GE(p) {
      commitPendingReverseBg();
      // ^GE{w},{h},{t},{color}
      const w = dots(p[0], 100);
      const h = dots(p[1], 100);
      const t = dots(p[2], 3);
      const color = readColor(p[3]);
      const filled = t >= Math.min(w, h);
      pushGraphic(
        "ellipse",
        w,
        h,
        {
          width: w,
          height: h,
          thickness: t,
          filled,
          color,
          reverse: getReverseFlag(),
        } satisfies EllipseProps,
        takeComment(),
      );
    },
    GC(p) {
      commitPendingReverseBg();
      // ^GC{diameter},{thickness},{color}  → circle = ellipse with equal w/h
      const d = dots(p[0], 100);
      const t = dots(p[1], 3);
      const color = readColor(p[2]);
      const filled = t >= d;
      pushGraphic(
        "ellipse",
        d,
        d,
        {
          width: d,
          height: d,
          thickness: t,
          filled,
          color,
          lockAspect: true,
          reverse: getReverseFlag(),
        } satisfies EllipseProps,
        takeComment(),
      );
    },

    // ── Recall stored graphic ──────────────────────────────────────────────
    XG(_, rest) {
      commitPendingReverseBg();
      // ^XGd:f.x,mx,my, references a graphic uploaded earlier via ~DY.
      // Two valid imports:
      //  - With preceding ~DY in the stream: full image (bytes + storedAs
      //    with embedInZpl=true) so re-emit produces the same upload+recall.
      //  - Without ~DY: the printer is assumed to host the file out-of-band
      //    (admin pre-loaded). Object gets storedAs.embedInZpl=false and
      //    no cached bitmap; the canvas falls back to a placeholder, the
      //    emitter skips the ~DY preamble but keeps the ^XG reference.
      const firstComma = rest.indexOf(s.format.delimiterChar);
      const xgPath = firstComma === -1 ? rest : rest.slice(0, firstComma);
      const parsed = parseStoragePath(xgPath);
      if (!parsed) {
        pushBrowserLimit(s.result, `^XG${rest}`);
        return;
      }
      const uploaded = s.fonts.downloadedGraphics.get(formatStoragePath(parsed, true));
      if (uploaded) {
        pushGraphic(
          "image",
          uploaded.widthDots,
          uploaded.heightDots,
          {
            imageId: uploaded.imageId,
            widthDots: uploaded.widthDots,
            heightDots: uploaded.heightDots,
            threshold: 128,
            _gfaCache: uploaded.gfaCache,
            storedAs: { ...parsed, embedInZpl: true },
          } satisfies ImageProps,
          takeComment(),
        );
        return;
      }
      // Recall-only: no bytes available, but the ZPL is valid and the
      // printer side is assumed to resolve. Surface as partial so the
      // import report flags the degraded preview. No real dims; the square
      // placeholder doubles as the ^FT footprint.
      s.result.partialCmds.add("^XG");
      pushGraphic(
        "image",
        200,
        200,
        {
          imageId: "",
          widthDots: 200,
          threshold: 128,
          storedAs: { ...parsed, embedInZpl: false },
        } satisfies ImageProps,
        takeComment(),
      );
    },

    // ^GS{rotation},{height},{width}: selects the internal-font
    // legal-symbol glyph (^FD picks which: A=®, B=©, C=™, D=UL, E=CSA).
    GS(p) {
      s.field.fieldType = "symbol";
      s.field.symRot = readRotation(p[0]);
      s.field.symH = dots(p[1], 30);
      s.field.symW = dots(p[2], s.field.symH);
    },

    // ── ~DY downloaded TrueType / graphic payload ──────────────────────────
    // ~DY{drive}:{name},{fmt},{ext},{size},{bpr},{data}
    // Decodes ASCII hex (format 'A') TTF/OTF bytes into the font cache
    // so the canvas can preview the embedded font without a separate
    // upload. The path reconstruction (stem + extension code) round-
    // trips the same form the generator emits. Non-TTF extensions and
    // non-hex formats are left untouched and fall through to the
    // browser-limit bucket so the user sees what was dropped.
    DY(_p, rest) {
      // Parse manually because the data segment can be hundreds of
      // KB of hex; we want to avoid splitting that into the rest of
      // the params array. Param layout up to and including bytes-per-
      // row is fixed-arity, so we walk commas until we've found 5.
      const delim = s.format.delimiterChar;
      const c: number[] = [];
      for (let i = 0; i < rest.length && c.length < 5; i++) {
        if (rest[i] === delim) c.push(i);
      }
      if (c.length < 5) {
        pushBrowserLimit(s.result, `~DY${rest}`);
        return;
      }
      const [c0, c1, c2, c3, c4] = c;
      if (
        c0 === undefined ||
        c1 === undefined ||
        c2 === undefined ||
        c3 === undefined ||
        c4 === undefined
      ) {
        pushBrowserLimit(s.result, `~DY${rest}`);
        return;
      }
      const path = rest.slice(0, c0);
      const fmt = rest.slice(c0 + 1, c1).toUpperCase();
      const extCode = rest.slice(c1 + 1, c2).toUpperCase();
      const size = parseInt(rest.slice(c2 + 1, c3), 10);
      const dyBytesPerRow = parseInt(rest.slice(c3 + 1, c4), 10);
      const data = rest.slice(c4 + 1);
      // trimEnd before slicing: a short rest ends with the line break, which
      // would land mid-token where pushBrowserLimit's trim cannot reach.
      const dySummary = `~DY${rest.trimEnd().slice(0, IMPORT_FINDING_PAYLOAD_LIMIT)}…`;

      // Graphic uploads (~DY ...,A/B/C,G,...): decode via the same payload
      // pipeline as ^GF, register the resulting image under the full
      // device:stem.GRF path. A subsequent ^XG can then instantiate it.
      if (extCode === "G" && (fmt === "A" || fmt === "B" || fmt === "C")) {
        if (!path || isNaN(dyBytesPerRow) || dyBytesPerRow <= 0) {
          pushBrowserLimit(s.result, dySummary);
          return;
        }
        const sizeStr = size > 0 ? String(size) : "";
        const dyImage = decodeGraphicToImage(
          data,
          fmt,
          dyBytesPerRow,
          sizeStr,
          sizeStr,
          `uploaded_${path.replace(/[:.]/g, "_")}.png`,
        );
        if (!dyImage) {
          pushBrowserLimit(s.result, dySummary);
          return;
        }
        if (!dyImage.crcOk) s.result.partialCmds.add("~DY");
        // Path normalisation: ~DY uses `device:stem` without extension; the
        // ^XG side resolves `device:stem.GRF`. Store the `.GRF` form so the
        // XG lookup is direct.
        const parsedDyPath = parseStoragePath(path);
        if (!parsedDyPath) {
          pushBrowserLimit(s.result, dySummary);
          return;
        }
        s.fonts.downloadedGraphics.set(formatStoragePath(parsedDyPath, true), {
          imageId: dyImage.imageId,
          widthDots: dyImage.widthDots,
          heightDots: dyImage.heightDots,
          gfaCache: dyImage.gfaCache,
        });
        return;
      }

      // Only ASCII-hex TTF/OTF imports are supported. Z64 / compressed
      // payloads need a CRC-checked decoder and stay out of scope.
      if (fmt !== "A" || (extCode !== "T" && extCode !== "B")) {
        pushBrowserLimit(s.result, dySummary);
        return;
      }
      if (!path || isNaN(size) || size <= 0 || data.length < size * 2) {
        pushBrowserLimit(s.result, dySummary);
        return;
      }
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        const byteHex = data.slice(i * 2, i * 2 + 2);
        const b = parseInt(byteHex, 16);
        if (isNaN(b)) {
          pushBrowserLimit(s.result, dySummary);
          return;
        }
        bytes[i] = b;
      }
      // Reconstruct the full filename with extension so the registered
      // name matches what ^CW points at. Generator emits "{stem}" with
      // the extension stripped, so we re-attach based on the code.
      const ext = extCode === "T" ? ".TTF" : ".BIN";
      const filename = path.includes(".")
        ? path.slice(path.lastIndexOf(":") + 1)
        : `${path.slice(path.indexOf(":") + 1)}${ext}`;
      const fullPath = path.includes(".") ? path : `${path}${ext}`;
      try {
        loadFontBytesSync(bytes, filename);
        s.fonts.downloadedFontPaths.add(fullPath);
      } catch {
        // Oversized or otherwise unloadable, surface as browser-limit.
        pushBrowserLimit(s.result, `~DY${path}`);
      }
    },
  };

  return {
    handlers,
    helpers: { commitPendingReverseBg, pushGBObject, getReverseFlag },
  };
}
