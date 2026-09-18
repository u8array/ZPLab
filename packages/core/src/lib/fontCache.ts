// Printer font cache; data-URL + FontFace registration + localStorage persistence.

import { hydrateLocalStoragePrefix, safeLocalStorageRemove, safeLocalStorageSet } from "./localStorageBucket";
import { DEFAULT_FONT_DEVICE, splitStorageKey, storageKey } from "./storagePath";

import { newId } from "./ids";
export interface CachedFont {
  id: string;
  /** The printer file, `DEVICE:NAME`. A row from before keys carried a device keeps its bare name,
   *  which is no reference: address every row through `cachedFontPath`. */
  name: string;
  /** data:font/ttf;base64,... (or font/otf for OpenType) */
  dataUrl: string;
  /** CSS font-family, unique per row. */
  fontFamily: string;
}

const LS_PREFIX = 'zpl-font-';

/** Hard cap; TTF MIME varies, so we accept by extension and cap bytes. */
export const MAX_FONT_BYTES = 4 * 1024 * 1024;

/** Embedding inlines the bytes (hex) into every job via ~DY. It is always
 *  allowed (the printer is the target), but above this size we warn: the job
 *  grows, and the live ZPL view rebuilds the payload on every edit. */
export const EMBED_WARN_FONT_BYTES = 1024 * 1024;

const FONT_EXT_RE = /\.(ttf|otf|tte)$/i;

/** What `loadFontFile` will take, answerable before a byte is read. */
export const isFontFile = (file: File): boolean => FONT_EXT_RE.test(file.name) && file.size <= MAX_FONT_BYTES;

/** Deterministic by extension; the OS File.type is empty for .otf on many systems. A new MIME for an
 *  extension would make `holdsOtherBytes` refuse every row already stored under it. */
function fontMime(name: string): string {
  return /\.otf$/i.test(name) ? 'font/otf' : 'font/ttf';
}

const cache = new Map<string, CachedFont>();
const listeners = new Set<() => void>();
let snapshot: readonly CachedFont[] | undefined;

/** A row saved before keys carried a device reads as E:, the drive the app of that time named its uploads with. */
export function cachedFontPath(entry: CachedFont): string {
  return entry.name.includes(":") ? entry.name : `${DEFAULT_FONT_DEVICE}:${entry.name}`;
}

function notify(): void {
  snapshot = undefined;
  listeners.forEach(fn => fn());
}

