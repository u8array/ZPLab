import { sanitiseVariableSlots, type Variable } from "../types/Variable";
import { sanitiseVariableNames } from "./objectTree";
import { dropPageOverlays } from "./pageOverlay";

/** The variable invariants every loader restores: marker-safe unique names and unique
 *  ^FN slots. Run after reconstructLegacyJmDensity: a slot move drops the overlays
 *  (they replay the old ^FN slots), and the ^JM latch reads those overlays. */
export function sanitiseLoadedVariables<P extends { overlay?: unknown }>(
  variables: { name?: unknown; fnNumber?: unknown }[],
  pages: P[],
): { pages: P[]; unplaced: Variable[] } {
  sanitiseVariableNames(variables, pages);
  const { moved, unplaced } = sanitiseVariableSlots(variables);
  return { pages: moved.length > 0 ? dropPageOverlays(pages) : pages, unplaced: unplaced as Variable[] };
}
