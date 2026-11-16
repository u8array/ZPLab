// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, fireEvent } from "@testing-library/react";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useLabelStore } from "../store/labelStore";
import type { Page } from "@zplab/core/types/Group";

afterEach(cleanup);

function key(code: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, ...init }));
}

describe("useGlobalShortcuts history", () => {
  const initial = useLabelStore.getState();
  const editedLabel = { ...initial.label, widthMm: initial.label.widthMm + 1 };

  beforeEach(() => {
    useLabelStore.setState({ ...initial, sourceEdit: { status: "off" }, previewMode: { status: "idle" } });
    useLabelStore.temporal.getState().clear();
    useLabelStore.setState({ label: editedLabel });
    useLabelStore.temporal.getState().undo();
  });

  afterEach(() => {
    useLabelStore.setState(initial);
    useLabelStore.temporal.getState().clear();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("Y redoes one design edit and prevents the browser default with %j", (modifier) => {
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(document.body, { code: "KeyY", ...modifier })).toBe(false);
    expect(useLabelStore.getState().label).toEqual(editedLabel);
    expect(useLabelStore.temporal.getState().futureStates).toHaveLength(0);
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(1);
  });
});

// Regression: bare S/R toggle snap / rotate the view, but with a modifier they
// must stay inert (Ctrl+S / Ctrl+R belong to the browser, like the G guard).
describe("useGlobalShortcuts modifier guards", () => {
  const initialCanvasSettings = useLabelStore.getState().canvasSettings;

  beforeEach(() => {
    useLabelStore.setState({ canvasSettings: initialCanvasSettings });
  });
  it("bare S toggles snap; Ctrl+S does not", () => {
    renderHook(() => useGlobalShortcuts());
    const before = useLabelStore.getState().canvasSettings.snapEnabled;
    key("KeyS");
    expect(useLabelStore.getState().canvasSettings.snapEnabled).toBe(!before);
    key("KeyS", { ctrlKey: true });
    expect(useLabelStore.getState().canvasSettings.snapEnabled).toBe(!before);
  });

  it("bare R rotates the view; Ctrl+R does not", () => {
    renderHook(() => useGlobalShortcuts());
    const before = useLabelStore.getState().canvasSettings.viewRotation;
    key("KeyR");
    const rotated = useLabelStore.getState().canvasSettings.viewRotation;
    expect(rotated).not.toBe(before);
    key("KeyR", { ctrlKey: true });
    expect(useLabelStore.getState().canvasSettings.viewRotation).toBe(rotated);
  });
});

describe("useGlobalShortcuts paging", () => {
  const initial = useLabelStore.getState();

  afterEach(() => {
    useLabelStore.setState({
      pages: initial.pages,
      currentPageIndex: initial.currentPageIndex,
      sourceEdit: initial.sourceEdit,
      sourceShadow: initial.sourceShadow,
    });
  });

  // The stored index can lie past a draft with fewer pages.
  it("Page Up steps back from the page on screen", () => {
    const pages = (count: number) => Array.from({ length: count }, () => ({ objects: [] })) as Page[];
    useLabelStore.setState({
      pages: pages(3),
      currentPageIndex: 2,
      sourceEdit: { status: "editing", draft: "", baseline: "", session: 1 },
      sourceShadow: {
        doc: { label: initial.label, pages: pages(2), variables: [], columnMapping: null },
        refusal: null,
        findings: [],
        draft: "",
      },
    });
    renderHook(() => useGlobalShortcuts());
    key("PageUp");
    expect(useLabelStore.getState().currentPageIndex).toBe(0);
  });
});
