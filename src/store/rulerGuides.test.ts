import { describe, it, expect, beforeEach } from "vitest";
import { persistPartialize, temporalPartialize, useLabelStore } from "./labelStore";
import { NO_RULER_GUIDES } from "../lib/rulerGuides";

beforeEach(() => {
  useLabelStore.setState({ rulerGuides: NO_RULER_GUIDES, pages: [{ objects: [] }], currentPageIndex: 0 });
});

describe("ruler guides in the store", () => {
  it("are saved with the session and stay out of the undo timeline", () => {
    useLabelStore.getState().setRulerGuides({ x: [10], y: [] });
    const state = useLabelStore.getState();
    expect(persistPartialize(state).rulerGuides).toEqual({ x: [10], y: [] });
    expect(temporalPartialize(state)).not.toHaveProperty("rulerGuides");
  });

  it("reset on a new design", () => {
    useLabelStore.getState().setRulerGuides({ x: [10], y: [5] });
    useLabelStore.getState().newDesign();
    expect(useLabelStore.getState().rulerGuides).toEqual(NO_RULER_GUIDES);
  });
});
