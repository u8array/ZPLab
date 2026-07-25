// Zebra storage paths: bare `device:name` (~DY) vs `device:name.ext` (^XG).

import { newId } from "./ids";

/** R volatile RAM, E flash, B alt flash, A alias. */
export const STORAGE_DEVICES = ["R", "E", "B", "A"] as const;
export type StorageDevice = (typeof STORAGE_DEVICES)[number];

/** DOS-style 8.3 (8-char uppercase alnum + underscore). */
export const MAX_STORAGE_NAME_LEN = 8;
export const STORAGE_NAME_FILTER_RE = /[^A-Z0-9_]/g;

/** Short UUID slice avoids collisions without forcing user-chosen name. */
export function defaultStorageName(): string {
  return `IMG_${newId().slice(0, 4).toUpperCase()}`;
}

export interface StoragePath {
  device: string;
  name: string;
}

/** ^GF uploads persist as `{path}.GRF` on the device. */
const GRAPHIC_EXT = "GRF";

/** Drops extension; null on missing `:`. */
export function parseStoragePath(raw: string): StoragePath | null {
  const colonAt = raw.indexOf(":");
  if (colonAt <= 0) return null;
  const device = raw.slice(0, colonAt);
  const stemWithExt = raw.slice(colonAt + 1);
  // dotAt === 0 means stem starts with `.`; treated as malformed via empty-name guard.
  const dotAt = stemWithExt.lastIndexOf(".");
  const name = dotAt === -1 ? stemWithExt : stemWithExt.slice(0, dotAt);
  if (!name) return null;
  return { device, name };
}

/** withExt true: `device:name.GRF` (^XG); false: bare `device:name` (~DY). */
export function formatStoragePath(p: StoragePath, withExt: boolean): string {
  return withExt ? `${p.device}:${p.name}.${GRAPHIC_EXT}` : `${p.device}:${p.name}`;
}
