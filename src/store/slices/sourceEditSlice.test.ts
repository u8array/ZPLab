import { describe, it, expect, beforeEach } from "vitest";
import { useLabelStore } from "../labelStore";
import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { prepareSourceApply } from "@zplab/core/lib/zplSourceEdit";
import type { ColumnMapping, Variable } from "@zplab/core/types/Variable";
import type { LabelObject, Page } from "@zplab/core/types/Group";

const variables: Variable[] = [{ id: "v1", name: "LOT", fnNumber: 1, defaultValue: "L42" }];
const textObject = (id: string, content: string): LabelObject =>
  ({
    id, type: "text", x: 10, y: 10, rotation: 0,
    props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" },
  }) as never;
const basePages: Page[] = [{ objects: [textObject("t1", "Lot «LOT»")] }];

const currentSnapshot = () => {
  const s = useLabelStore.getState();
  return {
    label: s.label,
    pages: s.pages,
    variables: s.variables,
    printerProfile: s.printerProfile,
    columnMapping: s.columnMapping,
  };
};

const liveSession = (): number => {
  const se = useLabelStore.getState().sourceEdit;
  return se.status === "editing" ? se.session : -1;
};

const applyCurrentZpl = (mutate?: (zpl: string) => string) => {
  const s = useLabelStore.getState();
  const zpl = generateMultiPageZPL(s.label, s.pages, s.variables);
  s.enterSourceEdit(zpl);
  const plan = prepareSourceApply({ text: mutate ? mutate(zpl) : zpl, current: currentSnapshot() });
  expect(plan.ok).toBe(true);
  if (plan.ok) useLabelStore.getState().applyZplSource(plan, liveSession());
  return plan;
};

beforeEach(() => {
  useLabelStore.setState({
    label: { widthMm: 70, heightMm: 40, dpmm: 8 },
    pages: basePages,
    variables,
    currentPageIndex: 0,
    selectedIds: [],
    columnMapping: null,
    dataset: null,
    printerProfile: {},
    previewMode: { status: "idle" },
    sourceEdit: { status: "off" },
  });
  useLabelStore.temporal.getState().clear();
});

describe("applyZplSource", () => {
  it("is exactly one undo step and undo restores the overlays", () => {
    const before = useLabelStore.getState().pages;
    expect(before[0]?.overlay).toBeUndefined();
    applyCurrentZpl();
    const after = useLabelStore.getState().pages;
    expect(after[0]?.overlay).toBeDefined();
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(1);
    useLabelStore.temporal.getState().undo();
    expect(useLabelStore.getState().pages).toBe(before);
  });

  it("does not clear earlier history", () => {
    useLabelStore.setState({ selectedIds: [] });
    useLabelStore.getState().setLabelConfig({ widthMm: 80 });
    const depth = useLabelStore.temporal.getState().pastStates.length;
    applyCurrentZpl();
    expect(useLabelStore.temporal.getState().pastStates.length).toBe(depth + 1);
  });

  it("keeps the dataset and remaps the mapping onto the new variable ids", () => {
    const dataset = {
      headers: ["lot"],
      rows: [["A1"]],
      activeRowIndex: 0,
      source: { kind: "csv", fileName: "x.csv", importedAt: 0 },
    } as never;
    const mapping: ColumnMapping = { bindings: { v1: "lot" }, headerSnapshot: ["lot"] };
    useLabelStore.setState({ dataset, columnMapping: mapping });
    applyCurrentZpl();
    const s = useLabelStore.getState();
    expect(s.dataset).toBe(dataset);
    const boundIds = Object.keys(s.columnMapping?.bindings ?? {});
    expect(boundIds).toHaveLength(1);
    const newVar = s.variables.find((v) => v.fnNumber === 1);
    expect(newVar).toBeDefined();
    expect(boundIds[0]).toBe(newVar?.id);
  });
});

describe("the source-edit freeze", () => {
  it("blocks model mutations and history while editing", () => {
    useLabelStore.getState().enterSourceEdit("^XA^XZ");
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
    const pagesBefore = useLabelStore.getState().pages;
    useLabelStore.getState().setLabelConfig({ widthMm: 99 });
    useLabelStore.getState().addObject("text");
    useLabelStore.getState().removeSelectedObjects();
    useLabelStore.getState().selectObject("t1");
    expect(useLabelStore.getState().label.widthMm).toBe(70);
    expect(useLabelStore.getState().pages).toBe(pagesBefore);
    expect(useLabelStore.getState().selectedIds).toEqual([]);
  });

  it("cannot be entered under the preview lock", () => {
    useLabelStore.setState({ previewMode: { status: "active", url: "blob:x" } });
    useLabelStore.getState().enterSourceEdit("^XA^XZ");
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
  });

  it("lets a stale plan die with its session instead of overwriting a replacement document", () => {
    const s = useLabelStore.getState();
    const zpl = generateMultiPageZPL(s.label, s.pages, s.variables);
    s.enterSourceEdit(zpl);
    const sessionA = liveSession();
    const plan = prepareSourceApply({ text: zpl, current: currentSnapshot() });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // A loadDesign under the open confirm dialog (MCP open-draft, File>Open)
    // cancels the session; the held plan was built against the old document.
    const newPages: Page[] = [{ objects: [] }];
    useLabelStore
      .getState()
      .loadDesign({ widthMm: 100, heightMm: 50, dpmm: 8 }, newPages, []);
    useLabelStore.getState().applyZplSource(plan, sessionA);
    expect(useLabelStore.getState().label.widthMm).toBe(100);
    expect(useLabelStore.getState().pages).toBe(newPages);
    // Even a NEW live session must refuse the old session's plan.
    useLabelStore.getState().enterSourceEdit("^XA^XZ");
    useLabelStore.getState().applyZplSource(plan, sessionA);
    expect(useLabelStore.getState().pages).toBe(newPages);
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
  });

  it("blocks the mapping mutators while editing", () => {
    useLabelStore.getState().enterSourceEdit("^XA^XZ");
    const before = useLabelStore.getState();
    useLabelStore.getState().setColumnMapping({ bindings: {}, headerSnapshot: [] });
    useLabelStore.getState().applyMappingDraft({
      variables: [{ id: "v9", name: "X", fnNumber: 9, defaultValue: "" }],
      dataset: { headers: [], rows: [], source: { kind: "csv", fileName: "x", importedAt: 0 } } as never,
      mapping: { bindings: {}, headerSnapshot: [] },
      activeRowIndex: 0,
    });
    useLabelStore
      .getState()
      .restoreDataSnapshot({ dataset: null, dataSourceRef: null, columnMapping: null });
    const after = useLabelStore.getState();
    expect(after.columnMapping).toBe(before.columnMapping);
    expect(after.variables).toBe(before.variables);
    expect(after.pages).toBe(before.pages);
  });

  it("blocks entering the preview while editing", async () => {
    useLabelStore.setState({ labelaryApiKeyLoaded: true } as never);
    useLabelStore.getState().enterSourceEdit("^XA^XZ");
    await useLabelStore.getState().enterPreviewMode();
    expect(useLabelStore.getState().previewMode.status).toBe("idle");
  });

  it("is discarded by loadDesign", () => {
    useLabelStore.getState().enterSourceEdit("^XA^XZ");
    useLabelStore
      .getState()
      .loadDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [] }], []);
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
  });
});
