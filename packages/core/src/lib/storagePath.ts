// Zebra storage paths: bare `device:name` on upload, `device:name.ext` on recall.

import { escapeRegExp } from "./escapeRegExp";
import { newId } from "./ids";

/** R volatile RAM, E flash, B alt flash, A alias. */
export const STORAGE_DEVICES = ["R", "E", "B", "A"] as const;
export type StorageDevice = (typeof STORAGE_DEVICES)[number];

/** DOS-style 8.3 (8-char uppercase alnum + underscore). */
export const MAX_STORAGE_NAME_LEN = 8;
export const STORAGE_NAME_FILTER_RE = /[^A-Z0-9_]/g;

/** Empty when nothing survives the filter, so a caller must reject that. */
export function sanitizeStorageName(raw: string): string {
  return raw.toUpperCase().replace(STORAGE_NAME_FILTER_RE, "").slice(0, MAX_STORAGE_NAME_LEN);
}

/** Short UUID slice avoids collisions without forcing user-chosen name. */
export function defaultStorageName(): string {
  return `IMG_${newId().slice(0, 4).toUpperCase()}`;
}

export interface StoragePath {
  /** Absent when the source named none. */
  device?: string;
  name: string;
  /** Only when the reference names something other than the implicit `.GRF`, e.g. a `.PNG` recall. */
  ext?: string;
}

const GRAPHIC_EXT = "GRF";

/** Drops the implicit `.GRF` and keeps other extensions. A missing device takes `defaultDevice`, an empty name gives null. */
export function parseStoragePath(raw: string, defaultDevice?: string): StoragePath | null {
  const colonAt = raw.indexOf(":");
  const device = colonAt > 0 ? raw.slice(0, colonAt) : defaultDevice;
  const stemWithExt = raw.slice(colonAt + 1);
  // dotAt === 0 means stem starts with `.`; treated as malformed via empty-name guard.
  const dotAt = stemWithExt.lastIndexOf(".");
  const name = dotAt === -1 ? stemWithExt : stemWithExt.slice(0, dotAt);
  if (!name) return null;
  const ext = dotAt === -1 ? "" : stemWithExt.slice(dotAt + 1);
  const path: StoragePath = { name };
  if (device) path.device = device;
  if (ext && ext.toUpperCase() !== GRAPHIC_EXT) path.ext = ext;
  return path;
}

/** Writes the recall spelling `device:name.ext`, or the bare `device:name` a ~DY names. */
export function formatStoragePath(p: StoragePath, withExt: boolean): string {
  const device = p.device ? `${p.device}:` : "";
  return withExt ? `${device}${p.name}.${p.ext || GRAPHIC_EXT}` : `${device}${p.name}`;
}

/** Object names are case-insensitive on the device and R: is where a path without a device lives. */
export function storageKey(path: string): string {
  const colonAt = path.indexOf(":");
  const device = colonAt > 0 ? path.slice(0, colonAt) : "R";
  return `${device}:${colonAt === -1 ? path : path.slice(colonAt + 1)}`.toUpperCase();
}

/** Keys a recall may resolve under: the named device, else the search order (spec p.373). */
export function recallCandidates(p: StoragePath): string[] {
  const devices = p.device ? [p.device] : STORAGE_DEVICES;
  return devices.map((device) => storageKey(formatStoragePath({ ...p, device }, true)));
}

/** ^ID pattern as a test over `device:name.ext`: `*` is the only wildcard, device defaults to R: and extension to .GRF (spec p.245). */
export function storagePathMatcher(pattern: string): (path: string) => boolean {
  const withDevice = storageKey(pattern);
  const full = withDevice.includes(".") ? withDevice : `${withDevice}.${GRAPHIC_EXT}`;
  const re = new RegExp(`^${escapeRegExp(full).replace(/\\\*/g, ".*")}$`);
  return (path) => re.test(storageKey(path));
}

/** The file a ~DG/~DY upload persists: R: unless named, `.GRF` whatever the path said (spec p.175, p.181). */
export function uploadedGraphicPath(p: StoragePath): string {
  return storageKey(formatStoragePath({ device: p.device, name: p.name }, true));
}
