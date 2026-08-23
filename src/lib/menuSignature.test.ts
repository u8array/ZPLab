import { describe, it, expect } from "vitest";
import { buildMenuModel, type MenuFlags } from "./menuModel";
import { menuStructureKey, menuContentSignature } from "./menuSignature";
import { fallbackTranslations as en } from "../locales";
import type { HistorySubmenu } from "./menuModel";

const FLAGS: MenuFlags = {
  hasObjects: true,
  documentEmits: true,
  sourceEditing: false,
  canBatchExport: false,
  batchRowCount: 0,
  batchPrintCount: 0,
  connectDataWizard: false,
  labelaryEnabled: true,
  canUndo: true,
  canRedo: false,
  includeQuit: true,
};

const LABELS = { file: "File", edit: "Edit", help: "Help", quit: "Quit" };
const HISTORY: HistorySubmenu = {
  label: "History",
  clearLabel: "Clear",
  canClear: true,
  items: [
    { index: 0, label: "Initial", current: false, enabled: true },
    { index: 1, label: "Add text", current: true, enabled: false },
  ],
};

// The structure key drives rebuild (menubar swap, flickers) vs in-place patch.
// The flicker fix hinges on labels/enabled/history NOT moving it, while the
// item set and OS theme DO. These lock that split (regression: menu flicker).
describe("menuStructureKey", () => {
  it("is stable when only enabled flags change (patch, no rebuild)", () => {
    const a = menuStructureKey(false, buildMenuModel(en, FLAGS));
    const b = menuStructureKey(false, buildMenuModel(en, { ...FLAGS, hasObjects: false }));
    expect(a).toBe(b);
  });

  it("is stable when a dynamic label changes, e.g. the batch row count", () => {
    const withCsv = { ...FLAGS, canBatchExport: true, batchRowCount: 7 };
    const a = menuStructureKey(false, buildMenuModel(en, withCsv));
    const b = menuStructureKey(false, buildMenuModel(en, { ...withCsv, batchRowCount: 9 }));
    expect(a).toBe(b);
  });

  it("changes when the OS theme flips (icons must re-rasterize)", () => {
    const model = buildMenuModel(en, FLAGS);
    expect(menuStructureKey(false, model)).not.toBe(menuStructureKey(true, model));
  });

  it("changes when the item set changes (add/remove forces a rebuild)", () => {
    const base = menuStructureKey(false, buildMenuModel(en, FLAGS));
    expect(menuStructureKey(false, buildMenuModel(en, { ...FLAGS, canBatchExport: true, batchRowCount: 1 }))).not.toBe(base);
    expect(menuStructureKey(false, buildMenuModel(en, { ...FLAGS, labelaryEnabled: false }))).not.toBe(base);
    expect(menuStructureKey(false, buildMenuModel(en, { ...FLAGS, includeQuit: false }))).not.toBe(base);
  });

  it("changes when the mac app-menu label changes (macOS locale switch rebuilds)", () => {
    const model = buildMenuModel(en, FLAGS);
    expect(menuStructureKey(false, model, "Quit")).not.toBe(menuStructureKey(false, model, "Beenden"));
    expect(menuStructureKey(false, model)).toBe(menuStructureKey(false, model));
  });
});

describe("menuContentSignature", () => {
  const model = buildMenuModel(en, FLAGS);
  const base = menuContentSignature(false, LABELS, model, HISTORY);

  it("changes when a submenu label changes (locale switch)", () => {
    expect(menuContentSignature(false, { ...LABELS, edit: "Bearbeiten" }, model, HISTORY)).not.toBe(base);
  });

  it("changes when an enabled flag changes", () => {
    const other = buildMenuModel(en, { ...FLAGS, hasObjects: false });
    expect(menuContentSignature(false, LABELS, other, HISTORY)).not.toBe(base);
  });

  it("changes when a history step's checkmark or label moves", () => {
    const moved: HistorySubmenu = {
      ...HISTORY,
      items: [
        { index: 0, label: "Initial", current: true, enabled: false },
        { index: 1, label: "Add text", current: false, enabled: true },
      ],
    };
    expect(menuContentSignature(false, LABELS, model, moved)).not.toBe(base);
  });

  it("is stable for identical content", () => {
    expect(menuContentSignature(false, LABELS, buildMenuModel(en, FLAGS), HISTORY)).toBe(base);
  });
});
