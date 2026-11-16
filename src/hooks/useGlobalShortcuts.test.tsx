// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, renderHook, cleanup, fireEvent } from "@testing-library/react";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useLabelStore } from "../store/labelStore";
import type { Page } from "@zplab/core/types/Group";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";

afterEach(cleanup);

function key(code: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, ...init }));
}

describe("typing into the selection", () => {
  const initial = useLabelStore.getState();
  beforeEach(() => {
    useLabelStore.setState({ ...initial, pages: [{ objects: [] }], currentPageIndex: 0, sourceEdit: { status: "off" }, previewMode: { status: "idle" } });
    useLabelStore.getState().addObject("text");
  });
  afterEach(() => {
    useLabelStore.setState(initial);
    useLabelStore.temporal.getState().clear();
  });
  const content = () => getObjectStringContent(useLabelStore.getState().pages[0]!.objects[0]!);

  it("types shortcut letters and spaces, backspaces whole graphemes and markers, and keeps view settings", () => {
    renderHook(() => useGlobalShortcuts());
    for (const character of "gSr ") fireEvent.keyDown(document.body, { key: character, code: character === " " ? "Space" : `Key${character.toUpperCase()}` });
    expect(content()).toBe("gSr ");
    expect(useLabelStore.getState().canvasSettings).toEqual(initial.canvasSettings);
    const id = useLabelStore.getState().selectedIds[0]!;
    useLabelStore.getState().updateObject(id, { props: { content: "A👩‍💻«sku»" } });
    fireEvent.keyDown(document.body, { key: "Backspace", code: "Backspace" });
    expect(content()).toBe("A👩‍💻");
    fireEvent.keyDown(document.body, { key: "Backspace", code: "Backspace" });
    expect(content()).toBe("A");
  });

  it("uses barcode charset and length rules", () => {
    useLabelStore.getState().addObject("ean13");
    renderHook(() => useGlobalShortcuts());
    for (const character of "g1234567890123456789") fireEvent.keyDown(document.body, { key: character, code: character === "g" ? "KeyG" : `Digit${character}` });
    expect(getObjectStringContent(useLabelStore.getState().pages[0]!.objects[1]!)).toBe("123456789012");
    expect(useLabelStore.getState().canvasSettings.showGrid).toBe(initial.canvasSettings.showGrid);
  });

  it("leaves inputs, modifiers, locked objects, multiple selections and frozen designs alone", () => {
    renderHook(() => useGlobalShortcuts());
    const { container } = render(<input />);
    const input = container.querySelector("input")!;
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    const state = useLabelStore.getState();
    state.updateObject(state.selectedIds[0]!, { locked: true });
    fireEvent.keyDown(document.body, { key: "a" });
    state.updateObject(state.selectedIds[0]!, { locked: false });
    useLabelStore.setState({ selectedIds: [...state.selectedIds, "other"] });
    fireEvent.keyDown(document.body, { key: "a" });
    useLabelStore.setState({ selectedIds: state.selectedIds, previewMode: { status: "loading" } });
    fireEvent.keyDown(document.body, { key: "a" });
    expect(content()).toBe("");
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
