import { describe, it, expect } from "vitest";
import { formatTemplate } from "./formatTemplate";
import en from "../locales/en";
import { queryButtonText, queryOffer, wayHint } from "./printWayText";
import { queryFacts } from "./outputChoice.testkit";
import { asksPrinter } from "./outputChoice";

describe("wayHint", () => {
  it("promises a reply only in the build that can read one", () => {
    expect(wayHint(en.zebraPrint, "network", true)).toBe(en.zebraPrint.wayNetwork);
    expect(wayHint(en.zebraPrint, "network", false)).toBe(en.zebraPrint.wayNetworkWeb);
  });

  it("keeps one wording for the ways that exist in one build only", () => {
    expect(wayHint(en.zebraPrint, "usb", true)).toBe(en.zebraPrint.wayUsb);
    expect(wayHint(en.zebraPrint, "browserprint", false)).toBe(en.zebraPrint.wayBrowserPrint);
  });
});

describe("queryOffer", () => {
  const loc = en.zebraPrint;
  const prints = queryFacts({ commands: ["~HS"] });
  const asks = queryFacts({ commands: ["~HS"], labels: 0 });
  const none = queryFacts();

  it("offers nothing for a document that only prints", () => {
    expect(asksPrinter(none)).toBe(false);
    expect(queryOffer(loc, none, "network", true)).toEqual({ queries: false, hints: [] });
    expect(queryOffer(loc, none, "system", false)).toEqual({ queries: false, hints: [] });
  });

  it("replaces the send where a reply can come back, and names the printed labels on the button and in the hints", () => {
    expect(queryOffer(loc, asks, "network", true)).toEqual({ queries: true, hints: [loc.queryHint] });
    expect(queryOffer(loc, prints, "usb", true)).toEqual({ queries: true, hints: [loc.queryHint, loc.queryPrintsOne] });
    expect(queryButtonText(loc, asks)).toBe(loc.queryButton);
    expect(queryButtonText(loc, prints)).toBe(loc.queryPrintButton);
    const two = queryFacts({ commands: ["^HV1,20,H,E,L"], labels: 2 });
    expect(queryOffer(loc, two, "network", true)).toEqual({ queries: true, hints: [loc.queryHint, formatTemplate(loc.queryPrintsManyFmt, { n: "2" })] });
    const recalled = queryFacts({ commands: ["~HS"], labels: 2, held: false });
    expect(queryOffer(loc, recalled, "network", true)).toEqual({ queries: true, hints: [loc.queryHint, loc.queryPrintsRecalled] });
    expect(queryButtonText(loc, recalled)).toBe(loc.queryPrintButton);
  });

  it("queries for a marked ^HV, and sends where a reply would carry no mark", () => {
    const marked = queryFacts({ commands: ["~HS", "^HV1,20,H,E,F"] });
    expect(queryOffer(loc, marked, "network", true)).toEqual({ queries: true, hints: [loc.queryHint, loc.queryPrintsOne] });
    const bare = queryFacts({ commands: ["~HS", "^HV1,20"], unmarked: ["^HV1,20"] });
    const bareHint = formatTemplate(loc.queryUnmarkedFmt, { commands: "^HV1,20" });
    expect(queryOffer(loc, bare, "network", true)).toEqual({ queries: false, hints: [bareHint] });
    expect(queryOffer(loc, bare, "local", false)).toEqual({ queries: false, hints: [bareHint] });
    const overlapping = queryFacts({ commands: ["^HV1,20,H,E", "^HV2,20,E,H"], labels: 0, ambiguous: ["^HV1,20,H,E", "^HV2,20,E,H"] });
    expect(queryOffer(loc, overlapping, "network", true)).toEqual({ queries: false, hints: [formatTemplate(loc.queryAmbiguousFmt, { commands: "^HV1,20,H,E ^HV2,20,E,H" })] });
    const recalled = queryFacts({ commands: ["^HV1,20,H,E,L"], labels: 0, uncounted: ["^HV1,20,H,E,L"] });
    expect(queryOffer(loc, recalled, "usb", true)).toEqual({ queries: false, hints: [formatTemplate(loc.queryUncountedFmt, { commands: "^HV1,20,H,E,L" })] });
    expect(queryOffer(loc, bare, "system", true)).toEqual({ queries: false, hints: [loc.queryNoRender] });
  });

  it("keeps the send and says the answer is lost where no channel carries it, the web build included", () => {
    expect(queryOffer(loc, asks, "local", false)).toEqual({ queries: false, hints: [loc.queryNoChannel] });
    expect(queryOffer(loc, prints, "local", false)).toEqual({ queries: false, hints: [loc.queryNoChannel] });
    expect(queryOffer(loc, asks, "browserprint", true)).toEqual({ queries: false, hints: [loc.queryNoChannel] });
  });
});
