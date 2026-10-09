// One wording per way to the printer, shared by the send dialog and the printer settings.
import type { PrintTransport } from "./printTarget";
import type { Translations } from "../locales";

type Loc = Translations["zebraPrint"];

const WAY_KEY = {
  network: "wayNetwork",
  browserprint: "wayBrowserPrint",
  local: "wayLocal",
  usb: "wayUsb",
} as const satisfies Record<PrintTransport, keyof Loc>;

/** The network way is a raw TCP socket in the desktop shell and a plain POST in the browser, so it is the
 *  one way whose wording depends on the build. The other three exist in one build each. */
export const wayHint = (loc: Loc, transport: PrintTransport, desktop: boolean): string =>
  transport === "network" && !desktop ? loc.wayNetworkWeb : loc[WAY_KEY[transport]];
