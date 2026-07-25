import { getTextRenderMetrics, computeTextRenderMetrics } from "./labelGeometry/textRenderMetrics";
import { rotatedLineOffset } from "./zebraTextLayout";
import { isAxisSwapped } from "../registry/rotation";
import { resolveTextMode, type TextProps } from "../registry/text";
import type { BoxProps } from "../registry/box";
import type { LineProps } from "../registry/line";
import type { LabelConfig } from "../types/LabelConfig";
import type { LabelObject } from "../types/Group";
import { isGroup } from "../types/Group";

import { newId } from "./ids";
type FontLabel = Pick<LabelConfig, "customFonts" | "defaultFontId">;

/** Minimal text shape the geometry needs; works on typed and migrated data. */
interface TextLike {
  type: "text";
  x: number;
  y: number;
  props: TextProps;
  /** Visibility/export/lock flags the backing box inherits so a hidden or
   *  non-exported reverse text doesn't gain a visible, exported box. */
  visible?: boolean;
  includeInExport?: boolean;
  locked?: boolean;
}

/** True when a (possibly unvalidated) text has the fields the geometry needs,
 *  so the migration over raw json can skip a malformed entry instead of
 *  throwing on it. */
function canBuildBackingBox(props: unknown): props is TextProps {
  const p = props as Partial<TextProps> | null | undefined;
  return (
    !!p &&
    typeof p.content === "string" &&
    typeof p.fontHeight === "number" &&
    Number.isFinite(p.fontHeight) &&
    p.fontHeight > 0
  );
}

/** A finite number, or undefined for anything else (null, NaN, string). */
function finiteOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Geometry of the black background a reverse text needs to print white-on-black.
 *  Reproduces the legacy self-bg `^GB` (ink-sized, on the text's rotated model
 *  footprint). `label` resolves device/custom/default fonts so the box matches
 *  the canvas text width; omit it for a pure PrintLab measurement. Shared by the
 *  legacy reverse->box migration and the panel add-background action. */
export function reverseBackingBoxGeometry(
  text: TextLike,
  label?: FontLabel,
): { x: number; y: number; props: BoxProps } {
  const p = text.props;
  const mode = resolveTextMode(p);
  // Label-based metrics resolve device/custom/default fonts to match the canvas.
  // Migration runs on unvalidated json, where a malformed `label.customFonts`
  // would make font resolution throw; fall back to a label-independent measure
  // so migration degrades to best-effort instead of crashing.
  let inkWidthDots: number;
  try {
    inkWidthDots =
      getTextRenderMetrics(text as unknown as LabelObject, undefined, label)?.inkWidthDots ?? 0;
    if (!inkWidthDots) {
      inkWidthDots = computeTextRenderMetrics({
        content: p.content,
        fontHeight: p.fontHeight,
        fontWidth: p.fontWidth ?? 0,
        printerFontName: p.printerFontName,
      }).inkWidthDots;
    }
  } catch {
    inkWidthDots = 0;
  }
  const inkW = Math.max(1, Math.round(inkWidthDots || p.fontWidth || p.fontHeight));
  // Block props may be non-numeric on unvalidated migration json; treat any
  // non-finite value as absent so the ink-sized fallbacks apply instead of NaN.
  const blockWidth = finiteOrUndefined(p.blockWidth);
  const blockHeight = finiteOrUndefined(p.blockHeight);
  const blockLines = finiteOrUndefined(p.blockLines);
  const blockSpacing = finiteOrUndefined(p.blockLineSpacing) ?? 0;
  const vertical = isAxisSwapped(p.rotation);
  let baseW: number;
  let baseH: number;
  if (mode === "tb") {
    baseW = blockWidth ?? inkW;
    baseH = blockHeight ?? p.fontHeight;
  } else if (mode === "fb") {
    const lines = blockLines ?? 1;
    baseW = blockWidth ?? inkW;
    baseH = p.fontHeight * lines + blockSpacing * Math.max(0, lines - 1);
  } else {
    baseW = inkW;
    baseH = p.fontHeight;
  }
  const width = vertical ? baseH : baseW;
  const height = vertical ? baseW : baseH;
  const off = rotatedLineOffset(p.rotation, width, height);
  return {
    x: Math.round(text.x + off.x),
    y: Math.round(text.y + off.y),
    props: {
      width,
      height,
      thickness: Math.min(width, height),
      filled: true,
      color: "B",
      rounding: 0,
    },
  };
}

