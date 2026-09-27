import type { CustomFontMapping } from "../types/LabelConfig";
import type { PrinterProfile, SetupGraphic } from "../types/PrinterProfile";
import { setupGraphicOf, storedGraphicShips, type ImageProps } from "../registry/image";
import { uploadedGraphicPath } from "./storagePath";
import { findSetupEntry, withSetupEntry, withoutSetupEntry } from "./setupEntries";

/** How a file reaches the printer: with every job, once through the setup script, or assumed to be there. */
export type ResourceDelivery = "job" | "setup" | "printer";
export const RESOURCE_DELIVERIES: readonly ResourceDelivery[] = ["job", "setup", "printer"];

type SetupFont = NonNullable<PrinterProfile["setupFonts"]>[number];
type FontShip = Pick<CustomFontMapping, "embedInZpl"> | undefined;

/** An unchanged list comes back as the same reference, so a caller can skip the profile write. */
function withoutEntry<T extends { path: string }>(list: readonly T[] | undefined, path: string): readonly T[] | undefined {
  return findSetupEntry(list, path) ? withoutSetupEntry(list, path) : list;
}

/** The design's own choice wins: a font it ships prints from the job's bytes while the profile may still provision it. */
export function fontDelivery(mapping: FontShip, path: string, setupFonts: readonly SetupFont[] | undefined): ResourceDelivery {
  if (mapping?.embedInZpl) return "job";
  return findSetupEntry(setupFonts, path) ? "setup" : "printer";
}

/** Undefined for an image without a printer name, which prints as inline ^GF and has no way to choose. */
export function graphicDelivery(p: ImageProps, setupGraphics: readonly SetupGraphic[] | undefined): ResourceDelivery | undefined {
  if (!p.storedAs) return undefined;
  if (p.storedAs.embedInZpl !== false) return "job";
  return findSetupEntry(setupGraphics, uploadedGraphicPath(p.storedAs)) ? "setup" : "printer";
}

/** The profile keeps its entry while the job ships the font too. Only "printer" says the entry is unwanted. */
export function applyFontDelivery(
  next: ResourceDelivery,
  mapping: FontShip,
  path: string,
  setupFonts: readonly SetupFont[] | undefined,
): { patch: { embedInZpl: true | undefined } | null; setupFonts: readonly SetupFont[] | undefined } {
  const ships = mapping?.embedInZpl === true;
  const patch = ships === (next === "job") ? null : { embedInZpl: next === "job" ? (true as const) : undefined };
  if (next === "job") return { patch, setupFonts };
  if (next === "setup") return { patch, setupFonts: findSetupEntry(setupFonts, path) ? setupFonts : withSetupEntry(setupFonts, { path }) };
  return { patch, setupFonts: withoutEntry(setupFonts, path) };
}

/** Whether "job" would put bytes into the stream, so the choice never claims what the emit cannot send. */
export function graphicJobShips(p: ImageProps): boolean {
  return p.storedAs !== undefined && storedGraphicShips({ ...p, storedAs: { ...p.storedAs, embedInZpl: true } });
}

/** A delivery that provides the file names it as the upload does, so a recall spelled with another
 *  extension follows the .GRF the job or the script sends. */
export function providedGraphic(p: ImageProps): ImageProps {
  if (!p.storedAs || p.storedAs.ext === undefined) return p;
  const { ext: _ext, ...storedAs } = p.storedAs;
  return { ...p, storedAs };
}

type GraphicDeliveryPatch =
  | { patch: Partial<ImageProps> | null; setupGraphics: readonly SetupGraphic[] | undefined }
  | { refused: "tooLarge" | "unshippable" };

/** A profile entry the design already has stays as it is, so choosing "setup" encodes only when none exists. */
export function applyGraphicDelivery(
  next: ResourceDelivery,
  p: ImageProps,
  setupGraphics: readonly SetupGraphic[] | undefined,
): GraphicDeliveryPatch | undefined {
  const storedAs = p.storedAs;
  if (!storedAs) return undefined;
  const path = uploadedGraphicPath(storedAs);
  const ships = storedAs.embedInZpl !== false;
  if (next === "job") return { patch: ships ? null : { storedAs: { ...storedAs, embedInZpl: true } }, setupGraphics };
  const recallOnly = { ...storedAs, embedInZpl: false };
  if (next === "printer") return { patch: ships ? { storedAs: recallOnly } : null, setupGraphics: withoutEntry(setupGraphics, path) };
  const provided = providedGraphic({ ...p, storedAs: recallOnly });
  const patch = ships || storedAs.ext !== undefined ? { storedAs: provided.storedAs } : null;
  if (findSetupEntry(setupGraphics, path)) return { patch, setupGraphics };
  const verdict = setupGraphicOf(provided);
  if (!verdict) return undefined;
  if (verdict.fit !== "ok") return { refused: verdict.fit };
  // The cache holds what was just sent, so the state reads current without a fresh encode.
  return { patch: { storedAs: provided.storedAs, _gfaCache: verdict.entry.gfa }, setupGraphics: withSetupEntry(setupGraphics, verdict.entry) };
}
