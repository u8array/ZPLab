// One wording per way to the printer, shared by the output dialog and the printer settings.
import type { PrintWay } from "./printTarget";
import type { Translations } from "../locales";

type Loc = Translations["zebraPrint"];

const WAY_KEY = {
  network: "wayNetwork",
  browserprint: "wayBrowserPrint",
  local: "wayLocal",
  usb: "wayUsb",
  system: "waySystem",
} as const satisfies Record<PrintWay, keyof Loc>;

const LABEL_KEY = {
  network: "tabNetwork",
  browserprint: "tabBrowserPrint",
  local: "tabLocal",
  usb: "tabUsb",
  system: "tabSystem",
} as const satisfies Record<PrintWay, keyof Loc>;

export const wayLabel = (loc: Loc, way: PrintWay): string => loc[LABEL_KEY[way]];

/** The network way is a raw TCP socket in the desktop shell and a plain POST in the browser, so its
 *  wording is the only one that depends on the build. */
export const wayHint = (loc: Loc, way: PrintWay, desktop: boolean): string =>
  way === "network" && !desktop ? loc.wayNetworkWeb : loc[WAY_KEY[way]];
