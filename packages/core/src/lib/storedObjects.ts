// One rule for the stored objects tabs and the links that open them, so a link always lands on a row.
import type { Page } from "../types/Group";
import { exportableLeaves } from "../types/Group";
import type { SetupFont } from "../types/PrinterProfile";
import { uploadKey, type ImageProps } from "../registry/image";
import { getImage } from "./imageCache";
import { isTrueTypeFileName } from "./customFonts";
import { findSetupEntry } from "./setupEntries";

export interface StoredGraphicRow {
  /** The first object the export lists under the path, the one a send pins its bytes on. */
  id: string;
  props: ImageProps;
}

export function storedGraphicRows(pages: readonly Page[]): Map<string, StoredGraphicRow> {
  const rows = new Map<string, StoredGraphicRow>();
  for (const page of pages) {
    for (const leaf of exportableLeaves(page.objects)) {
      const props = leaf.props as ImageProps;
      const key = leaf.type === "image" ? uploadKey(props) : undefined;
      if (key && !rows.has(key)) rows.set(key, { id: leaf.id, props });
    }
  }
  return rows;
}

export function listsStoredGraphic(rows: ReadonlyMap<string, unknown>, p: ImageProps): boolean {
  const key = uploadKey(p);
  return (key !== undefined && rows.has(key)) || getImage(p.imageId) !== undefined;
}

export function listsStoredFont(path: string, setupFonts: readonly SetupFont[] | undefined): boolean {
  return isTrueTypeFileName(path) || findSetupEntry(setupFonts, path) !== undefined;
}
