/**
 * Image cache keyed by a stable ID.
 * Images are stored as data-URLs and persisted to localStorage
 * so they survive page reloads.
 */

import { hydrateLocalStoragePrefix, safeLocalStorageRemove, safeLocalStorageSet } from "./localStorageBucket";
import { loadImage } from "./loadImage";

import { newId } from "./ids";
export interface CachedImage {
  id: string;
  name: string;
  /** data-URL (image/png or image/jpeg etc.) */
  dataUrl: string;
  /** Natural pixel width */
  width: number;
  /** Natural pixel height */
  height: number;
}

const LS_PREFIX = 'zpl-img-';

/** Hard cap on a single image's source bytes. localStorage quota across all
 *  origins is ~5 MiB; capping per-image at 2 MiB stops one oversized drop
 *  from filling the entire cache. The UI's `accept="image/*"` is a hint
 *  only; this is the authoritative limit. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const cache = new Map<string, CachedImage>();

hydrateLocalStoragePrefix<CachedImage>(LS_PREFIX, (entry) => {
  cache.set(entry.id, entry);
});

export function getImage(id: string): CachedImage | undefined {
  return cache.get(id);
}

export function getAllImages(): CachedImage[] {
  return [...cache.values()];
}

export function putImage(img: CachedImage): void {
  cache.set(img.id, img);
  safeLocalStorageSet(LS_PREFIX + img.id, JSON.stringify(img));
}

export function removeImage(id: string): void {
  cache.delete(id);
  safeLocalStorageRemove(LS_PREFIX + id);
}

/** Load a File into the cache. Returns the CachedImage entry. Rejects on
 *  non-image MIME type, oversized files, or decode failures. */
export async function loadImageFile(file: File): Promise<CachedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`Not an image: ${file.name}`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${file.name} (${file.size} bytes, max ${MAX_IMAGE_BYTES})`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      loadImage(dataUrl, `Failed to decode image: ${file.name}`)
        .then((img) => {
          const entry: CachedImage = {
            id: newId(),
            name: file.name,
            dataUrl,
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
          putImage(entry);
          resolve(entry);
        })
        .catch(reject);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}
