import { mmToDots } from "./coordinates";
import type { PageLabel } from "../types/LabelConfig";
import { effectiveDpmm } from "../types/LabelConfig";
import type { ObjectTypeCore } from "../types/ObjectType";
/** Resolve a registry `defaultSize` declaration to dot units against
 *  the active label config. Spec-fixed-physical-size symbols (e.g.
 *  Maxicode) declare `widthMm`/`heightMm` so their footprint stays
 *  correct across dpmm; all other types declare `width`/`height`
 *  directly in dots. Extracted from the palette so the resolver
 *  stays testable in isolation. */
export function resolveDefaultSizeDots(
  defaultSize: ObjectTypeCore["defaultSize"],
  label: PageLabel,
): { width: number; height: number } {
  if ("widthMm" in defaultSize) {
    return {
      width: mmToDots(defaultSize.widthMm, effectiveDpmm(label)),
      height: mmToDots(defaultSize.heightMm, effectiveDpmm(label)),
    };
  }
  // Shallow-copy the dots-branch so callers can't accidentally
  // mutate the shared registry object via the returned reference.
  return { ...defaultSize };
}
