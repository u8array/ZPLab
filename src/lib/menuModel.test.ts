import { describe, it, expect } from "vitest";
import { buildMenuModel, type MenuFlags } from "./menuModel";
import { fallbackTranslations as en } from "../locales";

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
  includeQuit: false,
};

const ids = (m: ReturnType<typeof buildMenuModel>) => m.file.flat().map((i) => i.id);
const byId = (m: ReturnType<typeof buildMenuModel>, id: string) =>
  m.file.flat().find((i) => i.id === id);

describe("buildMenuModel", () => {
  it("keeps the dropdown's item order and sections", () => {
    const m = buildMenuModel(en, FLAGS);
    expect(ids(m)).toEqual([
      "new", "addPage", "importZpl", "settings", "exportZpl",
      "openDesign", "saveDesign", "importCsv", "print", "sendToZebra",
    ]);
    expect(m.file).toHaveLength(5);
  });

  it("gates object-dependent items on hasObjects and export/save on documentEmits", () => {
    const m = buildMenuModel(en, { ...FLAGS, hasObjects: false, documentEmits: false });
    for (const id of ["exportZpl", "saveDesign", "print", "sendToZebra"]) {
      expect(byId(m, id)?.enabled).toBe(false);
    }
    expect(byId(m, "new")?.enabled).toBe(true);
    // Overlay pages emit without objects (config-only source apply): export
    // and save stay reachable, the render-dependent items do not.
    const emits = buildMenuModel(en, { ...FLAGS, hasObjects: false, documentEmits: true });
    expect(byId(emits, "exportZpl")?.enabled).toBe(true);
    expect(byId(emits, "saveDesign")?.enabled).toBe(true);
    // A config-only overlay stream is a legitimate setup job for the device;
    // only the Labelary render stays objects-gated.
    expect(byId(emits, "sendToZebra")?.enabled).toBe(true);
    expect(byId(emits, "print")?.enabled).toBe(false);
  });

  it("disables document-replacing and emitting entries during a source-edit session", () => {
    const m = buildMenuModel(en, { ...FLAGS, sourceEditing: true });
    for (const id of ["new", "addPage", "importZpl", "openDesign", "saveDesign", "importCsv", "exportZpl", "print", "sendToZebra"]) {
      expect(byId(m, id)?.enabled, id).toBe(false);
    }
    expect(byId(m, "settings")?.enabled).toBe(true);
  });

  it("shows the batch export with the row count only when a CSV is mapped", () => {
    expect(byId(buildMenuModel(en, FLAGS), "exportBatch")).toBeUndefined();
    const m = buildMenuModel(en, { ...FLAGS, canBatchExport: true, batchRowCount: 7 });
    const item = byId(m, "exportBatch");
    expect(item?.label).toContain("7");
  });

  it("labels sendToZebra with the physical print count while a batch is mapped", () => {
    expect(byId(buildMenuModel(en, FLAGS), "sendToZebra")?.label).toBe(en.app.sendToZebra);
    // 7 rows × ^PQ 3: the send label counts printed labels, the export
    // label counts file rows.
    const m = buildMenuModel(en, {
      ...FLAGS, canBatchExport: true, batchRowCount: 7, batchPrintCount: 21,
    });
    expect(byId(m, "sendToZebra")?.label).toContain("21");
    expect(byId(m, "exportBatch")?.label).toContain("7");
  });

  it("offers the direct CSV import on web and the connect-data wizard on desktop", () => {
    const web = buildMenuModel(en, FLAGS);
    expect(byId(web, "importCsv")).toBeDefined();
    expect(byId(web, "connectData")).toBeUndefined();
    const desktop = buildMenuModel(en, { ...FLAGS, connectDataWizard: true });
    expect(byId(desktop, "importCsv")).toBeUndefined();
    expect(byId(desktop, "connectData")).toBeDefined();
    // Replaces the CSV slot (after saveDesign), not an extra entry.
    expect(ids(desktop).indexOf("connectData")).toBe(ids(desktop).indexOf("saveDesign") + 1);
  });

  it("hides print entirely when the Labelary gate is off", () => {
    const m = buildMenuModel(en, { ...FLAGS, labelaryEnabled: false });
    expect(byId(m, "print")).toBeUndefined();
    expect(byId(m, "sendToZebra")).toBeDefined();
  });

  it("appends the quit section only on desktop", () => {
    expect(byId(buildMenuModel(en, FLAGS), "quit")).toBeUndefined();
    const m = buildMenuModel(en, { ...FLAGS, includeQuit: true });
    const last = m.file[m.file.length - 1];
    expect(last?.map((i) => i.id)).toEqual(["quit"]);
  });

  it("mirrors undo/redo enabled-state into the edit menu", () => {
    const m = buildMenuModel(en, FLAGS);
    const edit = m.edit.flat();
    expect(edit.find((i) => i.id === "undo")?.enabled).toBe(true);
    expect(edit.find((i) => i.id === "redo")?.enabled).toBe(false);
  });
});
