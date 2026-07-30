// Pure single-source-of-truth for an object's axis-aligned model-space
// bounding box in DOTS. Replaces scattered render-time Konva getClientRect
// usage so align/distribute can reason about geometry without a stage.
//
// Rotation note (verified, not guessed): the numeric `LabelObjectBase.rotation`
// is never read by any renderer (only a store default of 0). What actually
// drives rendered orientation is the per-type `props.rotation` ("N"|"R"|"I"|"B")
// for text/symbol and every barcode. box/ellipse/image carry NO rotation
// at all and their renderers never rotate the node, so their bbox is the raw
// prop footprint. line orientation lives in `props.angle`; its bbox comes from
// the two endpoints.

import type { LabelObject } from "../types/Group";
import { getAllLeaves, isGroup } from "../types/Group";
import type { LeafObject } from "../registry";
import { BARCODE_1D_TYPES, STACKED_2D_TYPES, getEntry } from "../registry";
import type { LabelConfig } from "../types/LabelConfig";
import { effectiveDpmm, type JmDensity } from "../types/LabelConfig";
import { isAxisSwapped, objectRotation, type ZplRotation } from "../registry/rotation";
import { resolveTextMode } from "../registry/text";
import { blockBoundsDots, EMPTY_TEXT_PLACEHOLDER_GLYPHS, isBlankText, rotatedLineOffset, tbBoundsDots, zebraLineWidthDots } from "./zebraTextLayout";
import { resolveDefaultSizeDots } from "./resolveDefaultSize";
import { mmToDots } from "./coordinates";
import { QR_FO_Y_OFFSET_DOTS, QR_FT_MODULE_OFFSET } from "./bwipConstants";

