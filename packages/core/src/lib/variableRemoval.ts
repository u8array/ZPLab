import type { Page } from "../types/Group";
import { stripMarkerDelimiters, type ColumnMapping, type Variable } from "../types/Variable";
import { dropPageOverlays } from "./pageOverlay";
import { substituteTemplateMarkersMap } from "./templateObjects";

export interface VariableDocument {
  variables: Variable[];
  pages: Page[];
  columnMapping: ColumnMapping | null;
}

/** Removes variables the way the editor does: their markers become the literal default
 *  (a `«…»` inside it would re-bind), their bindings go, and the pages regenerate, since a
 *  ^FN declaration may sit in raw overlay bytes with no object to dirty. Identity-preserving per field. */
export function removeVariables(doc: VariableDocument, ids: ReadonlySet<string>): VariableDocument {
  const removed = doc.variables.filter((v) => ids.has(v.id));
  if (removed.length === 0) return doc;
  // Persisted sessions reach this with unvalidated shapes.
  const defaults = new Map(removed.map((v) => [v.name, stripMarkerDelimiters(String(v.defaultValue ?? ""))]));
  let changed = false;
  const pages = doc.pages.map((p) => {
    const objects = substituteTemplateMarkersMap(p.objects, defaults);
    if (objects === p.objects) return p;
    changed = true;
    return { ...p, objects };
  });
  const regenerated = dropPageOverlays(changed ? pages : doc.pages);
  const mapping = doc.columnMapping;
  const columnMapping =
    mapping && Object.keys(mapping.bindings).some((id) => ids.has(id))
      ? { ...mapping, bindings: Object.fromEntries(Object.entries(mapping.bindings).filter(([id]) => !ids.has(id))) }
      : mapping;
  return { variables: doc.variables.filter((v) => !ids.has(v.id)), pages: regenerated, columnMapping };
}
