import type { LabelObject } from "@zplab/core/types/Group";
import { findObjectById, getAllLeaves, isGroup } from "@zplab/core/types/Group";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import {
  printableRectDots,
  unionOf,
  type BoundingBoxDots,
  type ObjectBoundsCtx,
} from "@zplab/core/lib/objectBounds";
import type { AlignBox, AlignRef } from "./align";
import { safeAreaRectDots } from "./safeArea";
import { selectTidyTargets } from "./tidyClassify";

export type BoxOf = (obj: LabelObject, ctx: ObjectBoundsCtx) => BoundingBoxDots;

interface AlignSelection {
  boxes: AlignBox[];
  ref: BoundingBoxDots | null;
  container: BoundingBoxDots;
  apply: (delta: { id: string; dx: number; dy: number }) => { id: string; changes: { x: number; y: number } }[];
}

/** Boxes, reference frame and delta applier for align, distribute and tidy, all
 *  in dots so the result is zoom- and view-rotation-independent. */
export function buildAlignSelection(
  objs: LabelObject[],
  ids: readonly string[],
  label: PageLabel,
  measured: ObjectBoundsCtx["measured"],
  alignRef: AlignRef,
  boxOf: BoxOf,
): AlignSelection | null {
  if (ids.length === 0) return null;
  const ctx = { label, measured };

  // Locked and hidden objects are non-participants, like drag and lasso.
  const movable = ids
    .map((id) => findObjectById(objs, id))
    .filter((o): o is LabelObject => o !== undefined && !o.locked && o.visible !== false);
  if (movable.length === 0) return null;

  const printable = printableRectDots(label);
  const items = movable.map((o) => ({
    id: o.id,
    type: isGroup(o) ? "group" : o.type,
    box: boxOf(o, ctx),
  }));
  // Structural primitives such as a full-label frame or a spanning divider
  // neither inflate the reference nor get rearranged, consistent with tidy.
  const contentIds = new Set(selectTidyTargets(items, printable.width, printable.height));
  const content = movable.filter((o) => contentIds.has(o.id));
  const boxes: AlignBox[] = items
    .filter((it) => contentIds.has(it.id))
    .map((it) => ({ id: it.id, ...it.box }));

  // Align-to-label pins to the safe-area inset when configured, so the
  // edge buttons keep a uniform margin.
  const labelBox = safeAreaRectDots(label) ?? printable;
  let refBox: BoundingBoxDots | null;
  // A single unit has no selection or key frame of its own, so it aligns to
  // the label the way a single element aligns to its parent in Figma.
  if (alignRef === "label" || content.length === 1) {
    refBox = labelBox;
  } else if (alignRef === "key") {
    const key = boxes[boxes.length - 1];
    refBox = key ? { x: key.x, y: key.y, width: key.width, height: key.height } : null;
  } else {
    refBox = unionOf(boxes);
  }

  const byId = new Map(content.map((o) => [o.id, o]));
  const apply = (delta: { id: string; dx: number; dy: number }) => {
    const dx = Math.round(delta.dx);
    const dy = Math.round(delta.dy);
    if (dx === 0 && dy === 0) return [];
    const node = byId.get(delta.id);
    if (!node) return [];
    // A group has no own x/y, so every leaf shifts by the same delta.
    const targets = isGroup(node) ? getAllLeaves(node.children) : [node];
    return targets.map((leaf) => ({
      id: leaf.id,
      changes: { x: leaf.x + dx, y: leaf.y + dy },
    }));
  };

  return { boxes, ref: refBox, container: labelBox, apply };
}
