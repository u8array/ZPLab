import { describe, it, expect, beforeEach } from "vitest";
import { useLabelStore } from "./labelStore";
import { selectDocumentEmits } from "./labelStore.selectors";

beforeEach(() => {
  useLabelStore.setState({ label: { widthMm: 50, heightMm: 30, dpmm: 8 }, pages: [{ objects: [] }], currentPageIndex: 0, variables: [] });
});

describe("selectDocumentEmits", () => {
  it("counts a page that only asks the printer", () => {
    expect(selectDocumentEmits(useLabelStore.getState())).toBe(false);
    useLabelStore.setState({ pages: [{ objects: [], hostCommands: ["~HS"] }] });
    expect(selectDocumentEmits(useLabelStore.getState())).toBe(true);
  });
});
