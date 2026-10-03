// One rule for the stored objects tabs and the links that open them, so a link always lands on a row.
import type { Page } from "../types/Group";
import { exportableLeaves } from "../types/Group";
import type { SetupFont } from "../types/PrinterProfile";
import { uploadKey, type ImageProps } from "../registry/image";
import { getImage } from "./imageCache";
import { isTrueTypeFileName } from "./customFonts";
import { findSetupEntry } from "./setupEntries";

export function storedGraphicRows(pages: readonly Page[]): Map<string, ImageProps> {
  const rows = new Map<string, ImageProps>();
  for (const page of pages) {
    for (const leaf of exportableLeaves(page.objects)) {
      const props = leaf.props as ImageProps;
      const key = leaf.type === "image" ? uploadKey(props) : undefined;
      if (key && !rows.has(key)) rows.set(key, props);
    }
  }
  return rows;
}

export function listsStoredGraphic(rows: ReadonlyMap<string, ImageProps>, p: ImageProps): boolean {
  const key = uploadKey(p);
  return (key !== undefined && rows.has(key)) || getImage(p.imageId) !== undefined;
}

export function listsStoredFont(path: string, setupFonts: readonly SetupFont[] | undefined): boolean {
  return isTrueTypeFileName(path) || findSetupEntry(setupFonts, path) !== undefined;
}
