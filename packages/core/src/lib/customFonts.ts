import type { CustomFontMapping, LabelConfig } from "../types/LabelConfig";
import { getFontBytes } from "./fontCache";
/** Strip-pattern; schema's regex `/^[A-Z0-9]$/` is the inverse. */
export const ALIAS_CHAR_RE = /[^A-Z0-9]/g;

const BYTE_HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0").toUpperCase(),
);

/** Build the `~DY` upload line for a `E:NAME.TTF` style path, bytes
 *  from fontCache. `cacheKey` overrides the filename used for byte
 *  lookup when the on-printer name differs from the upload name. */
export function formatFontDownloadFromPath(
  path: string,
  cacheKey?: string,
): string | undefined {
  const colon = path.indexOf(":");
  if (colon < 0) return undefined;
  const drive = path.slice(0, colon + 1);
  const filename = path.slice(colon + 1);
  const dot = filename.lastIndexOf(".");
  const stem = dot >= 0 ? filename.slice(0, dot) : filename;
  const ext = dot >= 0 ? filename.slice(dot + 1).toUpperCase() : "";
  if (ext !== "TTF" && ext !== "OTF") return undefined;
  const bytes = getFontBytes(cacheKey ?? filename);
  if (!bytes) return undefined;
  // Lookup table avoids per-byte toString/padStart allocations on
  // multi-MB TTFs.
  let hex = "";
  for (const b of bytes) hex += BYTE_HEX[b];
  return `~DY${drive}${stem},A,T,${bytes.length},,${hex}`;
}

export const DEFAULT_FONT_DRIVE = "E:";

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

export function uploadedFontPath(name: string): string {
  return `${DEFAULT_FONT_DRIVE}${name}`;
}

export function stripDrivePrefix(path: string): string {
  return path.replace(/^[A-Z]:/, "");
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
  const withoutPath = (list ?? []).filter((m) => m.path !== path);
  if (!alias) return withoutPath;
  return [...withoutPath, { alias, path }];
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

/** Canvas-only preview TTF name; emit/parse ignore this resolver. */
export function resolvePreviewFontName(
  label: Pick<LabelConfig, "customFonts">,
  fontId: string | undefined,
): string | undefined {
  if (!fontId) return undefined;
  const entry = label.customFonts?.find((m) => m.alias === fontId);
  if (!entry) return undefined;
  if (entry.previewFontName) return entry.previewFontName;
  if (entry.path) return stripDrivePrefix(entry.path);
  return undefined;
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
