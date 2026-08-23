import type { PageLabel } from "@zplab/core/types/LabelConfig";
import { isGroup, getAllLeaves, type LabelObject } from "@zplab/core/types/Group";
import type { Variable } from "@zplab/core/types/Variable";
import { planFieldEmission } from "@zplab/core/lib/zplGenerator";

/** Just the field commands for the selected objects (no ^XA / label config /
 *  ^XZ): the page's top-level objects that are selected, a group counting when
 *  it or any descendant leaf is. Includes the template header (^FN/^SO) the
 *  bodies depend on, so a selection using variables stays valid (the ^FE/^FC
 *  armings ride on each field, not here); it stays empty for plain objects.
 *  Empty string when nothing is selected. */
export function zplForSelection(
  label: PageLabel,
  pageObjects: readonly LabelObject[],
  selectedIds: readonly string[],
  variables: readonly Variable[] = [],
): string {
  const sel = new Set(selectedIds);
  const picked = pageObjects.filter(
    (o) => sel.has(o.id) || (isGroup(o) && getAllLeaves(o.children).some((l) => sel.has(l.id))),
  );
  if (picked.length === 0) return "";
  const { headerLines, bodies } = planFieldEmission(label, picked, variables);
  return [...headerLines, ...bodies.map((b) => b.text)].join("\n");
}
