import { getAllLeaves, type Page } from "../types/Group";
import type { LabelConfig } from "../types/LabelConfig";
import { storageKey } from "./storagePath";

/** Printer files a document names, as storage keys: alias paths and direct field references. */
export function fontUsage(pages: readonly Page[], label: Pick<LabelConfig, "customFonts">): Set<string> {
  const used = new Set<string>();
  for (const m of label.customFonts ?? []) {
    if (m.path) used.add(storageKey(m.path));
  }
  for (const page of pages) {
    for (const leaf of getAllLeaves(page.objects)) {
      const ref = (leaf.props as { printerFontName?: string }).printerFontName;
      if (ref) used.add(storageKey(ref));
    }
  }
  return used;
}