/** Build a full backing leaf (fresh id) sitting behind the given text,
 *  inheriting its visibility/export/lock. A filled `^GB` is canonically a line
 *  when one side equals the thickness, so emit the same `box`/`line` type the
 *  parser would, keeping the object type stable across an export/reimport. */
export function makeReverseBackingBox(
  text: TextLike,
  label?: FontLabel,
): LabelObject {
  const geo = reverseBackingBoxGeometry(text, label);
  const { width, height, thickness } = geo.props;
  const base: Record<string, unknown> = {
    id: newId(),
    x: geo.x,
    y: geo.y,
    rotation: 0,
    positionType: "FO",
  };
  if (text.visible !== undefined) base.visible = text.visible;
  if (text.includeInExport !== undefined) base.includeInExport = text.includeInExport;
  if (text.locked !== undefined) base.locked = text.locked;

  if (height === thickness && width > thickness) {
    base.type = "line";
    base.props = { angle: 0, length: width, thickness, color: "B" } satisfies LineProps;
  } else if (width === thickness && height > thickness) {
    base.type = "line";
    base.props = { angle: 90, length: height, thickness, color: "B" } satisfies LineProps;
  } else {
    base.type = "box";
    base.props = geo.props;
  }
  return base as unknown as LabelObject;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned footprint a backing would need to cover for this text. */
function expectedBackingFootprint(text: TextLike, label?: FontLabel): Rect {
  const geo = reverseBackingBoxGeometry(text, label);
  return { x: geo.x, y: geo.y, width: geo.props.width, height: geo.props.height };
}

/** Footprint of a candidate black backing shape (filled black box, or black
 *  horizontal/vertical line), or null when the object can't act as a backing. */
function candidateBackingFootprint(o: LabelObject): Rect | null {
  const p = (o as { props?: Record<string, unknown> }).props;
  if (!p || p.color !== "B") return null;
  if (o.type === "box") {
    return p.filled === true
      ? { x: o.x, y: o.y, width: Number(p.width), height: Number(p.height) }
      : null;
  }
  if (o.type === "line") {
    const len = Number(p.length);
    const th = Number(p.thickness);
    const angle = Number(p.angle);
    if (angle === 0) return { x: o.x, y: o.y, width: len, height: th };
    if (angle === 90) return { x: o.x, y: o.y, width: th, height: len };
    return null; // diagonal line never backs text
  }
  return null;
}

/** Fraction of `target` covered by `cover` (0..1). */
function coverage(target: Rect, cover: Rect): number {
  const ix = Math.max(0, Math.min(target.x + target.width, cover.x + cover.width) - Math.max(target.x, cover.x));
  const iy = Math.max(0, Math.min(target.y + target.height, cover.y + cover.height) - Math.max(target.y, cover.y));
  const area = target.width * target.height;
  return area > 0 ? (ix * iy) / area : 0;
}

/** Min fraction of the text footprint a black shape must cover to count as an
 *  existing knockout background. Near-full: a half-covering shape must NOT
 *  suppress the migration, or a legacy full white-on-black field would degrade
 *  to a partial knockout. A wider banner that fully covers still qualifies. */
const BACKING_COVERAGE_MIN = 0.9;

/** True when `candidate` is a black shape that already covers this text's
 *  footprint (so the reverse knockout would print white-on-black against it).
 *  Used to decide whether the migration/add still needs to supply a background;
 *  a thin separator or off-area black shape does not qualify. */
export function isReverseBackingFor(
  candidate: LabelObject | undefined,
  text: TextLike,
  label?: FontLabel,
): boolean {
  if (!candidate) return false;
  const cf = candidateBackingFootprint(candidate);
  if (!cf) return false;
  return coverage(expectedBackingFootprint(text, label), cf) >= BACKING_COVERAGE_MIN;
}

/** True when `candidate` is sized and placed like the per-text backing this
 *  feature creates (footprint ~= the text's own), as opposed to a larger shared
 *  banner/header that merely covers it. Drives the remove flow so it only
 *  targets a feature-style backing and never deletes a deliberate layout shape. */
export function isOwnReverseBacking(
  candidate: LabelObject | undefined,
  text: TextLike,
  label?: FontLabel,
): boolean {
  if (!candidate) return false;
  const cf = candidateBackingFootprint(candidate);
  if (!cf) return false;
  const ef = expectedBackingFootprint(text, label);
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(4, b * 0.05);
  return (
    Math.abs(cf.x - ef.x) <= 4 &&
    Math.abs(cf.y - ef.y) <= 4 &&
    near(cf.width, ef.width) &&
    near(cf.height, ef.height)
  );
}

/** True when any sibling before `index` is a black shape covering the text's
 *  footprint, so it already backs the reverse text. Scans all preceding siblings
 *  (z-order: anything earlier sits behind), not just the immediate one, so an
 *  unrelated object between the box and the text doesn't hide the backing. */
export function precedingBackingExists(
  objects: readonly LabelObject[],
  index: number,
  text: TextLike,
  label?: FontLabel,
): boolean {
  for (let j = index - 1; j >= 0; j--) {
    if (isReverseBackingFor(objects[j], text, label)) return true;
  }
  return false;
}

/** True when a page has at least one reverse text that the migration would give
 *  a new backing (i.e. none covering it already). The migration uses this to
 *  invalidate that page's overlay, since inserting a model object the overlay
 *  doesn't know about would otherwise silently force a full regeneration. */
export function pageNeedsReverseBacking(
  objects: readonly LabelObject[],
  label?: FontLabel,
): boolean {
  return objects.some((o, i) => {
    if (!o || typeof o !== "object") return false;
    if (isGroup(o) && Array.isArray(o.children)) {
      return pageNeedsReverseBacking(o.children, label);
    }
    const props = (o as { props?: unknown }).props;
    return (
      o.type === "text" &&
      (props as { reverse?: boolean } | undefined)?.reverse === true &&
      canBuildBackingBox(props) &&
      !precedingBackingExists(objects, i, o as unknown as TextLike, label)
    );
  });
}

/** Migration: insert a black backing object before every reverse text so legacy
 *  self-bg reverse designs keep their white-on-black look under the knockout
 *  model. Skips a text that already has a covering black backing right behind it
 *  (manual legacy background), so it isn't doubled. Recurses into groups. */
export function insertReverseBackingBoxes(
  objects: LabelObject[],
  label?: FontLabel,
): LabelObject[] {
  const out: LabelObject[] = [];
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    // This also runs on pre-validation file json: pass any malformed entry
    // (null/primitive, or a group missing `children`) through untouched so the
    // schema still rejects it instead of crashing here.
    if (!o || typeof o !== "object") {
      out.push(o as unknown as LabelObject);
      continue;
    }
    if (isGroup(o) && Array.isArray(o.children)) {
      out.push({ ...o, children: insertReverseBackingBoxes(o.children, label) });
      continue;
    }
    const props = (o as { props?: unknown }).props;
    if (
      o.type === "text" &&
      (props as { reverse?: boolean } | undefined)?.reverse &&
      canBuildBackingBox(props) &&
      !precedingBackingExists(objects, i, o as unknown as TextLike, label)
    ) {
      out.push(makeReverseBackingBox(o as unknown as TextLike, label));
    }
    out.push(o);
  }
  return out;
}

