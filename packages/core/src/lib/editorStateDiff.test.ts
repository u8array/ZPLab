import { describe, it, expect } from "vitest";
import { diffEditorState, editorLossAxes, hasEditorLoss } from "./editorStateDiff";
import { remapBindingsByFn } from "./variableBinding";
import type { LabelObject, Page } from "../types/Group";
import type { ColumnMapping, Variable } from "../types/Variable";

const leaf = (id: string, extra: Partial<LabelObject> = {}): LabelObject =>
  ({ id, type: "text", x: 0, y: 0, rotation: 0, props: { content: "x" }, ...extra }) as never;

const page = (objects: LabelObject[]): Page => ({ objects });

const vari = (id: string, name: string, fnNumber: number): Variable => ({
  id,
  name,
  fnNumber,
  defaultValue: "",
});

const snapshot = (pages: Page[], variables: Variable[] = []) => ({ pages, variables });

describe("what a reparse cannot carry over", () => {
  it("counts a dissolved group", () => {
    const grouped: LabelObject = {
      id: "g",
      type: "group",
      children: [leaf("a"), leaf("b")],
    } as never;
    const d = diffEditorState(snapshot([page([grouped])]), snapshot([page([leaf("a2"), leaf("b2")])]));
    expect(d.groupsDissolved).toBe(1);
    expect(hasEditorLoss(d)).toBe(true);
  });

  it("counts lost names and reset flags each on their own axis", () => {
    const before = [
      leaf("a", { name: "price tag" }),
      leaf("b", { locked: true }),
      leaf("c", { visible: false }),
      leaf("d", { includeInExport: false }),
    ];
    const after = [leaf("a2"), leaf("b2"), leaf("c2"), leaf("d2")];
    const d = diffEditorState(snapshot([page(before)]), snapshot([page(after)]));
    expect(d.namesLost).toBe(1);
    expect(d.lockedLost).toBe(1);
    expect(d.hiddenLost).toBe(1);
    expect(d.excludedLost).toBe(1);
  });

  it("matches variables by ^FN slot: a gone slot is lost, a kept slot with a new name is renamed", () => {
    const d = diffEditorState(
      snapshot([page([])], [vari("v1", "LOT", 1), vari("v2", "SKU", 2)]),
      snapshot([page([])], [vari("n1", "field_1", 1)]),
    );
    expect(d.variablesLost).toEqual(["SKU"]);
    expect(d.variablesRenamed).toEqual([{ from: "LOT", to: "field_1", fnNumber: 1 }]);
    expect(hasEditorLoss(d)).toBe(true);
  });

  it("reports an export-excluded object as its own dropped axis, not a flag reset", () => {
    const d = diffEditorState(
      snapshot([page([leaf("a", { includeInExport: false }), leaf("b", { locked: true })])]),
      snapshot([page([leaf("b2")])]),
    );
    expect(editorLossAxes(d)).toEqual([
      { axis: "flags", n: 1 },
      { axis: "excluded", n: 1 },
    ]);
  });

  it("counts the whole subtree an excluded group drops, and nothing else about it", () => {
    const excludedGroup: LabelObject = {
      id: "g",
      type: "group",
      includeInExport: false,
      children: [leaf("a", { name: "kept name" }), leaf("b"), leaf("c"), leaf("d"), leaf("e")],
    } as never;
    const d = diffEditorState(snapshot([page([excludedGroup])]), snapshot([page([])]));
    expect(editorLossAxes(d)).toEqual([{ axis: "excluded", n: 6 }]);
  });

  it("a reparse that only replaces ids is not a loss", () => {
    const d = diffEditorState(snapshot([page([leaf("a")])]), snapshot([page([leaf("a2")])]));
    expect(hasEditorLoss(d)).toBe(false);
  });
});

describe("bindings survive an apply by ^FN slot", () => {
  const mapping: ColumnMapping = {
    bindings: { v1: "colA", v2: "colB" },
    headerSnapshot: ["colA", "colB"],
  };

  it("rewrites a surviving binding onto the new variable id even when the name changed", () => {
    const r = remapBindingsByFn(
      [vari("v1", "LOT", 1), vari("v2", "SKU", 2)],
      mapping,
      [vari("n1", "field_1", 1), vari("n2", "field_2", 2)],
    );
    expect(r.mapping?.bindings).toEqual({ n1: "colA", n2: "colB" });
    expect(r.remapped).toBe(2);
    expect(r.lost).toBe(0);
  });

  it("drops only the binding whose slot is gone", () => {
    const r = remapBindingsByFn([vari("v1", "LOT", 1), vari("v2", "SKU", 2)], mapping, [
      vari("n1", "LOT", 1),
    ]);
    expect(r.mapping?.bindings).toEqual({ n1: "colA" });
    expect(r.remapped).toBe(1);
    expect(r.lost).toBe(1);
    const d = diffEditorState(
      snapshot([page([])], [vari("v1", "LOT", 1), vari("v2", "SKU", 2)]),
      snapshot([page([])], [vari("n1", "LOT", 1)]),
      r.lost,
    );
    expect(d.mappingLost).toBe(1);
  });

  it("passes a null mapping through", () => {
    expect(remapBindingsByFn([], null, [])).toEqual({ mapping: null, remapped: 0, lost: 0 });
  });
});
