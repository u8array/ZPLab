import bwipjs from "bwip-js/browser";
import { BARCODE_1D_TYPES } from "../registry";
import { verifiedZJustifyCombo } from "../registry/zplHelpers";
import { isGroup, type LabelObject } from "../types/Group";
import { effectiveDpmm, type LabelConfig } from "../types/LabelConfig";
import type { Variable } from "../types/Variable";
import { measureBarcodeBoundsWith, resolveForMeasure, type BwipEngine } from "./barcodeDims";
import type { MeasuredFootprint } from "./objectBounds";
import { clockCtxFromLabel, getObjectStringContent } from "./variableBinding";

/** Rotated visual footprint in exact dots. */
export interface Footprint {
  w: number;
  h: number;
}

type MeasureLabel = Pick<LabelConfig, "dpmm" | "jmDensity" | "secondaryClockOffset" | "tertiaryClockOffset">;

const engine = bwipjs as unknown as BwipEngine;

// Mutators replace props on every edit, so the live ZPL panel re-encodes a barcode only when that barcode's own props are replaced.
// Resolved content and density sit in the entry because a default or a clock can change under the same props.
const memo = new WeakMap<object, { content: string | undefined; dpmm: number; bounds: MeasuredFootprint | null }>();

/** The measured-bounds record of a barcode, null for a group or when the kernel cannot measure the object. */
export function measuredBoundsDots(obj: LabelObject, label: MeasureLabel, variables: readonly Variable[]): MeasuredFootprint | null {
  if (isGroup(obj)) return null;
  const resolved = resolveForMeasure(obj, variables, clockCtxFromLabel(label));
  const content = getObjectStringContent(resolved);
  const dpmm = effectiveDpmm(label);
  const hit = memo.get(obj.props);
  if (hit && hit.content === content && hit.dpmm === dpmm) return hit.bounds;
  const bounds = measureBarcodeBoundsWith(engine, resolved, dpmm);
  memo.set(obj.props, { content, dpmm, bounds });
  return bounds;
}

/** Printed footprint of the object in dots, null for a group or when the kernel cannot measure it. */
export function footprintDots(obj: LabelObject, label: MeasureLabel, variables: readonly Variable[]): Footprint | null {
  const bounds = measuredBoundsDots(obj, label, variables);
  return bounds && { w: bounds.width, h: bounds.height };
}

/** The x a gated right-justified 1D field prints at, null when the field emits z-less. */
export function printerAnchoredX(
  obj: LabelObject,
  label: MeasureLabel & Pick<LabelConfig, "emit1dZJustify">,
  variables: readonly Variable[],
): number | null {
  if (!label.emit1dZJustify || !BARCODE_1D_TYPES.has(obj.type) || !verifiedZJustifyCombo(obj)) return null;
  const fp = footprintDots(obj, label, variables);
  return fp ? obj.x + fp.w : null;
}
