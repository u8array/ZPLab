import { describe, it, expect, beforeEach } from "vitest";
import { isGroup } from "@zplab/core/types/Group";
import { useLabelStore } from "./labelStore";
import { patchCustomFontMapping } from "@zplab/core/lib/customFonts";
import { defined, props } from "../test/helpers";

const state = () => useLabelStore.getState();
const history = () => useLabelStore.temporal.getState();
const firstId = () => defined(state().pages[0]?.objects[0]).id;
const groupTwoTexts = () => {
  state().addObject("text", { x: 10, y: 10 });
  state().addObject("text", { x: 40, y: 40 });
  state().selectObjects(defined(state().pages[0]).objects.map((o) => o.id));
  state().groupSelection();
  const group = defined(state().pages[0]?.objects[0]);
  if (!isGroup(group)) throw new Error("expected group");
  return group.children.map((c) => c.id);
};

beforeEach(() => {
  useLabelStore.setState({
    pages: [{ objects: [] }],
    selectedIds: [],
    label: { widthMm: 100, heightMm: 60, dpmm: 8 },
  });
  history().clear();
});

describe("a write that changes nothing", () => {
  it("a rejected write records no undo step and keeps the redo stack", () => {
    state().addObject("text", { x: 10, y: 10 });
    const id = firstId();
    state().selectObjects([id]);
    state().setSelectionLocked(true);
    history().clear();
    state().addObject("text", { x: 40, y: 40 });
    history().undo();
    expect(history().futureStates).toHaveLength(1);

    state().updateObjects([{ id, changes: { x: 30 } }]);
    expect(history().pastStates).toHaveLength(0);
    expect(history().futureStates).toHaveLength(1);
  });

  it("a locked group's leaves take no nudge and no step", () => {
    const leafIds = groupTwoTexts();
    state().setSelectionLocked(true);
    history().clear();
    state().updateObjects(leafIds.map((id) => ({ id, changes: { x: 99 } })));
    expect(history().pastStates).toHaveLength(0);
  });

  it("records no step for an object written with the values it holds", () => {
    state().addObject("text", { x: 10, y: 10 });
    const obj = defined(state().pages[0]?.objects[0]);
    history().clear();
    state().updateObject(obj.id, { x: obj.x, props: { ...props(obj) } });
    expect(history().pastStates).toHaveLength(0);
    expect(state().pages[0]?.objects[0]).toBe(obj);
  });

  it("records no step for a label setting written with its own value", () => {
    state().setLabelConfig({ widthMm: 100 });
    expect(history().pastStates).toHaveLength(0);
    state().setLabelConfig({ widthMm: 100, heightMm: 70 });
    expect(history().pastStates).toHaveLength(1);
    expect(state().label.heightMm).toBe(70);
  });

  it("records no step for a list setting rebuilt with the same content", () => {
    state().setLabelConfig({ rfidEpcBits: 96, rfidEpcPartitions: [1, 2, 93] });
    history().clear();
    state().setLabelConfig({ rfidEpcPartitions: [1, 2, 93] });
    expect(history().pastStates).toHaveLength(0);
  });

  it("records no step for a font mapping saved with the values it holds", () => {
    const fonts = [{ alias: "A", path: "E:A.TTF" }];
    state().setLabelConfig({ customFonts: fonts });
    history().clear();
    state().setLabelConfig({ customFonts: fonts.map((m) => patchCustomFontMapping(m, { alias: "A" })) });
    expect(history().pastStates).toHaveLength(0);
  });

  it("records no step for a ^JM density written with its own value", () => {
    state().rescaleJmDensity(undefined);
    expect(history().pastStates).toHaveLength(0);
  });

  it("records no step and keeps the selection when nothing can be duplicated", () => {
    const child = defined(groupTwoTexts()[0]);
    state().selectObjects([child]);
    history().clear();
    state().duplicateSelectedObjects();
    expect(history().pastStates).toHaveLength(0);
    expect(state().selectedIds).toEqual([child]);
  });

  it("records no step for a delete that only meets locked objects", () => {
    state().addObject("text", { x: 10, y: 10 });
    state().selectObjects([firstId()]);
    state().setSelectionLocked(true);
    const selected = state().selectedIds;
    history().clear();
    state().removeSelectedObjects();
    expect(history().pastStates).toHaveLength(0);
    expect(state().selectedIds).toBe(selected);
  });
});
