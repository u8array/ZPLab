import { describe, it, expect, beforeEach } from "vitest";
import { useLabelStore } from "../labelStore";
import { serializeDesign } from "@zplab/core/lib/designFile";
import { MAX_REPLACED_DESIGN_CHARS } from "./restoreSlice";
import type { LabelObject } from "@zplab/core/types/Group";

const text = (id: string, content: string): LabelObject =>
  ({ id, type: "text", x: 10, y: 10, rotation: 0, props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as never;
const pushed = (content: string) =>
  serializeDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [text("p", content)] }]);

describe("a pushed design keeps the one it displaced", () => {
  const state = () => useLabelStore.getState();

  beforeEach(() => {
    useLabelStore.setState({
      label: { widthMm: 100, heightMm: 60, dpmm: 8 },
      pages: [{ objects: [text("a", "before"), text("b", "before too")] }],
      variables: [],
      columnMapping: null,
      replacedDesign: null,
      sourceEdit: { status: "off" },
      previewMode: { status: "idle" },
    });
    useLabelStore.temporal.getState().clear();
  });

  it("applies the push, keeps the displaced design and restores it on request", () => {
    expect(state().openPushedDesign(pushed("agent"))).toEqual({ ok: true, replacedObjects: 2, restorable: true });
    expect(state().pages[0]?.objects.map((o) => o.id)).toEqual(["p"]);
    expect(state().replacedDesign).toMatchObject({ objects: 2, source: "agent" });
    expect(state().restoreReplacedDesign()).toBe(true);
    expect(state().pages[0]?.objects.map((o) => o.id)).toEqual(["a", "b"]);
    expect(state().label.widthMm).toBe(100);
    expect(state().replacedDesign).toMatchObject({ objects: 1, source: "restore" });
  });

  it("restores by swapping", () => {
    state().openPushedDesign(pushed("agent"));
    state().restoreReplacedDesign();
    expect(state().restoreReplacedDesign()).toBe(true);
    expect(state().pages[0]?.objects.map((o) => o.id)).toEqual(["p"]);
    expect(state().replacedDesign).toMatchObject({ objects: 2, source: "agent" });
  });

  it("keeps nothing when the push is refused, and the next document replacement clears the slot", () => {
    expect(state().openPushedDesign("{\"not\":\"a design\"}").ok).toBe(false);
    expect(state().replacedDesign).toBeNull();
    state().openPushedDesign(pushed("agent"));
    expect(state().replacedDesign).not.toBeNull();
    state().loadDesign({ widthMm: 10, heightMm: 10, dpmm: 8 }, [{ objects: [] }]);
    expect(state().replacedDesign).toBeNull();
  });

  it("skips the slot past the size cap and says so", () => {
    useLabelStore.setState({ pages: [{ objects: [text("big", "x".repeat(MAX_REPLACED_DESIGN_CHARS))] }] });
    expect(state().openPushedDesign(pushed("agent"))).toEqual({ ok: true, replacedObjects: 1, restorable: false });
    expect(state().replacedDesign).toBeNull();
  });

  it("keeps nothing when the displaced document was empty", () => {
    useLabelStore.setState({ pages: [{ objects: [] }] });
    expect(state().openPushedDesign(pushed("agent"))).toEqual({ ok: true, replacedObjects: 0, restorable: false });
    expect(state().replacedDesign).toBeNull();
  });

  it("arms the slot under a clean source session and under a print preview, ending both", () => {
    useLabelStore.setState({ sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 1 } });
    expect(state().openPushedDesign(pushed("agent")).restorable).toBe(true);
    expect(state().sourceEdit.status).toBe("off");
    useLabelStore.setState({ pages: [{ objects: [text("a", "before")] }], previewMode: { status: "active", url: "blob:x" } });
    expect(state().openPushedDesign(pushed("again")).restorable).toBe(true);
    expect(state().previewMode.status).toBe("idle");
  });

  it("refuses to restore over unsaved source edits", () => {
    state().openPushedDesign(pushed("agent"));
    useLabelStore.setState({ sourceEdit: { status: "editing", draft: "^XA^FO1,1^XZ", baseline: "^XA^XZ", session: 2 } });
    expect(state().restoreReplacedDesign()).toBe(false);
    expect(state().pages[0]?.objects.map((o) => o.id)).toEqual(["p"]);
    useLabelStore.setState({ sourceEdit: { status: "off" } });
  });

  it("stays out of the undo history", () => {
    state().openPushedDesign(pushed("agent"));
    state().dismissReplacedDesign();
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
