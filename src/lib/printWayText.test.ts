import { describe, it, expect } from "vitest";
import en from "../locales/en";
import { queryOffer, wayHint } from "./printWayText";
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
  const prints = { commands: ["~HS"], prints: true };
  const asks = { commands: ["~HS"], prints: false };

  it("offers nothing for a document that only prints", () => {
    expect(asksPrinter({ commands: [], prints: true })).toBe(false);
    expect(queryOffer(loc, { commands: [], prints: true }, "network", true)).toEqual({ queries: false, hints: [] });
    expect(queryOffer(loc, { commands: [], prints: true }, "system", false)).toEqual({ queries: false, hints: [] });
  });

  it("replaces the send where the reply can come back and names the printed fields that ride along", () => {
    expect(queryOffer(loc, asks, "network", true)).toEqual({ queries: true, hints: [loc.queryHint] });
    expect(queryOffer(loc, prints, "usb", true)).toEqual({ queries: true, hints: [loc.queryHint, loc.queryMixedHint] });
  });

  it("offers the send, not the query, where a reply comes only after the print, and the system way keeps its own reason", () => {
    const late = { commands: ["~HS", "^HV1,20,H,E,F"], prints: true };
    expect(queryOffer(loc, late, "network", true)).toEqual({ queries: false, hints: [loc.queryAfterPrint] });
    expect(queryOffer(loc, late, "local", false)).toEqual({ queries: false, hints: [loc.queryAfterPrint] });
    expect(queryOffer(loc, late, "system", true)).toEqual({ queries: false, hints: [loc.queryNoRender] });
  });

  it("keeps the send and says the answer is lost where no channel carries it, the web build included", () => {
    expect(queryOffer(loc, asks, "local", false)).toEqual({ queries: false, hints: [loc.queryNoChannel] });
    expect(queryOffer(loc, prints, "local", false)).toEqual({ queries: false, hints: [loc.queryNoChannel] });
    expect(queryOffer(loc, asks, "browserprint", true)).toEqual({ queries: false, hints: [loc.queryNoChannel] });
  });
});
