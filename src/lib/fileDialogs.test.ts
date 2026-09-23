import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveTextFile, acceptAttr, ZPL_SAVE_FILTERS, ZPL_FILTER, DESIGN_FILTER } from "./fileDialogs";

vi.mock("./platform", () => ({ isDesktopShell: true }));
const { save, writeFile } = vi.hoisted(() => ({ save: vi.fn(), writeFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile }));

beforeEach(() => {
  save.mockReset();
  writeFile.mockReset();
});

describe("saveTextFile on the desktop", () => {
  it("hands every filter to the native dialog and writes the picked path unchanged", async () => {
    // The fs scope only allows the picked path itself, so no extension may be added.
    save.mockResolvedValue("C:\\out\\job");
    expect(await saveTextFile("^XA^XZ", { filename: "label.zpl", filters: ZPL_SAVE_FILTERS })).toBe(true);
    expect(save).toHaveBeenCalledWith({
      defaultPath: "label.zpl",
      filters: [{ name: "ZPL", extensions: ["zpl"] }, { name: "PRN", extensions: ["prn"] }],
    });
    expect(writeFile).toHaveBeenCalledWith("C:\\out\\job", new TextEncoder().encode("^XA^XZ"));
  });

  it("reports a cancelled dialog as nothing written", async () => {
    save.mockResolvedValue(null);
    expect(await saveTextFile("x", { filename: "label.zpl", filters: [ZPL_FILTER] })).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("acceptAttr", () => {
  it("lists the extensions and each mime type once", () => {
    expect(acceptAttr(DESIGN_FILTER)).toBe(".json,application/json");
    expect(acceptAttr(...ZPL_SAVE_FILTERS)).toBe(".zpl,.prn,text/plain");
  });
});
