import { describe, it, expect, beforeEach } from "vitest";
import { useLabelStore } from "./labelStore";
import { applyDesignOps, type DesignDoc } from "@zplab/core/lib/designOps";
import type { LabelObject, Page } from "@zplab/core/types/Group";

const text = (id: string, content: string): LabelObject =>
  ({ id, type: "text", x: 10, y: 10, rotation: 0, props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as never;
const overlay = { segments: [], v: 3, regenSafe: true } as never;
/** The store's set stamps `dirty` on every object whose bytes changed. The reducer leaves that to its caller's set. */
const modelOf = (pages: readonly Page[]) => pages.map((p) => ({ ...p, objects: p.objects.map(({ dirty: _dirty, ...o }) => o) }));

/** The editor's variable actions and the op reducer must agree, or an agent edit drifts from a panel edit. */
describe("variable ops agree between the editor slice and the design op reducer", () => {
  const state = () => useLabelStore.getState();
  const doc = (): DesignDoc => ({
    label: state().label,
    pages: state().pages,
    variables: state().variables,
    columnMapping: state().columnMapping,
  });

  beforeEach(() => {
    useLabelStore.setState({
      label: { widthMm: 100, heightMm: 60, dpmm: 8 },
      pages: [{ objects: [text("a", "Lot «lot» / «sku»")], overlay } as Page, { objects: [text("b", "plain")], overlay } as Page],
      // The slice addresses by id, the reducer by name, so both must be spelled out.
      variables: [
        { id: "v1", name: "lot", fnNumber: 1, defaultValue: "L1" },
        { id: "v2", name: "sku", fnNumber: 2, defaultValue: "S" },
      ],
      columnMapping: { bindings: { v1: "A", v2: "B" } } as never,
      sourceEdit: { status: "off" },
      previewMode: { status: "idle" },
    });
  });

  it("rename plus default change", () => {
    const viaReducer = applyDesignOps(doc(), [{ op: "updateVariable", name: "lot", newName: "batch", defaultValue: "«L2»" }], () => null);
    state().updateVariable("v1", { name: "batch", defaultValue: "«L2»" });
    expect(viaReducer.ok).toBe(true);
    if (!viaReducer.ok) return;
    expect(viaReducer.doc.variables).toEqual(state().variables);
    expect(modelOf(viaReducer.doc.pages)).toEqual(modelOf(state().pages));
  });

  it("rename alone keeps the captures on both paths", () => {
    const viaReducer = applyDesignOps(doc(), [{ op: "updateVariable", name: "lot", newName: "batch" }], () => null);
    state().updateVariable("v1", { name: "batch" });
    expect(viaReducer.ok && modelOf(viaReducer.doc.pages)).toEqual(modelOf(state().pages));
    expect(state().pages.every((p) => p.overlay !== undefined)).toBe(true);
  });

  it("remove", () => {
    const viaReducer = applyDesignOps(doc(), [{ op: "removeVariable", name: "lot" }], () => null);
    state().removeVariable("v1");
    expect(viaReducer.ok).toBe(true);
    if (!viaReducer.ok) return;
    expect(viaReducer.doc.variables).toEqual(state().variables);
    expect(modelOf(viaReducer.doc.pages)).toEqual(modelOf(state().pages));
    expect(viaReducer.doc.columnMapping).toEqual(state().columnMapping);
  });

  it("add: the reducer still drops every capture, the editor keeps them", () => {
    const viaReducer = applyDesignOps(doc(), [{ op: "addVariable", variable: { name: "qty" } }], () => null);
    state().addVariable({ name: "qty" });
    expect(viaReducer.ok && viaReducer.doc.variables.map((v) => v.name)).toEqual(state().variables.map((v) => v.name));
    // A new variable is referenced by no field, so no ^FN line changes. patch_design dropped every capture here before this refactor too.
    expect(viaReducer.ok && viaReducer.doc.pages.every((p) => p.overlay === undefined)).toBe(true);
    expect(state().pages.every((p) => p.overlay !== undefined)).toBe(true);
  });
});
