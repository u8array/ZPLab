// ^A@ printer TTF cache; data-URL + FontFace registration + localStorage persistence.

import { hydrateLocalStoragePrefix, safeLocalStorageRemove, safeLocalStorageSet } from "./localStorageBucket";

import { newId } from "./ids";
export interface CachedFont {
  id: string;
  /** Uppercase printer filename. */
  name: string;
  /** data:font/ttf;base64,... (or font/otf for OpenType) */
  dataUrl: string;
  /** CSS font-family, e.g. "zpl-ARIAL". */
  fontFamily: string;
}

const LS_PREFIX = 'zpl-font-';

/** Hard cap; TTF MIME varies, so we accept by extension and cap bytes. */
export const MAX_FONT_BYTES = 4 * 1024 * 1024;

/** Embedding inlines the bytes (hex) into every job via ~DY. It is always
 *  allowed (the printer is the target), but above this size we warn: the job
 *  grows, and the live ZPL view rebuilds the payload on every edit. */
export const EMBED_WARN_FONT_BYTES = 1024 * 1024;

const FONT_EXT_RE = /\.(ttf|otf)$/i;

/** Deterministic font MIME by extension. The OS-provided File.type is empty
 *  for .otf on many systems, and an empty/octet-stream data-URL MIME makes
 *  some browsers reject the FontFace, so never trust it; derive from the name. */
function fontMime(name: string): string {
  return /\.otf$/i.test(name) ? 'font/otf' : 'font/ttf';
}

const cache = new Map<string, CachedFont>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(fn => fn());
}

/** Subscribe to cache changes. Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function printerNameToFamily(name: string): string {
  // Strip extension, prefix with "zpl-" to avoid collisions with system fonts
  return 'zpl-' + name.replace(/\.[^.]+$/, '').toUpperCase();
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

/** Resolves true when the face registered, false when the bytes were rejected
 *  (invalid font, unsupported outlines) or the API is unavailable. Callers on
 *  the interactive upload path surface the failure; background paths ignore it.
 *  Binary source, NOT `url(data:...)`: the url form is a font-src fetch, which
 *  the desktop CSP blocks (no `data:` there, deliberately). */
async function registerFontFace(entry: CachedFont): Promise<boolean> {
  try {
    const bytes = dataUrlBytes(entry.dataUrl);
    if (!bytes) return false;
    const face = new FontFace(entry.fontFamily, bytes.buffer as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}

hydrateLocalStoragePrefix<CachedFont>(LS_PREFIX, (entry) => {
  cache.set(entry.name, entry);
  // Re-register asynchronously; canvas renders after React mounts.
  void registerFontFace(entry);
});

/** Look up a cached font by printer filename (case-insensitive). */
export function getFont(printerName: string): CachedFont | undefined {
  return cache.get(printerName.toUpperCase());
}

/** Return the CSS font-family for a printer font name, or undefined if not loaded. */
export function getFontFamily(printerName: string): string | undefined {
  return cache.get(printerName.toUpperCase())?.fontFamily;
}

export function getAllFonts(): CachedFont[] {
  return [...cache.values()];
}

/** Byte length from the persisted data URL without a full base64 decode. */
export function fontByteLength(printerName: string): number | undefined {
  const entry = cache.get(printerName.toUpperCase());
  if (!entry) return undefined;
  const commaIdx = entry.dataUrl.indexOf(",");
  if (commaIdx < 0) return undefined;
  const b64 = entry.dataUrl.slice(commaIdx + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Whether embedding this font warrants a size warning (still allowed). */
export function isEmbedLarge(printerName: string): boolean {
  return (fontByteLength(printerName) ?? 0) > EMBED_WARN_FONT_BYTES;
}

/** Decoded on demand from the persisted data URL. */
export function getFontBytes(printerName: string): Uint8Array | undefined {
  const entry = cache.get(printerName.toUpperCase());
  if (!entry) return undefined;
  return dataUrlBytes(entry.dataUrl);
}

/** Uint8Array variant; parser hands these over after decoding ~DY. */
export async function loadFontBytes(
  bytes: Uint8Array,
  printerName: string,
): Promise<CachedFont> {
  const entry = registerBytes(bytes, printerName);
  await registerFontFace(entry);
  notify();
  return entry;
}

/** Sync; parser can't await per-token. FontFace.load runs in background. */
export function loadFontBytesSync(
  bytes: Uint8Array,
  printerName: string,
): CachedFont {
  const entry = registerBytes(bytes, printerName);
  void registerFontFace(entry).then(notify);
  notify();
  return entry;
}

function registerBytes(bytes: Uint8Array, printerName: string): CachedFont {
  if (bytes.length > MAX_FONT_BYTES) {
    throw new Error(
      `Font too large: ${printerName} (${bytes.length} bytes, max ${MAX_FONT_BYTES})`,
    );
  }
  const name = printerName.toUpperCase().replace(/[^A-Z0-9._]/g, "_");
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const dataUrl = `data:${fontMime(name)};base64,${btoa(binary)}`;
  const fontFamily = printerNameToFamily(name);
  const entry: CachedFont = {
    id: newId(),
    name,
    dataUrl,
    fontFamily,
  };
  cache.set(name, entry);
  safeLocalStorageSet(LS_PREFIX + name, JSON.stringify(entry));
  return entry;
}

export async function loadFontFile(file: File, printerName: string): Promise<CachedFont> {
  if (!FONT_EXT_RE.test(file.name)) {
    throw new Error(`Not a TTF/OTF font: ${file.name}`);
  }
  if (file.size > MAX_FONT_BYTES) {
    throw new Error(`Font too large: ${file.name} (${file.size} bytes, max ${MAX_FONT_BYTES})`);
  }
  // Read bytes (not readAsDataURL) so the data URL carries a deterministic,
  // extension-correct MIME instead of the unreliable OS File.type.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entry = registerBytes(bytes, printerName);
  if (!(await registerFontFace(entry))) {
    // Bytes rejected (e.g. an OTF the engine can't parse): roll back so the
    // caller shows the upload error instead of a silent no-preview row. Roll
    // back via the primitives (not removeFont) so a font that never existed
    // doesn't fire a cache-changed notification before we throw.
    cache.delete(entry.name);
    safeLocalStorageRemove(LS_PREFIX + entry.name);
    throw new Error(`Font could not be registered: ${file.name}`);
  }
  notify();
  return entry;
}

export function removeFont(printerName: string): void {
  const name = printerName.toUpperCase();
  cache.delete(name);
  safeLocalStorageRemove(LS_PREFIX + name);
  notify();
}
