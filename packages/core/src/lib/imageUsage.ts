import { getAllLeaves, type Page } from "../types/Group";
import type { ImageProps } from "../registry/image";
import { commitImages, type CachedImage } from "./imageCache";

/** Objects per cached image id. Hidden, grouped and export-excluded ones count. */
export function imageUsage(pages: readonly Page[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const page of pages) {
    for (const leaf of getAllLeaves(page.objects)) {
      if (leaf.type !== "image") continue;
      const id = (leaf.props as ImageProps).imageId;
      if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
    }
  }
  return usage;
}

/** Persists only the rows the pages name, so an unrecalled upload or a QR sidecar row stays out of the cache. */
export function commitUsedImages(pages: readonly Page[], rows: readonly CachedImage[]): void {
  const used = imageUsage(pages);
  commitImages(rows.filter((img) => used.has(img.id)));
}
