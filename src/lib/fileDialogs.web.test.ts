// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { saveFile, saveTextFile, ZPL_SAVE_FILTERS, ZPL_FILTER, PNG_FILTER } from "./fileDialogs";

vi.mock("./platform", () => ({ isDesktopShell: false }));
const { triggerDownload } = vi.hoisted(() => ({ triggerDownload: vi.fn() }));
vi.mock("./triggerDownload", () => ({ triggerDownload }));

const win = window as { showSaveFilePicker?: unknown };
beforeEach(() => triggerDownload.mockReset());
afterEach(() => {
  delete win.showSaveFilePicker;
});

describe("saveTextFile in the browser", () => {
  it("offers every filter to the save picker and writes the text", async () => {
    const write = vi.fn();
    const close = vi.fn();
    const picker = vi.fn().mockResolvedValue({ createWritable: async () => ({ write, close }) });
    win.showSaveFilePicker = picker;
    expect(await saveTextFile("^XA^XZ", { filename: "label.zpl", filters: ZPL_SAVE_FILTERS })).toBe(true);
    expect(triggerDownload).not.toHaveBeenCalled();
    expect(picker).toHaveBeenCalledWith({
      suggestedName: "label.zpl",
      types: [
        { description: "ZPL", accept: { "text/plain": [".zpl"] } },
        { description: "PRN", accept: { "text/plain": [".prn"] } },
      ],
    });
    const written = write.mock.calls[0]?.[0] as Blob;
    expect(await written.text()).toBe("^XA^XZ");
    expect(written.type).toBe("text/plain");
    expect(close).toHaveBeenCalled();
  });

  it("reports a cancelled picker as nothing written", async () => {
    win.showSaveFilePicker = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    expect(await saveTextFile("x", { filename: "label.zpl", filters: [ZPL_FILTER] })).toBe(false);
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("downloads under the suggested name without a picker", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    expect(await saveFile(png, { filename: "label.png", filters: [PNG_FILTER] })).toBe(true);
    expect(triggerDownload).toHaveBeenCalledWith(png, "label.png");
  });

  it("downloads when the picker refuses", async () => {
    win.showSaveFilePicker = vi.fn().mockRejectedValue(new DOMException("no gesture", "SecurityError"));
    expect(await saveTextFile("x", { filename: "label.zpl", filters: ZPL_SAVE_FILTERS })).toBe(true);
    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), "label.zpl");
  });
});
