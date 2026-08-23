import { describe, it, expect, vi } from "vitest";
import { buildContextMenu, type ContextMenuCtx } from "./canvasActions";

const dispatch = () => ({
  copy: vi.fn(), cut: vi.fn(), duplicate: vi.fn(), remove: vi.fn(),
  pasteHere: vi.fn(), reorder: vi.fn(), group: vi.fn(), ungroup: vi.fn(),
  toggleLock: vi.fn(), addHere: vi.fn(), switchType: vi.fn(), copyZplSelected: vi.fn(),
  copyZplLabel: vi.fn(), copyImage: vi.fn(), exportImage: vi.fn(), selectAll: vi.fn(),
});

const ctx = (over: Partial<ContextMenuCtx> = {}): ContextMenuCtx => ({
  onObject: true, hasSelection: true, canGroup: false, canUngroup: false,
  canDelete: true, locked: false, hasClipboard: false, hasObjects: true,
  editorFrozen: false,
  addableGroups: [{ id: "text", label: "Text", types: [{ id: "text", type: "text", label: "Text" }] }],
  switchTypeGroups: [],
  switchTypeLocked: false,
  dispatch: dispatch(), ...over,
});

const switchGroups = () => [
  { id: "code-1d", label: "1D", types: [
    { type: "code39", label: "Code 39" },
    { type: "ean13", label: "EAN-13", disabled: true, tooltip: "Digits only" },
  ] },
];

const ids = (sections: ReturnType<typeof buildContextMenu>) =>
  sections.flatMap((s) => s.items.map((i) => i.id));

describe("buildContextMenu", () => {
  it("object menu has clipboard, order, arrange, export sections", () => {
    const got = ids(buildContextMenu(ctx()));
    expect(got).toEqual(expect.arrayContaining(["copy", "cut", "duplicate", "delete", "toFront", "toBack", "lock", "copyZplSelected", "copyImage", "exportImage"]));
  });

  it("empty menu offers paste-here, add-here submenu, select-all, label export", () => {
    const sections = buildContextMenu(ctx({ onObject: false, hasSelection: false }));
    const got = ids(sections);
    expect(got).toEqual(expect.arrayContaining(["pasteHere", "addHere", "selectAll", "copyZplLabel"]));
    const addHere = sections.flatMap((s) => s.items).find((i) => i.id === "addHere");
    // Second level is the category group, third level the addable types.
    expect(addHere?.submenu?.map((s) => s.id)).toEqual(["addgrp:text"]);
    expect(addHere?.submenu?.[0]?.submenu?.map((s) => s.id)).toEqual(["add:text"]);
  });

  it("add-here type runs addHere with its type and propsOverride", () => {
    const d = dispatch();
    const sections = buildContextMenu(ctx({ onObject: false, hasSelection: false, dispatch: d }));
    const addHere = sections.flatMap((s) => s.items).find((i) => i.id === "addHere");
    addHere?.submenu?.[0]?.submenu?.[0]?.run?.();
    expect(d.addHere).toHaveBeenCalledWith("text", undefined);
  });

  it("add-here preset uses its id and passes propsOverride", () => {
    const d = dispatch();
    const sections = buildContextMenu(ctx({
      onObject: false, hasSelection: false, dispatch: d,
      addableGroups: [{ id: "shape", label: "Shapes", types: [
        { id: "line-diagonal", type: "line", label: "Diagonal line", propsOverride: { angle: 45 } },
      ] }],
    }));
    const addHere = sections.flatMap((s) => s.items).find((i) => i.id === "addHere");
    expect(addHere?.submenu?.[0]?.submenu?.map((s) => s.id)).toEqual(["add:line-diagonal"]);
    addHere?.submenu?.[0]?.submenu?.[0]?.run?.();
    expect(d.addHere).toHaveBeenCalledWith("line", { angle: 45 });
  });

  it("shows group only when canGroup, ungroup only when canUngroup", () => {
    expect(ids(buildContextMenu(ctx({ canGroup: true })))).toContain("group");
    expect(ids(buildContextMenu(ctx({ canGroup: true })))).not.toContain("ungroup");
    expect(ids(buildContextMenu(ctx({ canUngroup: true })))).toContain("ungroup");
  });

  it("lock label flips to unlock when locked", () => {
    const lock = buildContextMenu(ctx({ locked: true })).flatMap((s) => s.items).find((i) => i.id === "lock");
    expect(lock?.labelKey).toBe("unlock");
  });

  it("disables everything while the editor is frozen", () => {
    const sections = buildContextMenu(ctx({ editorFrozen: true }));
    expect(sections.flatMap((s) => s.items).every((i) => i.disabled)).toBe(true);
  });

  it("paste-here disabled without clipboard, enabled with", () => {
    const noClip = buildContextMenu(ctx({ onObject: false, hasSelection: false, hasClipboard: false }));
    expect(noClip.flatMap((s) => s.items).find((i) => i.id === "pasteHere")?.disabled).toBe(true);
    const clip = buildContextMenu(ctx({ onObject: false, hasSelection: false, hasClipboard: true }));
    expect(clip.flatMap((s) => s.items).find((i) => i.id === "pasteHere")?.disabled).toBe(false);
  });

  it("run invokes the matching dispatcher", () => {
    const d = dispatch();
    const sections = buildContextMenu(ctx({ dispatch: d }));
    sections.flatMap((s) => s.items).find((i) => i.id === "duplicate")?.run?.();
    expect(d.duplicate).toHaveBeenCalledOnce();
    sections.flatMap((s) => s.items).find((i) => i.id === "toFront")?.run?.();
    expect(d.reorder).toHaveBeenCalledWith("front");
  });

  it("switch-type renders group/type submenus and passes disabled + tooltip through", () => {
    const sections = buildContextMenu(ctx({ switchTypeGroups: switchGroups() }));
    const entry = sections.flatMap((s) => s.items).find((i) => i.id === "switchType");
    expect(entry?.submenu?.map((s) => s.id)).toEqual(["switchgrp:code-1d"]);
    const types = entry?.submenu?.[0]?.submenu;
    expect(types?.map((s) => s.id)).toEqual(["switch:code39", "switch:ean13"]);
    expect(types?.[1]).toMatchObject({ disabled: true, tooltip: "Digits only" });
    expect(types?.[0]?.disabled).toBe(false);
  });

  it("switch-type run dispatches the target type; absent without targets", () => {
    const d = dispatch();
    const sections = buildContextMenu(ctx({ switchTypeGroups: switchGroups(), dispatch: d }));
    sections.flatMap((s) => s.items).find((i) => i.id === "switchType")
      ?.submenu?.[0]?.submenu?.[0]?.run?.();
    expect(d.switchType).toHaveBeenCalledWith("code39");
    expect(ids(buildContextMenu(ctx()))).not.toContain("switchType");
  });

  it("switch-type disables on the candidate's lock, independent of the selection lock", () => {
    const sections = buildContextMenu(ctx({ switchTypeGroups: switchGroups(), switchTypeLocked: true }));
    expect(sections.flatMap((s) => s.items).find((i) => i.id === "switchType")?.disabled).toBe(true);
  });
});
