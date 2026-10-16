import { describe, it, expect, expectTypeOf } from "vitest";
import { DESIGN_FILE_PAGE_KEYS } from "@zplab/core/lib/designFile";
import { pageLabelConfig, type Page } from "@zplab/core/types/Group";
import { buildBlockOverlay } from "@zplab/core/lib/zplOverlay/overlay";
import { useLabelStore } from "./labelStore";

/** A page with every key set, so a new key fails the comparison below until each consumer takes a decision on it. */
const full: Page = {
  objects: [],
  jmDensity: "B",
  storedFormatPath: "R:A.ZPL",
  storedFormatDelivery: "setup",
  hostCommands: ["~HS"],
  overlay: buildBlockOverlay("^XA^XZ", [], { regenSafe: true }),
};

describe("Page keys", () => {
  it("are all persisted by the design file", () => {
    expectTypeOf<(typeof DESIGN_FILE_PAGE_KEYS)[number]>().toEqualTypeOf<keyof Page>();
    expect([...DESIGN_FILE_PAGE_KEYS].sort()).toEqual(Object.keys(full).sort());
  });

  it("fold into the page label or are deliberately left out of it", () => {
    const folded = pageLabelConfig({ widthMm: 50, heightMm: 30, dpmm: 8 }, full);
    expect(folded.jmDensity).toBe("B");
    expect(folded.storedFormatPath).toBe("R:A.ZPL");
    expect(folded.storedFormatDelivery).toBe("setup");
    expect(folded.hostCommands).toEqual(["~HS"]);
    expect(folded).not.toHaveProperty("overlay");
  });

  it("travel with a duplicated page, except the provenance and the stored format", () => {
    useLabelStore.setState({ label: { widthMm: 50, heightMm: 30, dpmm: 8 }, pages: [full], currentPageIndex: 0, variables: [] });
    useLabelStore.getState().duplicatePage(0);
    const copy = useLabelStore.getState().pages[1] as Page;
    expect(copy.jmDensity).toBe("B");
    expect(copy.hostCommands).toEqual(["~HS"]);
    expect(copy.storedFormatPath).toBeUndefined();
    expect(copy.storedFormatDelivery).toBeUndefined();
    expect(copy.overlay).toBeUndefined();
  });
});