/** Whether the text already has a covering black backing right behind it,
 *  anywhere in the tree. Drives the add-background button so it doesn't offer a
 *  duplicate. */
export function reverseTextHasBacking(
  objects: readonly LabelObject[],
  textId: string,
  label?: FontLabel,
): boolean {
  const i = objects.findIndex((o) => o?.id === textId);
  if (i >= 0) {
    const text = objects[i];
    if (!text || text.type !== "text") return false;
    return precedingBackingExists(objects, i, text as unknown as TextLike, label);
  }
  return objects.some(
    (o) => o && isGroup(o) && reverseTextHasBacking(o.children, textId, label),
  );
}

/** Whether the text has a feature-style per-text backing right behind it (not a
 *  shared banner). Drives the remove-background button so it only appears when
 *  there is a backing safe to delete. */
export function reverseTextHasOwnBacking(
  objects: readonly LabelObject[],
  textId: string,
  label?: FontLabel,
): boolean {
  const i = objects.findIndex((o) => o?.id === textId);
  if (i >= 0) {
    const text = objects[i];
    if (!text || text.type !== "text") return false;
    for (let j = i - 1; j >= 0; j--) {
      if (isOwnReverseBacking(objects[j], text as unknown as TextLike, label)) return true;
    }
    return false;
  }
  return objects.some(
    (o) => o && isGroup(o) && reverseTextHasOwnBacking(o.children, textId, label),
  );
}