/** Subscribe to cache changes. Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Base64 payload of a data URL as bytes, or undefined for a malformed URL. */
function dataUrlBytes(dataUrl: string): Uint8Array | undefined {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) return undefined;
  const binary = atob(dataUrl.slice(commaIdx + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Two registrations of one key resolve in any order; only the latest started one wins. */
const faces = new Map<string, FontFace>();
const faceGeneration = new Map<string, number>();

function dropFontFace(name: string): void {
  const face = faces.get(name);
  if (!face) return;
  faces.delete(name);
  document.fonts.delete?.(face);
}

/** False when the engine rejects the bytes, the API is missing, or a newer registration of the
 *  same row overtook this one. */
async function registerFontFace(entry: CachedFont, generation: number): Promise<boolean> {
  try {
    const bytes = dataUrlBytes(entry.dataUrl);
    if (!bytes) return false;
    // Bytes, not `url(data:...)`: WKWebView enforces font-src even on FontFace loads (#356).
    const face = new FontFace(entry.fontFamily, bytes.buffer as ArrayBuffer);
    await face.load();
    if (faceGeneration.get(entry.name) !== generation) return false;
    dropFontFace(entry.name);
    document.fonts.add(face);
    faces.set(entry.name, face);
    return true;
  } catch {
    return false;
  }
}

/** notify() even for a rejected face: consumers measured against the fallback until now. */
function settleRegistration(entry: CachedFont, generation: number): Promise<void> {
  return registerFontFace(entry, generation).then(() => notify());
}

function nextGeneration(name: string): number {
  const generation = (faceGeneration.get(name) ?? 0) + 1;
  faceGeneration.set(name, generation);
  return generation;
}

/** localStorage is writable by anything on the origin, so a row is taken only in the shape this module writes. */
function isCachedFont(entry: Record<string, unknown>): entry is Record<string, unknown> & CachedFont {
  const { id, name, dataUrl, fontFamily } = entry;
  if (![id, name, dataUrl, fontFamily].every((v) => typeof v === "string" && v !== "")) return false;
  return name === storageKey(name as string) || !(name as string).includes(":");
}

/** A bare row beside a qualified row for the same file is the older write. */
function dropSupersededBareRows(): void {
  for (const name of [...cache.keys()]) {
    if (name.includes(":")) continue;
    if ([...cache.keys()].some((key) => key.includes(":") && splitStorageKey(key).name === name)) {
      cache.delete(name);
      safeLocalStorageRemove(LS_PREFIX + name);
    }
  }
}

hydrateLocalStoragePrefix<Record<string, unknown>>(LS_PREFIX, (entry) => {
  if (isCachedFont(entry)) cache.set(entry.name, entry);
});
dropSupersededBareRows();
for (const entry of cache.values()) void settleRegistration(entry, nextGeneration(entry.name));

function findEntry(ref: string): CachedFont | undefined {
  const key = storageKey(ref);
  const exact = cache.get(key);
  const { device, name } = splitStorageKey(key);
  if (exact || device !== DEFAULT_FONT_DEVICE) return exact;
  return name.includes(":") ? undefined : cache.get(name);
}

export function holdsOtherBytes(path: string, bytes: Uint8Array): boolean {
  const entry = findEntry(path);
  return entry !== undefined && entry.dataUrl !== toDataUrl(entry.name, bytes);
}

/** The first device that writes a file claims its bare row: same id and family, keys moved. */
function adoptLegacyRow(key: string): boolean {
  const bare = splitStorageKey(key).name;
  if (bare.includes(":")) return false;
  const row = cache.get(bare);
  if (!row) return false;
  cache.delete(bare);
  safeLocalStorageRemove(LS_PREFIX + bare);
  cache.set(key, { ...row, name: key });
  const face = faces.get(bare);
  if (face) {
    faces.delete(bare);
    faces.set(key, face);
  }
  const generation = faceGeneration.get(bare);
  if (generation !== undefined) {
    faceGeneration.delete(bare);
    faceGeneration.set(key, generation);
  }
  return true;
}

export function hasFontBytes(ref: string): boolean {
  return findEntry(ref) !== undefined;
}

export function getFont(ref: string): CachedFont | undefined {
  return findEntry(ref);
}

/** Only with a face the engine accepted; the canvas falls back to the calibrated face otherwise. */
export function getFontFamily(ref: string): string | undefined {
  const entry = findEntry(ref);
  return entry && faces.has(entry.name) ? entry.fontFamily : undefined;
}

export function getAllFonts(): CachedFont[] {
  return [...cache.values()];
}

/** Stable between two changes, as useSyncExternalStore requires. */
export function getFontsSnapshot(): readonly CachedFont[] {
  return (snapshot ??= getAllFonts());
}

/** Byte length from the persisted data URL without a full base64 decode. */
export function fontByteLength(ref: string): number | undefined {
  const entry = findEntry(ref);
  if (!entry) return undefined;
  const commaIdx = entry.dataUrl.indexOf(",");
  if (commaIdx < 0) return undefined;
  const b64 = entry.dataUrl.slice(commaIdx + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Whether embedding this font warrants a size warning (still allowed). */
export function isEmbedLarge(ref: string): boolean {
  return (fontByteLength(ref) ?? 0) > EMBED_WARN_FONT_BYTES;
}

/** Decoded on demand from the persisted data URL. */
export function getFontBytes(ref: string): Uint8Array | undefined {
  const entry = findEntry(ref);
  if (!entry) return undefined;
  return dataUrlBytes(entry.dataUrl);
}

function toDataUrl(name: string, bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${fontMime(name)};base64,${btoa(binary)}`;
}

/** Uint8Array variant; parser hands these over after decoding ~DY. */
export async function loadFontBytes(
  bytes: Uint8Array,
  path: string,
): Promise<CachedFont> {
  const { entry, fresh } = registerBytes(bytes, path);
  if (fresh) await settleRegistration(entry, nextGeneration(entry.name));
  return entry;
}

/** Sync; parser can't await per-token. FontFace.load runs in background. */
export function loadFontBytesSync(
  bytes: Uint8Array,
  path: string,
): CachedFont {
  const { entry, fresh } = registerBytes(bytes, path);
  if (fresh) {
    void settleRegistration(entry, nextGeneration(entry.name));
    notify();
  }
  return entry;
}

/** `fresh` is false when the row already held these bytes: a re-parse must not rewrite localStorage or add a face.
 *  A changed file keeps its row id, so its family stays stable and the face is replaced, not shadowed. */
function registerBytes(bytes: Uint8Array, path: string): { entry: CachedFont; fresh: boolean } {
  if (bytes.length > MAX_FONT_BYTES) {
    throw new Error(
      `Font too large: ${path} (${bytes.length} bytes, max ${MAX_FONT_BYTES})`,
    );
  }
  const name = storageKey(path);
  const dataUrl = toDataUrl(name, bytes);
  // An adopted row moved keys, so it is written and announced like a new one.
  const adopted = !cache.has(name) && adoptLegacyRow(name);
  const prior = cache.get(name);
  if (prior && !adopted && prior.dataUrl === dataUrl) return { entry: prior, fresh: false };
  const id = prior?.id ?? newId();
  const entry: CachedFont = { id, name, dataUrl, fontFamily: `zpl-${id}` };
  cache.set(name, entry);
  safeLocalStorageSet(LS_PREFIX + name, JSON.stringify(entry));
  return { entry, fresh: true };
}

/** Rejects only what can never be a font file; whether a face draws is `getFontFamily`'s answer. */
export async function loadFontFile(file: File, path: string): Promise<CachedFont> {
  if (!FONT_EXT_RE.test(file.name)) {
    throw new Error(`Not a TTF/OTF/TTE font: ${file.name}`);
  }
  if (file.size > MAX_FONT_BYTES) {
    throw new Error(`Font too large: ${file.name} (${file.size} bytes, max ${MAX_FONT_BYTES})`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { entry, fresh } = registerBytes(bytes, path);
  if (fresh) await registerFontFace(entry, nextGeneration(entry.name));
  notify();
  return entry;
}

export function removeFont(ref: string): void {
  const entry = findEntry(ref);
  if (entry) {
    dropFontFace(entry.name);
    faceGeneration.delete(entry.name);
    cache.delete(entry.name);
    safeLocalStorageRemove(LS_PREFIX + entry.name);
  }
  notify();
}
