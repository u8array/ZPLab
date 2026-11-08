// One wording per way to the printer, shared by the output dialog and the printer settings.
import { carriesReply, type PrintWay } from "./printTarget";
import { asksPrinter, type DocumentQueryFacts } from "./outputChoice";
import { formatTemplate } from "./formatTemplate";
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

interface QueryOffer {
  /** True where the query replaces the send, since an answer can come back. */
  queries: boolean;
  hints: string[];
}

const printsLabels = (query: DocumentQueryFacts): boolean => query.labels > 0;

const printsHint = (loc: Loc, query: DocumentQueryFacts): string => {
  if (!query.held) return loc.queryPrintsRecalled;
  return query.labels === 1 ? loc.queryPrintsOne : formatTemplate(loc.queryPrintsManyFmt, { n: String(query.labels) });
};

export const queryButtonText = (loc: Loc, query: DocumentQueryFacts): string => (printsLabels(query) ? loc.queryPrintButton : loc.queryButton);

/** What the dialog offers a document that asks the printer something, for the way at hand. */
export function queryOffer(loc: Loc, query: DocumentQueryFacts, way: PrintWay, desktop: boolean): QueryOffer {
  if (!asksPrinter(query)) return { queries: false, hints: [] };
  if (way === "system") return { queries: false, hints: [loc.queryNoRender] };
  const blockers = [
    ...(query.unmarked.length > 0 ? [formatTemplate(loc.queryUnmarkedFmt, { commands: query.unmarked.join(" ") })] : []),
    ...(query.ambiguous.length > 0 ? [formatTemplate(loc.queryAmbiguousFmt, { commands: query.ambiguous.join(" ") })] : []),
    ...(query.uncounted.length > 0 ? [formatTemplate(loc.queryUncountedFmt, { commands: query.uncounted.join(" ") })] : []),
  ];
  if (blockers.length > 0) return { queries: false, hints: blockers };
  if (!carriesReply(way, desktop)) return { queries: false, hints: [loc.queryNoChannel] };
  if (!printsLabels(query)) return { queries: true, hints: [loc.queryHint] };
  return { queries: true, hints: [loc.queryHint, printsHint(loc, query)] };
}
