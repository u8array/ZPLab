import { describe, it, expect, beforeEach } from "vitest";
import { useLabelStore } from "../labelStore";
import type { LabelObject, Page } from "@zplab/core/types/Group";

const text = (id: string, content: string): LabelObject =>
  ({ id, type: "text", x: 10, y: 10, rotation: 0, props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as never;
const overlay = { segments: [], v: 3, regenSafe: true } as never;

describe("an agent's op list on the live document", () => {
  const state = () => useLabelStore.getState();
  const steps = () => useLabelStore.temporal.getState().pastStates.length;

  beforeEach(() => {
    useLabelStore.setState({
      label: { widthMm: 100, heightMm: 60, dpmm: 8 },
      pages: [{ objects: [text("a", "Lot «lot»")], overlay } as Page, { objects: [text("b", "plain")] }],
      variables: [{ id: "v1", name: "lot", fnNumber: 1, defaultValue: "L1" }],
      columnMapping: null,
      selectedIds: [],
      currentPageIndex: 0,
      sourceEdit: { status: "off" },
      previewMode: { status: "idle" },
    });
    useLabelStore.temporal.getState().clear();
  });

  it("lands several ops as one undo step and shows the page it touched, with those objects selected", () => {
    const result = state().applyAgentOps([
      { op: "update", id: "b", props: { content: "changed" } },
      { op: "add", pageIndex: 1, object: { type: "text", x: 1, y: 1, props: { content: "new" } } },
      { op: "updateVariable", name: "lot", defaultValue: "L2" },
    ]);
    expect(result).toEqual({ ok: true, assignedIds: { 1: "text-3" }, capturesLost: [0], capturesAtRisk: [] });
    expect(steps()).toBe(1);
    expect(state().currentPageIndex).toBe(1);
    expect(state().selectedIds).toEqual(["b", "text-3"]);
    expect(state().pages[1]?.objects.map((o) => o.id)).toEqual(["b", "text-3"]);
    expect(state().pages[0]?.overlay).toBeUndefined();
    expect(state().variables[0]?.defaultValue).toBe("L2");
    useLabelStore.temporal.getState().undo();
    expect(state().pages[1]?.objects.map((o) => o.id)).toEqual(["b"]);
    expect(state().variables[0]?.defaultValue).toBe("L1");
  });

  it("keeps a rename from marking the object dirty", () => {
    useLabelStore.setState({ pages: [{ objects: [text("a", "Lot «lot»")], overlay: { segments: [], v: 3, regenSafe: false } } as never] });
    const result = state().applyAgentOps([{ op: "updateVariable", name: "lot", newName: "batch" }]);
    expect(result).toMatchObject({ ok: true, capturesLost: [], capturesAtRisk: [] });
    expect(state().pages[0]?.objects[0]).toMatchObject({ props: { content: "Lot «batch»" } });
    expect((state().pages[0]?.objects[0] as { dirty?: boolean }).dirty).toBeUndefined();
    expect(state().pages[0]?.overlay).toBeDefined();
  });

  it("reports the page whose captured import bytes cannot be replayed around the edit", () => {
    useLabelStore.setState({ pages: [{ objects: [text("a", "x")], overlay: { segments: [], v: 3, regenSafe: false } } as never] });
    const result = state().applyAgentOps([{ op: "update", id: "a", x: 20 }]);
    expect(result).toMatchObject({ ok: true, capturesLost: [], capturesAtRisk: [0] });
    expect(state().pages[0]?.overlay).toBeDefined();
  });

  it("drops a removed object from the selection", () => {
    useLabelStore.setState({ selectedIds: ["a"] });
    expect(state().applyAgentOps([{ op: "remove", id: "a" }]).ok).toBe(true);
    expect(state().selectedIds).toEqual([]);
  });

  it("keeps the selection through a variable-only edit", () => {
    useLabelStore.setState({ selectedIds: ["a"] });
    expect(state().applyAgentOps([{ op: "updateVariable", name: "lot", comment: "c" }]).ok).toBe(true);
    expect(state().selectedIds).toEqual(["a"]);
  });

  it("writes nothing when one op fails, and names the op", () => {
    const before = state().pages;
    const result = state().applyAgentOps([
      { op: "update", id: "a", x: 5 },
      { op: "remove", id: "missing" },
    ]);
    expect(result).toEqual({ ok: false, reason: "invalid", errors: ["No object with id missing"], opIndex: 1 });
    expect(state().pages).toBe(before);
    expect(steps()).toBe(0);
  });

  it("refuses an add that would push the design past the size cap, before anything lands", () => {
    const many = Array.from({ length: 10000 }, (_, i) => text(`o${i}`, "x"));
    useLabelStore.setState({ pages: [{ objects: many }] });
    useLabelStore.temporal.getState().clear();
    const before = state().pages;
    const result = state().applyAgentOps([{ op: "add", object: { type: "text", x: 1, y: 1, props: { content: "one too many" } } }]);
    expect(result).toMatchObject({ ok: false, reason: "invalid", errors: [expect.stringContaining("10000-object limit")] });
    expect(state().pages).toBe(before);
    expect(steps()).toBe(0);
  });

  it("refuses under a source session or a print preview instead of returning ok for nothing", () => {
    useLabelStore.setState({ sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 1 } });
    expect(state().applyAgentOps([{ op: "remove", id: "a" }])).toMatchObject({ ok: false, reason: "frozen" });
    useLabelStore.setState({ sourceEdit: { status: "off" }, previewMode: { status: "active", url: "blob:x" } });
    expect(state().applyAgentOps([{ op: "remove", id: "a" }])).toMatchObject({ ok: false, reason: "frozen" });
    expect(state().pages[0]?.objects).toHaveLength(1);
    useLabelStore.setState({ previewMode: { status: "idle" } });
  });
});
