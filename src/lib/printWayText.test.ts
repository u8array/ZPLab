import { describe, it, expect } from "vitest";
import en from "../locales/en";
import { wayHint } from "./printWayText";

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
