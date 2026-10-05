import type { CustomFontMapping } from "../types/LabelConfig";
import type { PrinterProfile, SetupGraphic } from "../types/PrinterProfile";
import { canSendSetupGraphic, inlineGraphicShips, setupGraphicOf, setupGraphicState, storedGraphicShips, type ImageProps } from "../registry/image";
import { defaultStorageName, uploadedGraphicPath } from "./storagePath";
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

/** Job while the design ships the bytes, else setup or printer by the profile entry. */
export function graphicDelivery(p: ImageProps, setupGraphics: readonly SetupGraphic[] | undefined): ResourceDelivery {
  if (!p.storedAs || p.storedAs.embedInZpl !== false) return "job";
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
  if (!p.storedAs) return inlineGraphicShips(p);
  return storedGraphicShips({ ...p, storedAs: { ...p.storedAs, embedInZpl: true } });
}

/** A delivery that provides the file names it as the upload does, so a recall spelled with another
 *  extension follows the .GRF the job or the script sends. */
export function providedGraphic(p: ImageProps): ImageProps {
  if (!p.storedAs || p.storedAs.ext === undefined) return p;
  const { ext: _ext, ...storedAs } = p.storedAs;
  return { ...p, storedAs };
}

export type GraphicIdentity = Pick<NonNullable<ImageProps["storedAs"]>, "device" | "name">;

/** A printer name no profile entry holds yet, so sending the graphic cannot adopt another one's bytes. */
export function draftGraphicIdentity(setupGraphics: readonly SetupGraphic[] | undefined): GraphicIdentity {
  let identity: GraphicIdentity;
  do identity = { device: "R", name: defaultStorageName() };
  while (findSetupEntry(setupGraphics, uploadedGraphicPath(identity)));
  return identity;
}

type GraphicDeliveryPatch =
  | { patch: Partial<ImageProps> | null; setupGraphics: readonly SetupGraphic[] | undefined }
  | { refused: "tooLarge" | "unshippable" };

export type GraphicWayBlock = "opaque" | "tooLarge" | "tooWide" | "noUploadBytes" | "noJobBytes";

/** Why a way cannot be chosen, so the select and its reasons never disagree with the delivery that follows. */
export function graphicWayBlocks(
  p: ImageProps,
  identity: GraphicIdentity,
  setupGraphics: readonly SetupGraphic[] | undefined,
  refusal: "tooLarge" | "unshippable" | null,
): Partial<Record<ResourceDelivery, GraphicWayBlock>> {
  const job = graphicJobShips(p) ? undefined : p.storedAs ? "noUploadBytes" : "noJobBytes";
  if (p.rawGf) return { job, setup: "opaque", printer: "opaque" };
  const identified = providedGraphic({ ...p, storedAs: p.storedAs ?? identity });
  // An existing entry needs no encode, so only a missing one lets the bytes decide.
  if (findSetupEntry(setupGraphics, uploadedGraphicPath(identified.storedAs ?? identity))) return { job };
  const setup = setupGraphicState(identified, setupGraphics) === "tooLarge" || refusal === "tooLarge"
    ? "tooLarge"
    : refusal === "unshippable"
      ? "tooWide"
      : canSendSetupGraphic(identified)
        ? undefined
        : "noUploadBytes";
  return { job, setup };
}

/** An existing profile entry stays, and an inline graphic takes `identity` only on the way off the job. */
export function applyGraphicDelivery(
  next: ResourceDelivery,
  p: ImageProps,
  setupGraphics: readonly SetupGraphic[] | undefined,
  identity?: GraphicIdentity,
): GraphicDeliveryPatch | undefined {
  // Opaque bytes emit before any recall, so a printer name could never replace them.
  const storedAs: ImageProps["storedAs"] = p.storedAs ?? (p.rawGf ? undefined : identity);
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
  return { patch: { storedAs: provided.storedAs, ...sentGraphicPatch(verdict.entry) }, setupGraphics: withSetupEntry(setupGraphics, verdict.entry) };
}

/** The cache holds what was just sent, so the state reads current without a fresh encode. */
export function sentGraphicPatch(entry: SetupGraphic): Pick<ImageProps, "_gfaCache"> {
  return { _gfaCache: entry.gfa };
}
