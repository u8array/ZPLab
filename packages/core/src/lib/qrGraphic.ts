import bwipjs from "bwip-js/browser";
import { gfaFromRaster, type MonoRaster } from "./imageToZpl";
import { formatSidecarComment, sidecarBody } from "./zplLabelMeta";
import { isZplRotation, type ZplRotation } from "../registry/rotation";
import { isQrByHeight } from "./qrBy";
import { isQrEcLevel, type QrEcLevel } from "./qrFd";

// ^BQ cannot rotate (firmware no-op, ZD230-verified), so a rotated QR emits as a
// ^GFA of the exact module matrix plus a ZPLLAB sidecar for lossless reimport.

export interface QrGraphicInput {
  content: string;
  magnification: number;
  errorCorrection: QrEcLevel;
  model: 1 | 2;
  rotation: ZplRotation;
  /** Pinned ^BY height, kept so a rotate-back re-emits the imported value. */
  byHeight?: number;
}

/** Single source for the QR encode settings so canvas, preflight and graphic
 *  emit can't diverge. fixedeclevel pins the level like Zebra firmware. */
export function qrBwipOptions(content: string, errorCorrection: string) {
  return {
    bcid: "qrcode",
    text: content || " ",
    eclevel: errorCorrection,
    fixedeclevel: true,
  };
}

/** Null when the content does not encode; callers fall back to plain ^BQ. */
export function qrModuleMatrix(content: string, errorCorrection: string): boolean[][] | null {
  try {
    const [sym] = bwipjs.raw(
      qrBwipOptions(content, errorCorrection) as never,
    ) as { pixx: number; pixy: number; pixs: number[] }[];
    if (!sym || sym.pixx <= 0) return null;
    const m: boolean[][] = [];
    for (let y = 0; y < sym.pixy; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < sym.pixx; x++) row.push(sym.pixs[y * sym.pixx + x] === 1);
      m.push(row);
    }
    return m;
  } catch {
    return null;
  }
}

export function rotateModules(m: boolean[][], rotation: ZplRotation): boolean[][] {
  const rot90 = (a: boolean[][]): boolean[][] => {
    const n = a.length;
    return a.map((_, r) => a.map((__, c) => a[n - 1 - c]?.[r] ?? false));
  };
  if (rotation === "R") return rot90(m);
  if (rotation === "I") return rot90(rot90(m));
  if (rotation === "B") return rot90(rot90(rot90(m)));
  return m;
}

/** Packed 1bpp raster, magnification dots per module, in imageToZpl's ^GFA shape. */
export function modulesToRaster(m: boolean[][], magnification: number): MonoRaster {
  const n = m.length;
  const widthDots = n * magnification;
  const heightDots = widthDots;
  const paddedWidth = Math.ceil(widthDots / 8) * 8;
  const bytesPerRow = paddedWidth / 8;
  const bytes = new Uint8Array(bytesPerRow * heightDots);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m[r]?.[c]) continue;
      for (let dy = 0; dy < magnification; dy++) {
        const y = r * magnification + dy;
        for (let dx = 0; dx < magnification; dx++) {
          const x = c * magnification + dx;
          const i = y * bytesPerRow + (x >> 3);
          bytes[i] = (bytes[i] ?? 0) | (0x80 >> (x & 7));
        }
      }
    }
  }
  return { bytes, bytesPerRow, paddedWidth, widthDots, heightDots };
}

/** ^GFA body for a rotated QR; null when the content does not encode. */
export function qrRotatedGfa(p: QrGraphicInput): { gfa: string; sizeDots: number } | null {
  const m = qrModuleMatrix(p.content, p.errorCorrection);
  if (!m) return null;
  const raster = modulesToRaster(rotateModules(m, p.rotation), p.magnification);
  return { gfa: gfaFromRaster(raster), sizeDots: raster.widthDots };
}

const gfaCache = new WeakMap<
  object,
  { key: string; value: { gfa: string; sizeDots: number } | null }
>();

/** Memoized on props identity plus resolved inputs: the emit reruns on every
 *  store edit and a large QR costs a full encode plus a megabyte hex join. */
export function qrRotatedGfaCached(
  propsRef: object,
  input: QrGraphicInput,
): { gfa: string; sizeDots: number } | null {
  const key = [input.content, input.magnification, input.errorCorrection, input.rotation].join("\u0000");
  const hit = gfaCache.get(propsRef);
  if (hit && hit.key === key) return hit.value;
  const value = qrRotatedGfa(input);
  gfaCache.set(propsRef, { key, value });
  return value;
}

/** ^/~ as \u escapes so the payload stays a valid ^FX comment. */
function zplSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/\^/g, "\\u005e").replace(/~/g, "\\u007e");
}

/** Carries the QR props so reimport reconstructs the object; printers ignore it. */
export function formatQrSidecarComment(p: QrGraphicInput): string {
  const body = zplSafeJson({
    qr: {
      content: p.content,
      mag: p.magnification,
      ec: p.errorCorrection,
      model: p.model,
      rot: p.rotation,
      ...(p.byHeight !== undefined ? { byh: p.byHeight } : {}),
    },
  });
  return formatSidecarComment(body);
}

/** QR props from a ^FX body; null for a foreign or corrupt comment. */
export function parseQrSidecarComment(commentBody: string): QrGraphicInput | null {
  const body = sidecarBody(commentBody);
  if (body === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const qr = (parsed as { qr?: unknown }).qr;
  if (!qr || typeof qr !== "object") return null;
  const q = qr as Record<string, unknown>;
  if (typeof q.content !== "string" || typeof q.mag !== "number") return null;
  if (!isQrEcLevel(q.ec) || typeof q.rot !== "string" || !isZplRotation(q.rot)) return null;
  return {
    ...(isQrByHeight(q.byh) ? { byHeight: q.byh } : {}),
    content: q.content,
    magnification: q.mag,
    errorCorrection: q.ec,
    model: q.model === 1 ? 1 : 2,
    rotation: q.rot,
  };
}

/** Scans the accumulated ^FX lines (a user comment can precede the sidecar).
 *  Returns the QR props and the remaining comment. */
export function extractQrSidecar(
  comment: string,
): { qr: QrGraphicInput; rest: string | undefined } | null {
  const lines = comment.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const qr = parseQrSidecarComment(lines[i] ?? "");
    if (qr) {
      const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n").trim();
      return { qr, rest: rest || undefined };
    }
  }
  return null;
}