export interface BoundingBoxDots {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObjectBoundsCtx {
  label: LabelConfig;
  /** Measured footprints (dots) published by the render layer for types whose
   *  size isn't purely computable (barcodes, single-line text). Keyed by obj.id.
   *  The FT anchor uses uprightBar*Dots; barHeightDots is the legacy fallback. */
  measured?: ReadonlyMap<
    string,
    {
      width: number;
      height: number;
      barHeightDots?: number;
      barLeftDots?: number;
      barTopDots?: number;
      /** Upright (unrotated) bar-rect size in dots, for the rotation-aware ^FT
       *  anchor. The ^FT origin (bar base, left edge) rotates with the field. */
      uprightBarWDots?: number;
      uprightBarHDots?: number;
    }
  >;
}

/** Swap width/height for the quarter-turn rotations. Mirrors how every
 *  rotation-aware renderer derives its rotated footprint from the upright one. */
function rotatedFootprint(
  width: number,
  height: number,
  rotation: ZplRotation,
): { width: number; height: number } {
  return isAxisSwapped(rotation)
    ? { width: height, height: width }
    : { width, height };
}

/** Registry fallback footprint for a type when no measured size is published
 *  (object not yet rendered). Spec-fixed symbols carry mm; the rest carry dots. */
function fallbackSizeDots(
  obj: LeafObject,
  label: LabelConfig,
): { width: number; height: number } {
  const def = getEntry(obj.type)?.defaultSize;
  return def ? resolveDefaultSizeDots(def, label) : { width: 0, height: 0 };
}

/** Single-line text/serial footprint estimate from props when no measured
 *  size exists. Width is the Font-0 calibrated advance sum; height is the
 *  font height. Rotation swaps the axes. Empty content takes the canvas
 *  placeholder's footprint, else the selection chrome (action bar, align,
 *  snap) would center on a zero-width box left of what is drawn. */
function singleLineEstimate(
  obj: LeafObject & { props: { content: string; fontHeight: number; fontWidth: number; rotation: ZplRotation } },
): { width: number; height: number } {
  const { content, fontHeight, fontWidth, rotation } = obj.props;
  const width = isBlankText(content)
    ? fontHeight * EMPTY_TEXT_PLACEHOLDER_GLYPHS
    : zebraLineWidthDots(content, fontHeight, fontWidth);
  return rotatedFootprint(width, fontHeight, rotation);
}

/** True when a QR emits as a rotated ^GFA (no ^BQ firmware shifts, plain
 *  bottom-left anchor) rather than a ^BQ barcode. */
export function qrPrintsAsGraphic(obj: { type: string; props: object }): boolean {
  return obj.type === "qrcode" && objectRotation(obj.props) !== "N";
}

/** Visual-top-left offset of a ^FT barcode from its typeset anchor (bar base,
 *  left edge), per rotation, using the upright bar-rect size. The ^FT anchor
 *  rotates with the field, so R/I/B differ from N. Mirrors the verified ^FO
 *  render path; derived to match Labelary (verify there when touching). */
export function barcodeFtAnchorOffset(
  rotation: ZplRotation,
  uprightBarW: number,
  uprightBarH: number,
): { x: number; y: number } {
  switch (rotation) {
    case "R": return { x: 0, y: 0 };
    case "I": return { x: -uprightBarW, y: 0 };
    case "B": return { x: -uprightBarH, y: -uprightBarW };
    case "N":
    default: return { x: 0, y: -uprightBarH };
  }
}

/** Visual bbox top-left for a barcode: the ^FT typeset anchor shifted by the
 *  rotation-aware offset, or ^FO at the field origin (QR adds its firmware Y
 *  artifacts). barLeft/barTop mirror the render's HRI-zone shift. Uses the same
 *  barcodeFtAnchorOffset path as BarcodeObject so render and bounds agree even
 *  before the renderer publishes the upright dims (width 0 then, like render). */
function barcodeTopLeft(
  obj: LeafObject,
  fallbackHeight: number,
  fallbackWidth: number,
  measured:
    | {
        barHeightDots?: number;
        barLeftDots?: number;
        barTopDots?: number;
        uprightBarWDots?: number;
        uprightBarHDots?: number;
      }
    | undefined,
): { x: number; y: number } {
  const barLeft = measured?.barLeftDots ?? 0;
  const barTop = measured?.barTopDots ?? 0;
  if (obj.positionType === "FT") {
    const upH =
      measured?.uprightBarHDots ??
      measured?.barHeightDots ??
      (BARCODE_1D_TYPES.has(obj.type)
        ? (obj.props as { height?: number }).height ?? fallbackHeight
        : 0);
    // Pre-publish (no measured dims) the width-dependent I/B anchors fall back to
    // the same footprint width the bbox uses, so the returned box stays self-
    // consistent (else x is offset as if width 0 while width = the fallback).
    const graphicQr = qrPrintsAsGraphic(obj);
    const off = barcodeFtAnchorOffset(
      graphicQr ? "N" : objectRotation(obj.props),
      measured?.uprightBarWDots ?? fallbackWidth,
      upH,
    );
    const qrShift =
      obj.type === "qrcode" && !graphicQr
        ? QR_FT_MODULE_OFFSET * (obj.props as { magnification: number }).magnification
        : 0;
    return { x: obj.x + off.x - barLeft, y: obj.y + off.y - qrShift - barTop };
  }
  if (obj.type === "qrcode" && !qrPrintsAsGraphic(obj)) {
    return { x: obj.x - barLeft, y: obj.y + QR_FO_Y_OFFSET_DOTS - barTop };
  }
  return { x: obj.x - barLeft, y: obj.y - barTop };
}

// All barcode types route through the measured cache. Composed from the registry
// sets so adding a symbology there can't silently leave it on the unknown fallback.
const BARCODE_TYPES = new Set<string>([
  ...BARCODE_1D_TYPES,
  ...STACKED_2D_TYPES,
  "tlc39",
  "qrcode",
  "datamatrix",
  "aztec",
  "maxicode",
]);
export function isBarcode(obj: { type: string }): boolean {
  return BARCODE_TYPES.has(obj.type);
}

/** True when objectBoundsDots estimates this leaf headlessly: barcode registry
 *  footprint, single-line-text font estimate, image-without-heightDots square
 *  guess. Everything else, and any leaf with a `measured` footprint (render
 *  read-back), is exact. */
export function boundsAreApprox(
  obj: LabelObject,
  measured?: ObjectBoundsCtx["measured"],
): boolean {
  if (measured?.has(obj.id)) return false;
  if (isBarcode(obj)) return true;
  if (obj.type === "image") return obj.props.heightDots === undefined;
  if (obj.type !== "text") return false;
  const p = obj.props;
  return !(resolveTextMode(p) !== "normal" && !!p.blockWidth && p.blockWidth > 0);
}

/** Axis-aligned model-space bbox (dots) for one object. Always the VISUAL
 *  top-left regardless of FO/FT, so align/distribute can use min/max edges. */
export function objectBoundsDots(obj: LabelObject, ctx: ObjectBoundsCtx): BoundingBoxDots {
  if (isGroup(obj)) return groupBounds(obj, ctx);

  switch (obj.type) {
    case "box":
    case "ellipse": {
      const p = obj.props;
      return { x: obj.x, y: obj.y, width: p.width, height: p.height };
    }
    case "image": {
      const p = obj.props;
      // Cached PNGs derive height from aspect at render, so consult the measured
      // cache first (already the rotated footprint the renderer published). The
      // fallback rotates the upright prop dims itself for R/B.
      const m = ctx.measured?.get(obj.id);
      if (m) return { x: obj.x, y: obj.y, width: m.width, height: m.height };
      // storedAs/rawGf stay upright (rot='N'), so their fallback footprint isn't
      // swapped. (Pure path: no cache check, but a no-cache image is empty and
      // inconsequential.)
      const rot = p.storedAs || p.rawGf ? "N" : objectRotation(p);
      const fp = rotatedFootprint(p.widthDots, p.heightDots ?? p.widthDots, rot);
      return { x: obj.x, y: obj.y, width: fp.width, height: fp.height };
    }
    case "line":
      return lineBounds(obj);
    case "symbol": {
      // Zebra rotates only the glyph; the symbol bbox stays at (w, h).
      const p = obj.props;
      return { x: obj.x, y: obj.y, width: p.width, height: p.height };
    }
    case "text": {
      const p = obj.props;
      // Single source for the mode decision: a serial field resolves to 'normal'
      // (its block props lie dormant), so it takes the single-line path instead
      // of computing block bounds from a stale blockWidth.
      const mode = resolveTextMode(p);
      if (mode !== "normal" && p.blockWidth && p.blockWidth > 0) {
        // ^TB extent is width x clip-height; ^FB stacks blockLines rows.
        const b =
          mode === "tb"
            ? tbBoundsDots(p.blockWidth, p.blockHeight ?? p.fontHeight, p.rotation)
            : blockBoundsDots({
                blockWidthDots: p.blockWidth,
                blockLines: p.blockLines ?? 1,
                blockLineSpacing: p.blockLineSpacing ?? 0,
                fontHeight: p.fontHeight,
                rotation: p.rotation,
              });
        // bounds are field-anchor-relative (can be negative for R/I/B);
        // shift into absolute model space.
        return { x: obj.x + b.x, y: obj.y + b.y, width: b.width, height: b.height };
      }
      // Measured is the already-rotated footprint (the producer rotates it); the
      // fallback estimate computes upright and rotates itself.
      const fp = ctx.measured?.get(obj.id) ?? singleLineEstimate(obj);
      const off = rotatedLineOffset(p.rotation, fp.width, fp.height);
      return { x: obj.x + off.x, y: obj.y + off.y, width: fp.width, height: fp.height };
    }
    default: {
      if (isBarcode(obj)) {
        const m = ctx.measured?.get(obj.id);
        // The fallback is the upright registry footprint; rotate it so a rotated
        // barcode's bbox swaps axes like the measured (already-rotated) path and
        // like singleLineEstimate. barcodeTopLeft keeps the upright dims (its FT
        // anchor math is upright-relative), only the returned bbox is rotated.
        const up = m ?? fallbackSizeDots(obj, ctx.label);
        const fp = m ?? rotatedFootprint(up.width, up.height, objectRotation(obj.props));
        const { x, y } = barcodeTopLeft(obj, up.height, up.width, m);
        return { x, y, width: fp.width, height: fp.height };
      }
      // Unknown leaf: fall back to its registry footprint at the origin.
      const fp = fallbackSizeDots(obj, ctx.label);
      return { x: obj.x, y: obj.y, width: fp.width, height: fp.height };
    }
  }
}

/** Optical line bbox (the rendered band, not just the endpoints). Mirrors the
 *  LineObject render: x2 = x + len*cos, y2 = y + len*sin in dot space. */
function lineBounds(obj: LeafObject & { type: "line" }): BoundingBoxDots {
  const { angle, length, thickness } = obj.props;
  const rad = (angle * Math.PI) / 180;
  const x2 = obj.x + length * Math.cos(rad);
  const y2 = obj.y + length * Math.sin(rad);
  const dx = Math.abs(x2 - obj.x);
  const dy = Math.abs(y2 - obj.y);
  const minX = Math.min(obj.x, x2);
  const minY = Math.min(obj.y, y2);
  // Axis-aligned emits ^GB (plain band): thickness fills the thin axis.
  if (dx < 0.5 || dy < 0.5) {
    return { x: minX, y: minY, width: Math.max(dx, thickness), height: Math.max(dy, thickness) };
  }
  // Diagonal emits ^GD, which shears the band horizontally by thickness (see
  // diagonalPolygonPoints): the optical box is (w + t) wide, h tall.
  return { x: minX, y: minY, width: dx + thickness, height: dy };
}

/** Union of every leaf descendant. Group children are absolute-coordinated,
 *  so each leaf's own bbox already lands in model space. */
function groupBounds(obj: LabelObject, ctx: ObjectBoundsCtx): BoundingBoxDots {
  const leaves = isGroup(obj) ? getAllLeaves(obj.children) : [];
  const union = unionOf(leaves.map((l) => objectBoundsDots(l, ctx)));
  return union ?? { x: obj.x, y: obj.y, width: 0, height: 0 };
}

function unionOf(boxes: BoundingBoxDots[]): BoundingBoxDots | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Union bbox of a selection. A group id resolves to one bbox via its own
 *  objectBoundsDots. Returns null for an empty selection or no matches. */
export function selectionUnionDots(
  objects: LabelObject[],
  ids: readonly string[],
  ctx: ObjectBoundsCtx,
): BoundingBoxDots | null {
  const byId = new Map<string, LabelObject>();
  const index = (nodes: LabelObject[]) => {
    for (const n of nodes) {
      byId.set(n.id, n);
      if (isGroup(n)) index(n.children);
    }
  };
  index(objects);
  const boxes: BoundingBoxDots[] = [];
  for (const id of ids) {
    const node = byId.get(id);
    if (node) boxes.push(objectBoundsDots(node, ctx));
  }
  return unionOf(boxes);
}

/** Printable-area rect (dots) in object space. ^LS shifts content LEFT by
 *  labelShift (ZPL spec + Labelary-verified): a field at model x prints at
 *  x-labelShift, so the visible model window is [labelShift, labelShift+width].
 *  Single source for the drag-snap boundary and the out-of-bounds check. */
export function printableRectDots(label: {
  widthMm: number;
  heightMm: number;
  dpmm: number;
  jmDensity?: JmDensity;
  labelShift?: number;
}): BoundingBoxDots {
  const shift = label.labelShift ?? 0;
  return {
    x: shift,
    y: 0,
    width: mmToDots(label.widthMm, effectiveDpmm(label)),
    height: mmToDots(label.heightMm, effectiveDpmm(label)),
  };
}

/** Half-dot tolerance for the off-label edge checks so an object resting exactly
 *  on an edge isn't flagged. */
const EDGE_EPS = 0.5;

export type OffLabel = "clipped" | "outside";

/** Off-label placement of a field vs the printable rect, or null when inside.
 *  Asymmetric on purpose, and the two edges read DIFFERENT inputs:
 *  - near edges (left/top) test the emitted ^FO/^FT `anchor` (see
 *    emittedAnchorDots). A negative origin is off the printable area on the home
 *    side / out of ZPL's coordinate range, so nothing prints -> `outside`. Using
 *    the anchor (not the bbox) is what lets a field with a valid positive origin
 *    whose rotated/sized body extends back over the near edge stay un-flagged,
 *    matching what the printer renders.
 *  - far edges (right/bottom) test the visual `box`: content past ^PW/^LL is
 *    clipped (part still prints), or fully past = nothing prints -> `outside`. */
export function offLabelPlacement(
  anchor: { x: number; y: number },
  box: BoundingBoxDots,
  label: Parameters<typeof printableRectDots>[0],
): OffLabel | null {
  const r = printableRectDots(label);
  if (anchor.x < r.x - EDGE_EPS || anchor.y < r.y - EDGE_EPS) return "outside";
  const overRight = box.x + box.width > r.x + r.width + EDGE_EPS;
  const overBottom = box.y + box.height > r.y + r.height + EDGE_EPS;
  if (!overRight && !overBottom) return null;
  const onLabel = box.x < r.x + r.width - EDGE_EPS && box.y < r.y + r.height - EDGE_EPS;
  return onLabel ? "clipped" : "outside";
}
