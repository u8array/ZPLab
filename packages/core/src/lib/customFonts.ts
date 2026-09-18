import type { CustomFontMapping, LabelConfig } from "../types/LabelConfig";
import { getFontBytes, holdsOtherBytes, isFontFile } from "./fontCache";
import { DEFAULT_FONT_DEVICE, sanitizeStorageName, STORAGE_DEVICES, storageRefMatchesPath } from "./storagePath";
import { stripZplParamChars } from "./zplParams";
/** Strip-pattern; schema's regex `/^[A-Z0-9]$/` is the inverse. */
export const ALIAS_CHAR_RE = /[^A-Z0-9]/g;

const BYTE_HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0").toUpperCase(),
);

/** The ~DY upload line for a device path. The name carries its extension, as Zebra's own example spells it (spec p.183). */
export function formatFontDownloadFromPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (!isTrueTypeFileName(trimmed)) return undefined;
  const bytes = getFontBytes(trimmed);
  if (!bytes) return undefined;
  const colon = trimmed.indexOf(":");
  const drive = stripZplParamChars(trimmed.slice(0, colon + 1));
  const filename = trimmed.slice(colon + 1);
  const dot = filename.lastIndexOf(".");
  const stem = stripZplParamChars(filename.slice(0, dot));
  const ext = filename.slice(dot + 1).toUpperCase();
  const code = fontFormatOf(trimmed);
  // Lookup table avoids per-byte toString/padStart allocations on
  // multi-MB TTFs.
  let hex = "";
  for (const b of bytes) hex += BYTE_HEX[b];
  return `~DY${drive}${stem}.${ext},A,${code},${bytes.length},,${hex}`;
}

/** ~DY format code per font extension (spec p.182); the parser and the emitter read the same pairs. */
export const FONT_FORMAT_BY_EXT = { TTF: "T", OTF: "T", TTE: "E", FNT: "B" } as const;
export const FONT_EXT_BY_FORMAT = { T: "TTF", E: "TTE", B: "FNT" } as const;
export type FontFormatCode = keyof typeof FONT_EXT_BY_FORMAT;

function fontFormatOf(path: string): FontFormatCode | undefined {
  if (!path.includes(".")) return undefined;
  const ext = path.slice(path.lastIndexOf(".") + 1).toUpperCase();
  return (FONT_FORMAT_BY_EXT as Record<string, FontFormatCode>)[ext];
}

/** Whether the bytes re-ship as a TrueType upload: TrueType, OpenType or TrueType Extension (spec p.182). */
export function isTrueTypeFileName(path: string): boolean {
  const code = fontFormatOf(path);
  return code === "T" || code === "E";
}

/** E=flash, R=RAM, A=removable, B=on-board flash. */
export const ZPL_DRIVE_PREFIXES = ["E:", "R:", "A:", "B:"] as const;

/** Firmware built-ins; excluded from nextFreeAlias auto-pick range. */
export const ZPL_BUILTIN_FONT_IDS = [
  "0",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
] as const;

/** The printer path for a locally picked file: a real device, up to 8 name chars, and an extension
 *  ^A@ and ^CW can reference (spec p.63, p.168): .TTE stays, everything else is .TTF. */
export function printerFontFileName(fileName: string): string | undefined {
  const first = fileName[0]?.toUpperCase() ?? "";
  const typedDevice = fileName[1] === ":" && (STORAGE_DEVICES as readonly string[]).includes(first) ? `${first}:` : undefined;
  const rest = typedDevice ? fileName.slice(2) : fileName;
  const device = typedDevice ?? `${DEFAULT_FONT_DEVICE}:`;
  const dot = rest.lastIndexOf(".");
  const stem = sanitizeStorageName(dot >= 0 ? rest.slice(0, dot) : rest);
  const ext = fontFormatOf(rest) === "E" ? "TTE" : "TTF";
  return stem ? `${device}${stem}.${ext}` : undefined;
}

export type FontUploadIssue = "notAFont" | "nameUnusable" | "nameTaken";

