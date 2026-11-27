import { cloneTree, exportableLeaves, getAllLeaves, isRepeating, selectedTopObjects, withRepeatMark, withoutRepeat, type LabelObject, type LeafObject } from "../types/Group";
import type { PageLabel } from "../types/LabelConfig";
import { labelRectsDots, objectBoundsDots, ownLabelRectDots, unionOf, type BoundingBoxDots, type ObjectBoundsCtx } from "./objectBounds";
import { measuredBoundsDots } from "./printerAnchor";
import { resolveForMeasure } from "./barcodeDims";
import { clockCtxFromLabel } from "./variableBinding";

/** The page and the variables its fields resolve with. */
export type RepeatCtx = Required<Pick<ObjectBoundsCtx, "label" | "variables">>;

// Generated ids hold no tilde, so a copy id splits back into its source.
const COPY_MARK = "~label";
const COPY_ID = new RegExp(`^(.*)${COPY_MARK}\\d+$`, "s");

export const repeatCopyId = (sourceId: string, labelIndex: number): string => `${sourceId}${COPY_MARK}${labelIndex}`;

/** The id of the object a copy repeats, null for an object of the design. */
export function repeatCopySource(id: string): string | null {
  return COPY_ID.exec(id)?.[1] ?? null;
}

/** The design object behind a drawn or printed id: the source of a copy, else the id itself. */
export const designIdOf = (id: string): string => repeatCopySource(id) ?? id;

const hasRow = (label: PageLabel): boolean => labelRectsDots(label).length > 1;

/** The box a leaf prints in, with its markers resolved and a barcode measured. */
function printedBox(leaf: LeafObject, { label, variables }: RepeatCtx): BoundingBoxDots {
  const bounds = measuredBoundsDots(leaf, label, variables);
  const measured = bounds ? new Map([[leaf.id, bounds]]) : undefined;
  return objectBoundsDots(resolveForMeasure(leaf, variables, clockCtxFromLabel(label)), { label, measured });
}

/** The label an object counts from, the one its printed box lies on. Null for a group without leaves. */
function ownLabel(obj: LabelObject, ctx: RepeatCtx): BoundingBoxDots | null {
  const printed = exportableLeaves([obj]);
  // Only what prints settles the label, unless nothing does.
  const leaves = printed.length > 0 ? printed : getAllLeaves([obj]);
  const box = unionOf(leaves.map((l) => printedBox(l, ctx)));
  return box && ownLabelRectDots(ctx.label, box);
}

/** One copy of a repeating object for every other label of the row, empty without a row. */
export function repeatCopies(obj: LabelObject, ctx: RepeatCtx): LabelObject[] {
  const own = hasRow(ctx.label) ? ownLabel(obj, ctx) : null;
  if (!own) return [];
  return labelRectsDots(ctx.label).flatMap((r, k) => {
    if (r.x === own.x) return [];
    return [withoutRepeat(cloneTree(obj, r.x - own.x, 0, (o) => repeatCopyId(o.id, k)))];
  });
}

/** The copies of every repeating top-level object. */
export const allRepeatCopies = (objects: readonly LabelObject[], ctx: RepeatCtx): LabelObject[] =>
  objects.filter(isRepeating).flatMap((o) => repeatCopies(o, ctx));

/** The objects as the liner prints them: every repeating top-level object once per label.
 *  The copies follow all objects, so an imported page appends them and keeps its original bytes. */
export function withRepeatCopies(objects: LabelObject[], ctx: RepeatCtx): LabelObject[] {
  const copies = allRepeatCopies(objects, ctx);
  if (copies.length === 0) return objects;
  // A second pass adds nothing, as no source keeps the mark.
  return [...objects.map(withoutRepeat), ...copies];
}

/** What a repeat toggle does to the selected top-level objects, null where it has nothing to do.
 *  Turning it off needs no row, so a liner back at one label can still drop the mark. */
export function repeatToggle(
  objects: readonly LabelObject[],
  ids: readonly string[],
  label: PageLabel,
): { ids: string[]; turnOn: boolean } | null {
  const selected = selectedTopObjects(objects, ids);
  const turnOn = hasRow(label) && !selected.every(isRepeating);
  const targets = turnOn ? selected : selected.filter(isRepeating);
  return targets.length > 0 ? { ids: targets.map((o) => o.id), turnOn } : null;
}

/** The repeat switch of one object: whether it repeats and whether a toggle acts. Null where it shows none. */
export function repeatSwitch(objects: readonly LabelObject[], id: string, label: PageLabel): { active: boolean; canToggle: boolean } | null {
  const canToggle = repeatToggle(objects, [id], label) !== null;
  // A locked object has no toggle and still shows that it repeats.
  const active = objects.some((o) => o.id === id && isRepeating(o));
  return canToggle || active ? { active, canToggle } : null;
}

function withRepeat(objects: LabelObject[], ids: readonly string[], repeat: boolean): LabelObject[] {
  return objects.map((o): LabelObject => {
    if (!ids.includes(o.id) || isRepeating(o) === repeat) return o;
    return repeat ? withRepeatMark(o) : withoutRepeat(o);
  });
}

/** The objects after a repeat toggle on the selection. */
export function toggledRepeat(objects: LabelObject[], ids: readonly string[], label: PageLabel): LabelObject[] {
  const toggle = repeatToggle(objects, ids, label);
  return toggle ? withRepeat(objects, toggle.ids, toggle.turnOn) : objects;
}

/** Whether a group of these members repeats, which holds where they all repeat from one label. */
export function groupRepeats(members: readonly LabelObject[], ctx: RepeatCtx): boolean {
  if (members.length === 0 || !members.every(isRepeating)) return false;
  const starts = members.flatMap((m) => ownLabel(m, ctx)?.x ?? []);
  return new Set(starts).size <= 1;
}

const decoupleTargets = (objects: readonly LabelObject[], ids: readonly string[], label: PageLabel): LabelObject[] =>
  hasRow(label) ? selectedTopObjects(objects, ids).filter(isRepeating) : [];

export const canDecoupleRepeats = (objects: readonly LabelObject[], ids: readonly string[], label: PageLabel): boolean =>
  decoupleTargets(objects, ids, label).length > 0;

/** The selected repeating objects as plain ones, their copies as objects of the design.
 *  `fresh` gives a copy its ids. */
export function decoupledRepeats(
  objects: LabelObject[],
  ids: readonly string[],
  ctx: RepeatCtx,
  fresh: (copy: LabelObject) => LabelObject,
): LabelObject[] {
  const targets = decoupleTargets(objects, ids, ctx.label);
  if (targets.length === 0) return objects;
  const copies = targets.flatMap((o) => repeatCopies(o, ctx).map(fresh));
  return [...withRepeat(objects, targets.map((o) => o.id), false), ...copies];
}
