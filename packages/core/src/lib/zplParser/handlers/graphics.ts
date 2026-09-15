import type { BoxProps } from "../../../registry/box";
import type { EllipseProps } from "../../../registry/ellipse";
import { clampMagnification, type ImageProps } from "../../../registry/image";
import type { LineProps } from "../../../registry/line";
import { loadFontBytesSync } from "../../fontCache";
import { parseStoragePath, recallCandidates, storageKey, uploadedGraphicPath, type StoragePath } from "../../storagePath";
import { notePartial, getPosType, noteFieldInk, payloadSummary, pushBrowserLimit, REGEN_LOSSY_REASONS, type ParserState, type PendingReverseBg } from "../context";
import type { LabelObject } from "../../../types/Group";
import { decodeGraphicToImage } from "../decoders/graphic";
import { preserveGfData } from "../decoders/gfa";
import { extractQrSidecar } from "../../qrGraphic";
import type { QrCodeProps } from "../../../registry/qrcode";
import { dotsFor, ftTopLeft, int, makeObj, readColor, readRotation } from "../helpers";
import type { Handler } from "../types";

import { newId } from "../../ids";
/** Helpers re-exported to parseZPL so the field flush can commit a stashed
 *  reverse-bg box just before the field that follows it. */
export interface GraphicsExports {
  commitPendingReverseBg: () => void;
  /** ^LR | ^FR; returns `undefined` (not `false`) when off. */
  getReverseFlag: () => boolean | undefined;
}

export interface GraphicsFamily {
  handlers: Record<string, Handler>;
  helpers: GraphicsExports;
}

/** Graphic primitives (^GB/^GC/^GD/^GE/^GF/^GS), stored graphics (^XG/^IM/^IL/~DY/~DG) + reverse-bg commit. */
export interface GraphicsHelpers {
  takeComment: () => string | undefined;
  /** The stash's box just pushed: the one place that knows which bytes it came from. */
  onReverseBgCommitted: (bg: PendingReverseBg, box: LabelObject) => void;
  /** An object placed by its own command outside any field, so it owns that token's bytes. */
  onStandaloneObject: (obj: LabelObject) => void;
  /** A graphic upload registered under `key`; its token bytes become an upload segment. */
  onUpload: (key: string, short: boolean) => void;
}

