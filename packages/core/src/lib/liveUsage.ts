import type { Page } from "../types/Group";
import type { LabelConfig } from "../types/LabelConfig";
import type { PrinterProfile } from "../types/PrinterProfile";
import { fontUsage } from "./fontUsage";
import { imageUsage } from "./imageUsage";
import { setupEntryKey } from "./storagePath";

/** Who still names a cached file. */
export type LiveReason = "document" | "profile" | "history" | "clipboard";

export interface Usage {
  images: ReadonlySet<string>;
  fonts: ReadonlySet<string>;
}

/** One owner's claim on the caches: the image ids and font storage keys its pages and aliases name. */
export function documentUsage(pages: readonly Page[], label: Pick<LabelConfig, "customFonts">): Usage {
  return { images: new Set(imageUsage(pages).keys()), fonts: fontUsage(pages, label) };
}

export function profileFontKeys(profile: Pick<PrinterProfile, "setupFonts">): ReadonlySet<string> {
  return new Set((profile.setupFonts ?? []).map(setupEntryKey));
}

/** A store state's claim: an undo step restores the profile with the pages, so its fonts count too. */
export function ownerUsage(pages: readonly Page[], label: Pick<LabelConfig, "customFonts">, profile: Pick<PrinterProfile, "setupFonts">): Usage {
  const document = documentUsage(pages, label);
  return { images: document.images, fonts: new Set([...document.fonts, ...profileFontKeys(profile)]) };
}

export interface LiveOwners {
  document: Usage;
  profile: Pick<PrinterProfile, "setupFonts">;
  history: readonly Usage[];
  clipboard: Usage;
}

export interface LiveUsage {
  images: ReadonlyMap<string, LiveReason>;
  fonts: ReadonlyMap<string, LiveReason>;
}

/** The first owner in declaration order wins. A setupGraphics entry carries its own bytes, so the profile can pin fonts only. */
export function liveUsage(owners: LiveOwners): LiveUsage {
  const images = new Map<string, LiveReason>();
  const fonts = new Map<string, LiveReason>();
  const claim = (map: Map<string, LiveReason>, keys: Iterable<string>, reason: LiveReason) => {
    for (const key of keys) if (!map.has(key)) map.set(key, reason);
  };
  claim(images, owners.document.images, "document");
  claim(fonts, owners.document.fonts, "document");
  claim(fonts, profileFontKeys(owners.profile), "profile");
  for (const snapshot of owners.history) {
    claim(images, snapshot.images, "history");
    claim(fonts, snapshot.fonts, "history");
  }
  claim(images, owners.clipboard.images, "clipboard");
  claim(fonts, owners.clipboard.fonts, "clipboard");
  return { images, fonts };
}
