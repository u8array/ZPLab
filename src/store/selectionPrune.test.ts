import { describe, it, expect, beforeEach } from "vitest";
import { useLabelStore } from "./labelStore";
import { defined } from "../test/helpers";

const state = () => useLabelStore.getState();
const history = () => useLabelStore.temporal.getState();
const addTwoTexts = () => {
  state().addObject("text", { x: 10, y: 10 });
  state().addObject("text", { x: 40, y: 40 });
  return defined(state().pages[0]).objects.map((o) => o.id);
};

beforeEach(() => {
  useLabelStore.setState({ pages: [{ objects: [] }], selectedIds: [] });
  history().clear();
});

describe("the selection", () => {
  it("drops ids whose objects an undo took away", () => {
    const ids = addTwoTexts();
    state().selectObjects(ids);
    history().clear();
    state().duplicateSelectedObjects();
    expect(state().selectedIds).toHaveLength(2);
    expect(state().selectedIds).not.toEqual(ids);
    history().undo();
    expect(state().selectedIds).toEqual([]);
  });

  it("drops ids whose objects a redo took away", () => {
    const ids = addTwoTexts();
    state().selectObjects(ids);
    history().clear();
    state().removeSelectedObjects();
    history().undo();
    state().selectObjects(ids);
    history().redo();
    expect(state().selectedIds).toEqual([]);
  });

  it("keeps ids whose objects survive the step", () => {
    const [id] = addTwoTexts();
    state().selectObjects([defined(id)]);
    history().clear();
    state().updateObjects([{ id: defined(id), changes: { x: 20 } }]);
    history().undo();
    expect(state().selectedIds).toEqual([id]);
  });

  it("drops the id a single remove took away", () => {
    const ids = addTwoTexts();
    state().selectObjects(ids);
    state().removeObject(defined(ids[0]));
    expect(state().selectedIds).toEqual([ids[1]]);
  });
});