export function createGraphicsHandlers(s: ParserState, helpers: GraphicsHelpers): GraphicsFamily {
  const { takeComment, onReverseBgCommitted, onStandaloneObject, onUpload } = helpers;
  const getReverseFlag = () => s.label.lrActive || s.field.frActive || undefined;
  const { dots } = dotsFor(s);

  const pushGBObject = (
    gx: number, gy: number, w: number, h: number, t: number,
    color: "B" | "W", rounding: number, reverseFlag: boolean | undefined,
    comment: string | undefined, positionType: "FO" | "FT", justify: "L" | "R",
  ): LabelObject => {
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
    return obj;
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

  /** Places the recall at the field position, or at `origin` for ^IL; true when an upload in the stream backed it. */
  const recallStoredGraphic = (
    code: "^XG" | "^IM" | "^IL",
    parsed: StoragePath,
    origin?: { x: number; y: number },
    magnify?: { x: number; y: number },
  ): boolean => {
    commitPendingReverseBg();
    const place = (w: number, h: number, props: ImageProps) => {
      if (!origin) {
        pushGraphic("image", w, h, props, takeComment());
        return;
      }
      const obj = makeObj("image", origin.x, origin.y, props, "FO", takeComment());
      s.result.objects.push(obj);
      if (s.field.openedAt === null) onStandaloneObject(obj);
    };
    // ^IL moves as ^IM, which shares its extension range.
    const source = code === "^XG" ? { ...(magnify ? { magnify } : {}) } : { recall: "IM" as const };
    // Looked up as named, so a .PNG recall stays unresolved rather than guessed.
    const uploaded = recallCandidates(parsed).map((key) => s.fonts.downloadedGraphics.get(key)).find(Boolean);
    if (uploaded) {
      place(uploaded.widthDots, uploaded.heightDots, {
        imageId: uploaded.imageId,
        widthDots: uploaded.widthDots,
        heightDots: uploaded.heightDots,
        threshold: 128,
        _gfaCache: uploaded.gfaCache,
        storedAs: { ...parsed, ...source, embedInZpl: true },
      });
      return true;
    }
    // Recall-only: embedInZpl=false keeps the reference without inventing bytes, and the placeholder square doubles as the ^FT footprint.
    notePartial(s.result, code);
    place(200, 200, {
      imageId: "",
      widthDots: 200,
      threshold: 128,
      storedAs: { ...parsed, ...source, embedInZpl: false },
    });
    return false;
  };

  /** The recall's path, or null after pushing a browserLimit for a missing name. */
  const parseRecallPath = (rest: string, raw: string, defaultDevice?: string): StoragePath | null => {
    const parsed = parseStoragePath(raw, defaultDevice);
    if (!parsed) {
      noteFieldInk(s);
      pushBrowserLimit(s.result, `${s.result.tokenCommand}${rest}`);
    }
    return parsed;
  };

  const registerGraphicUpload = (
    code: "~DY" | "~DG",
    path: string,
    fmt: "A" | "B" | "C",
    size: number,
    bytesPerRow: number,
    data: string,
    summary: string,
  ) => {
    const parsed = parseStoragePath(path, "R");
    // Both counts are mandatory on the device: without them the download is ignored.
    if (!parsed || !(bytesPerRow > 0) || !(size > 0)) {
      pushBrowserLimit(s.result, summary);
      return;
    }
    // Text payloads drag the stream terminator along; a counted binary one ends where the tokenizer cut it.
    const image = decodeGraphicToImage(
      fmt === "B" ? data : data.trimEnd(),
      fmt,
      bytesPerRow,
      String(size),
      String(size),
      `uploaded_${path.replace(/[:.]/g, "_")}.png`,
    );
    if (!image) {
      pushBrowserLimit(s.result, summary);
      return;
    }
    if (!image.crcOk) notePartial(s.result, code, "checksumMismatch");
    if (image.truncated) notePartial(s.result, code, "shortPayload");
    const key = uploadedGraphicPath(parsed);
    onUpload(key, image.truncated);
    s.fonts.downloadedGraphics.set(key, {
      imageId: image.imageId,
      widthDots: image.widthDots,
      heightDots: image.heightDots,
      gfaCache: image.gfaCache,
    });
  };

  const commitPendingReverseBg = () => {
    if (!s.reverseBg) return;
    const bg = s.reverseBg;
    s.reverseBg = null;
    // A stash inherited from the previous field is not this field's content.
    if (bg === s.field.bgAtOpen) s.field.objBase++;
    s.reverseBgCommits++;
    const box = pushGBObject(bg.x, bg.y, bg.w, bg.h, bg.t, bg.color, bg.rounding, bg.reverseFlag, bg.comment, bg.positionType ?? "FO", bg.justify ?? "L");
    onReverseBgCommitted(bg, box);
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
      const gfSummary = payloadSummary(s.result.tokenCommand, rest);
      // ^GF{A|B|C},{totalBytes},{totalBytes},{bytesPerRow},{payload}
      const format = rest[0]?.toUpperCase();
      if (format !== "A" && format !== "B" && format !== "C") {
        noteFieldInk(s);
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
        noteFieldInk(s);
        pushBrowserLimit(s.result, gfSummary);
        return;
      }

      const gfParams = gfRest.slice(0, commaPos).split(delim);
      const gfBytesPerRow = int(gfParams[2], 0);
      // Everything after the 3rd comma is the (possibly compressed) graphic data
      const gfRawData = gfRest.slice(commaPos + 1);

      if (gfBytesPerRow <= 0) {
        noteFieldInk(s);
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
        notePartial(s.result, "^GF");
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
      if (!gfImage.crcOk) notePartial(s.result, "^GF", "checksumMismatch");
      if (gfImage.truncated) {
        notePartial(s.result, "^GF", "shortPayload");
        // Replayed as written, the short field would swallow its neighbour.
        s.fdRegenLossy ??= REGEN_LOSSY_REASONS.shortGraphic;
      }
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
            ...(qr.byHeight !== undefined ? { byHeight: qr.byHeight } : {}),
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
    // ^XGd:o.x,mx,my references a graphic uploaded earlier via ~DY or ~DG.
    XG(p, rest) {
      const parsed = parseRecallPath(rest, p[0] ?? "");
      if (!parsed) return;
      const factor = (raw: string | undefined) => clampMagnification(int(raw, 1));
      const magnify = { x: factor(p[1]), y: factor(p[2]) };
      const magnified = [p[1], p[2]].some((raw) => raw !== undefined && raw !== "" && raw !== "1");
      const scaled = magnify.x !== 1 || magnify.y !== 1;
      const resolved = recallStoredGraphic("^XG", parsed, undefined, scaled ? magnify : undefined);
      if (resolved && magnified) notePartial(s.result, "^XG", "recallMagnification");
    },
    // ^IMd:o.x is ^XG without the magnification slots.
    IM(p, rest) {
      const parsed = parseRecallPath(rest, p[0] ?? "");
      if (parsed) recallStoredGraphic("^IM", parsed);
    },
    // ^ILd:o.x merges a saved format at ^FO0,0 without a field of its own (spec p.247, p.183-184);
    // it defaults to R: where ^XG/^IM search the devices.
    IL(p, rest) {
      const parsed = parseRecallPath(rest, p[0] ?? "", "R");
      if (parsed) recallStoredGraphic("^IL", parsed, { x: s.label.lhX, y: s.label.lhY + s.label.ltY });
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
    // Hex-decoded into the font cache so the canvas previews an embedded font without a separate upload.
    DY(_p, rest) {
      // Parsed by hand: the data segment can be hundreds of KB, too big to split into the params array.
      const dySummary = payloadSummary(s.result.tokenCommand, rest);
      const delim = s.format.delimiterChar;
      const c: number[] = [];
      for (let i = 0; i < rest.length && c.length < 5; i++) {
        if (rest[i] === delim) c.push(i);
      }
      const [c0, c1, c2, c3, c4] = c;
      if (
        c0 === undefined ||
        c1 === undefined ||
        c2 === undefined ||
        c3 === undefined ||
        c4 === undefined
      ) {
        pushBrowserLimit(s.result, dySummary);
        return;
      }
      const path = rest.slice(0, c0);
      const fmt = rest.slice(c0 + 1, c1).toUpperCase();
      const extCode = rest.slice(c1 + 1, c2).toUpperCase();
      const size = parseInt(rest.slice(c2 + 1, c3), 10);
      const dyBytesPerRow = parseInt(rest.slice(c3 + 1, c4), 10);
      const data = rest.slice(c4 + 1);

      if (extCode === "G" && (fmt === "A" || fmt === "B" || fmt === "C")) {
        registerGraphicUpload("~DY", path, fmt, size, dyBytesPerRow, data, dySummary);
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
      // The generator emits the stem without the extension, so ^CW lookups need it re-attached.
      const ext = extCode === "T" ? ".TTF" : ".BIN";
      const filename = path.includes(".")
        ? path.slice(path.lastIndexOf(":") + 1)
        : `${path.slice(path.indexOf(":") + 1)}${ext}`;
      const fullPath = path.includes(".") ? path : `${path}${ext}`;
      try {
        loadFontBytesSync(bytes, filename);
        s.fonts.downloadedFontPaths.add(storageKey(fullPath));
      } catch {
        pushBrowserLimit(s.result, `${s.result.tokenCommand}${path}`);
      }
    },

    // ~DGd:o.x,t,w,data: ASCII-hex twin of ~DY,A,G with the same total-bytes and bytes-per-row header.
    DG(_p, rest) {
      const delim = s.format.delimiterChar;
      const c: number[] = [];
      for (let i = 0; i < rest.length && c.length < 3; i++) {
        if (rest[i] === delim) c.push(i);
      }
      const [c0, c1, c2] = c;
      const dgSummary = payloadSummary(s.result.tokenCommand, rest);
      if (c0 === undefined || c1 === undefined || c2 === undefined) {
        pushBrowserLimit(s.result, dgSummary);
        return;
      }
      const size = parseInt(rest.slice(c0 + 1, c1), 10);
      const bytesPerRow = parseInt(rest.slice(c1 + 1, c2), 10);
      registerGraphicUpload("~DG", rest.slice(0, c0), "A", size, bytesPerRow, rest.slice(c2 + 1), dgSummary);
    },
  };

  return {
    handlers,
    helpers: { commitPendingReverseBg, getReverseFlag },
  };
}