/** The gate a picked file passes before its bytes enter the cache; reads the file once. */
export async function prepareFontUpload(
  file: File,
  typedName = "",
): Promise<{ ok: true; path: string; bytes: Uint8Array } | { ok: false; reason: FontUploadIssue }> {
  if (!isFontFile(file)) return { ok: false, reason: "notAFont" };
  const path = printerFontFileName(typedName.trim() || file.name);
  if (!path) return { ok: false, reason: "nameUnusable" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Two picked files can fold onto one printer name; a different file must not take the first one's row.
  if (holdsOtherBytes(path, bytes)) return { ok: false, reason: "nameTaken" };
  return { ok: true, path, bytes };
}

/** First valid ^CW char, or empty when none present. */
export function normalizeAlias(raw: string): string {
  return raw.toUpperCase().replace(ALIAS_CHAR_RE, "").slice(0, 1);
}

/** Empty alias removes; new entries appended. */
export function upsertCustomFontMapping(
  list: readonly CustomFontMapping[] | undefined,
  path: string,
  alias: string,
): CustomFontMapping[] {
  const entries = list ?? [];
  const matches = (m: CustomFontMapping) => m.path !== undefined && storageRefMatchesPath(m.path, path);
  // An empty alias removes the entry: the schema has no representation for it.
  if (!alias) return entries.filter((m) => !matches(m));
  const prior = entries.find(matches);
  return prior ? entries.map((m) => (m === prior ? { ...m, alias } : m)) : [...entries, { alias, path }];
}

/** Drop path-less canvas-only bindings left by the removed built-in
 *  preview feature. Returns undefined when nothing remains so the field
 *  stays absent. Uploaded fonts carry their preview via `path`. */
export function dropLegacyFontBindings(
  list: readonly CustomFontMapping[] | undefined,
): CustomFontMapping[] | undefined {
  if (!list) return undefined;
  const next = list.filter((m) => m.path !== undefined);
  return next.length > 0 ? next : undefined;
}

export const ZPL_BUILTIN_FONT_LETTERS = '0ABCDEFGH';
const ALIAS_PREFERRED_ORDER = 'IJKLMNOPQRSTUVWXYZ123456789';

/** Length guard: `String.includes("")` is true, so a blank would trip every branch. */
export function isBuiltinFontId(alias: string): boolean {
  return alias.length === 1 && ZPL_BUILTIN_FONT_LETTERS.includes(alias);
}

/** Canvas preview face per built-in device font, matching Labelary's
 *  appearance: A/C/D/F/G are monospace (Vera Mono), B is its bold weight,
 *  E is OCR-B, H is OCR-A. Font 0 is omitted so it keeps the default
 *  PrintLab (CG Triumvirate) face with its calibrated per-glyph table.
 *  Custom ~DY uploads override this upstream. */
const MONO = "'PrintLab Mono', 'Vera Mono', monospace";
const BUILTIN_FONT_FAMILY: Record<string, string> = {
  A: MONO,
  B: "'Vera Mono Bold', 'Vera Mono', monospace",
  C: MONO,
  D: MONO,
  E: "'OCRB', 'Vera Mono', monospace",
  F: MONO,
  G: MONO,
  H: "'OCRA', 'OCRB', monospace",
};

export function builtinFontFamily(fontId: string | undefined): string | undefined {
  return fontId ? BUILTIN_FONT_FAMILY[fontId] : undefined;
}

import type { DeviceFontLabel } from "../types/LabelConfig";

export type { DeviceFontLabel };

/** Font id whose bitmap cell grid governs a text field, or undefined for a
 *  scalable face (^A@ TTF, or a ^CW upload aliasing the id). Single resolver
 *  for render metrics and both anchor boundaries, so they can never disagree
 *  and anchors round-trip byte-exact. */
export function resolveDeviceFontId(
  fieldFontId: string | undefined,
  printerFontName: string | undefined,
  label: DeviceFontLabel,
): string | undefined {
  if (!fieldFontId && printerFontName) return undefined;
  const eff = fieldFontId ?? label.defaultFontId;
  if (!eff) return undefined;
  // Only a usable mapping shadows a built-in: FontManager's manual rows
  // start as { alias, path: '' } and the export still emits the built-in
  // ^A font for those, so preview and anchor must keep it too.
  return resolvePreviewFontName(label, eff) !== undefined ? undefined : eff;
}

/** The file the canvas draws an alias with: its printer path, or the local face of a path-less alias. */
export function resolvePreviewFontName(
  label: Pick<LabelConfig, "customFonts">,
  fontId: string | undefined,
): string | undefined {
  if (!fontId) return undefined;
  const entry = label.customFonts?.find((m) => m.alias === fontId);
  if (!entry) return undefined;
  return entry.path || entry.previewFontName || undefined;
}

export function resolveDefaultPrinterFontName(
  label: Pick<LabelConfig, "defaultFontId" | "customFonts">,
): string | undefined {
  return resolvePreviewFontName(label, label.defaultFontId);
}

/** Built-ins tried last (overriding them is deliberate); '' when all 36 used. */
export function nextFreeAlias(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (const c of ALIAS_PREFERRED_ORDER) {
    if (!used.has(c)) return c;
  }
  for (const c of ZPL_BUILTIN_FONT_LETTERS) {
    if (!used.has(c)) return c;
  }
  return '';
}

export interface FontIdOption {
  id: string;
  builtin: boolean;
  path?: string;
  previewFontName?: string;
}

/** Built-ins (0, A-H) plus customFonts aliases; collisions override the built-in row. */
export function getAvailableFontIds(
  label: Pick<LabelConfig, "customFonts">,
): FontIdOption[] {
  const byId = new Map<string, FontIdOption>();
  for (const id of ZPL_BUILTIN_FONT_LETTERS) {
    byId.set(id, { id, builtin: true });
  }
  for (const m of label.customFonts ?? []) {
    const existing = byId.get(m.alias);
    byId.set(m.alias, {
      id: m.alias,
      builtin: existing?.builtin ?? false,
      path: m.path,
      previewFontName: m.previewFontName,
    });
  }
  return [...byId.values()];
}

/** Marks every mapping whose path an upload matched, so a ^CW that precedes its ~DY still embeds. */
export function bindFontEmbeds(
  fonts: CustomFontMapping[] | undefined,
  uploadedPaths: readonly string[],
): { fonts: CustomFontMapping[] | undefined; embedded: Set<string> } {
  const embedded = new Set<string>();
  const bound = fonts?.map((m) => {
    const ref = m.path;
    const upload = ref ? uploadedPaths.find((p) => storageRefMatchesPath(ref, p)) : undefined;
    if (!upload) return m;
    embedded.add(upload);
    return { ...m, embedInZpl: true };
  });
  return { fonts: bound, embedded };
}
