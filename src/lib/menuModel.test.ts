import { describe, it, expect } from "vitest";
import { buildMenuModel, type MenuFlags } from "./menuModel";
import { fallbackTranslations as en } from "../locales";

const FLAGS: MenuFlags = {
  hasObjects: true,
  documentEmits: true,
  sourceEditing: false,
  canBatchExport: false,
  batchRowCount: 0,
  connectDataWizard: false,
  canBatchPdf: true,
  pdfCurrentPageOnly: false,
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
      "new", "addPage", "importZpl", "settings", "exportZpl", "output",
      "openDesign", "saveDesign", "importCsv",
    ]);
    expect(m.file).toHaveLength(4);
  });

  it("disables the import under a source session, like opening a file", () => {
    const m = buildMenuModel(en, { ...FLAGS, sourceEditing: true });
    expect(byId(m, "importZpl")?.enabled).toBe(false);
    expect(byId(m, "openDesign")?.enabled).toBe(false);
    expect(byId(m, "settings")?.enabled).toBe(true);
  });

  it("gates export, save and the output entry on documentEmits", () => {
    const m = buildMenuModel(en, { ...FLAGS, hasObjects: false, documentEmits: false });
    for (const id of ["exportZpl", "saveDesign", "output"]) {
      expect(byId(m, id)?.enabled).toBe(false);
    }
    expect(byId(m, "new")?.enabled).toBe(true);
    // An overlay page emits without objects, so export and save stay reachable.
    const emits = buildMenuModel(en, { ...FLAGS, hasObjects: false, documentEmits: true });
    expect(byId(emits, "exportZpl")?.enabled).toBe(true);
    expect(byId(emits, "saveDesign")?.enabled).toBe(true);
    // The dialog decides what the entry leads to, so the entry itself only asks whether anything emits.
    expect(byId(emits, "output")?.enabled).toBe(true);
  });

  it("disables document-replacing and emitting entries during a source-edit session", () => {
    const m = buildMenuModel(en, { ...FLAGS, sourceEditing: true });
    for (const id of ["new", "addPage", "importZpl", "openDesign", "saveDesign", "importCsv", "exportZpl", "output"]) {
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

  it("names the output entry as the dialog titles itself, without a count", () => {
    expect(byId(buildMenuModel(en, FLAGS), "output")?.label).toBe(en.zebraPrint.outputHeading);
    // The counts belong to the entries that name what they produce, and to the dialog itself.
    const m = buildMenuModel(en, { ...FLAGS, canBatchExport: true, batchRowCount: 7 });
    expect(byId(m, "output")?.label).toBe(en.zebraPrint.outputHeading);
    expect(byId(m, "exportBatch")?.label).toContain("7");
  });

  it("leaves the PDF to the dialog instead of a menu entry of its own", () => {
    const batch = { ...FLAGS, canBatchExport: true, batchRowCount: 3 };
    expect(byId(buildMenuModel(en, batch), "output")?.enabled).toBe(true);
    for (const id of ["exportPdf", "exportBatchPdf"]) {
      expect(ids(buildMenuModel(en, batch))).not.toContain(id);
    }
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
