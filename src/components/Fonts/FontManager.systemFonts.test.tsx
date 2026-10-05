// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act, waitFor, within } from "@testing-library/react";
import { FontManager } from "./FontManager";
import { useLabelStore } from "../../store/labelStore";
import { cachedFontPath, getAllFonts, removeFont } from "@zplab/core/lib/fontCache";
import { fallbackTranslations as en } from "../../locales";

vi.mock("../../lib/platform", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isDesktopShell: true }));
const readSystemFont = vi.fn();
vi.mock("../../lib/systemFonts", () => ({
  listSystemFonts: vi.fn().mockResolvedValue([
    { family: "Arial", style: "Regular", path: "C:\\Windows\\Fonts\\arial.ttf", file_name: "arial.ttf", bytes: 1024, restricted: false, variable: false },
    { family: "Noto Sans", style: "Bold", path: "C:\\Windows\\Fonts\\NotoSans-Bold.ttf", file_name: "NotoSans-Bold.ttf", bytes: 1024, restricted: false, variable: false },
    { family: "Noto Sans", style: "Regular", path: "C:\\Windows\\Fonts\\NotoSans-Regular.ttf", file_name: "NotoSans-Regular.ttf", bytes: 1024, restricted: false, variable: false },
    { family: "Locked", style: "Bold", path: "C:\\Windows\\Fonts\\locked.ttf", file_name: "locked.ttf", bytes: 2048, restricted: true, variable: false },
  ]),
  readSystemFont: (path: string) => readSystemFont(path),
}));

beforeEach(() => {
  readSystemFont.mockReset().mockResolvedValue(new Uint8Array([0, 1, 0, 0]));
  act(() => useLabelStore.setState({ pages: [{ objects: [] }], label: { widthMm: 70, heightMm: 40, dpmm: 8 }, sourceEdit: { status: "off" } }));
});

afterEach(() => {
  cleanup();
  for (const f of getAllFonts()) removeFont(cachedFontPath(f));
});

const open = (r: ReturnType<typeof render>) => fireEvent.click(r.getByText(en.fonts.addFont));
const add = (r: ReturnType<typeof render>) =>
  within(r.getByRole("dialog")).getByRole("button", { name: en.fonts.addFont }) as HTMLButtonElement;
const nameField = (r: ReturnType<typeof render>) => r.getByPlaceholderText(en.fonts.printerFilenamePlaceholder) as HTMLInputElement;

describe("FontManager installed fonts", () => {
  it("draws each row in its own face", async () => {
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    expect(r.getByText("Arial").style.fontFamily).toBe('"Arial"');
  });

  it("fills the printer filename from the picked row, then caches it on Add", async () => {
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    fireEvent.click(r.getByText("Arial"));
    expect(nameField(r).value).toBe("E:ARIAL.TTF");
    expect(readSystemFont).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(add(r));
    });
    expect(readSystemFont).toHaveBeenCalledWith("C:\\Windows\\Fonts\\arial.ttf");
    expect(getAllFonts().map(cachedFontPath)).toEqual(["E:ARIAL.TTF"]);
  });

  it("keeps a font with a restricted license out of reach", async () => {
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getByText("Locked")).toBeTruthy());
    const row = r.getByText("Locked").closest("button") as HTMLButtonElement;
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.title).toBe(en.fonts.restrictedLicense);
    await act(async () => {
      fireEvent.click(row);
    });
    expect(nameField(r).value).toBe("");
    expect(add(r).getAttribute("aria-disabled")).toBe("true");
    expect(readSystemFont).not.toHaveBeenCalled();
  });

  it("takes an edited printer filename over the one derived from the row", async () => {
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    fireEvent.click(r.getByText("Arial"));
    expect(nameField(r).value).toBe("E:ARIAL.TTF");
    fireEvent.change(nameField(r), { target: { value: "R:LOGO" } });
    await act(async () => {
      fireEvent.click(add(r));
    });
    expect(getAllFonts().map(cachedFontPath)).toEqual(["R:LOGO.TTF"]);
  });

  it("refuses a second style whose stem folds onto a cached printer name, and takes it under an edited name", async () => {
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getAllByText("Noto Sans")).toHaveLength(2));
    fireEvent.click(r.getAllByText("Noto Sans")[0] as HTMLElement);
    await act(async () => {
      fireEvent.click(add(r));
    });
    expect(getAllFonts().map(cachedFontPath)).toEqual(["E:NOTOSANS.TTF"]);
    readSystemFont.mockResolvedValue(new Uint8Array([0, 1, 0, 1]));
    open(r);
    await waitFor(() => expect(r.getAllByText("Noto Sans")).toHaveLength(2));
    fireEvent.click(r.getAllByText("Noto Sans")[1] as HTMLElement);
    await act(async () => {
      fireEvent.click(add(r));
    });
    expect(r.getByText(en.fonts.nameTaken)).toBeTruthy();
    expect(getAllFonts().map(cachedFontPath)).toEqual(["E:NOTOSANS.TTF"]);
    fireEvent.change(nameField(r), { target: { value: "E:NOTOBOLD.TTF" } });
    await act(async () => {
      fireEvent.click(add(r));
    });
    expect(getAllFonts().map(cachedFontPath).sort()).toEqual(["E:NOTOBOLD.TTF", "E:NOTOSANS.TTF"]);
  });

  it("locks the form while a read is still landing, yet keeps every control focusable for Escape", async () => {
    let finish: (bytes: Uint8Array) => void = () => undefined;
    readSystemFont.mockReturnValue(new Promise<Uint8Array>((resolve) => (finish = resolve)));
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    fireEvent.click(r.getByText("Arial"));
    expect(add(r).getAttribute("aria-disabled")).toBe("false");
    await act(async () => {
      fireEvent.click(add(r));
    });
    expect(add(r).getAttribute("aria-disabled")).toBe("true");
    expect(nameField(r).readOnly).toBe(true);
    expect(r.getByRole("dialog").querySelector(":disabled")).toBeNull();
    await act(async () => {
      finish(new Uint8Array([0, 1, 0, 0]));
    });
    expect(getAllFonts().map(cachedFontPath)).toEqual(["E:ARIAL.TTF"]);
  });

  it("closes on Escape while a read is pending and drops the late result", async () => {
    let finish: (bytes: Uint8Array) => void = () => undefined;
    readSystemFont.mockReturnValue(new Promise<Uint8Array>((resolve) => (finish = resolve)));
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    fireEvent.click(r.getByText("Arial"));
    await act(async () => {
      fireEvent.click(add(r));
    });
    fireEvent.keyDown(r.getByRole("dialog"), { key: "Escape" });
    expect(r.queryByRole("dialog")).toBeNull();
    await act(async () => {
      finish(new Uint8Array([0, 1, 0, 0]));
    });
    expect(getAllFonts()).toHaveLength(0);
  });

  it("refuses to add when the printer filename is only blanks", async () => {
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    fireEvent.click(r.getByText("Arial"));
    fireEvent.change(nameField(r), { target: { value: "  " } });
    expect(add(r).getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.click(add(r));
    });
    expect(readSystemFont).not.toHaveBeenCalled();
    expect(getAllFonts()).toHaveLength(0);
  });

  it("moves the selection with the arrow keys, also from the filter field, and adds on submitting the name field", async () => {
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    const list = r.getByRole("listbox");
    fireEvent.keyDown(r.getByLabelText(en.fonts.filterFonts), { key: "ArrowDown" });
    expect(nameField(r).value).toBe("E:ARIAL.TTF");
    expect(r.getAllByRole("option")[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(nameField(r).value).toBe("E:NOTOSANS.TTF");
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(nameField(r).value).toBe("E:ARIAL.TTF");
    await act(async () => {
      fireEvent.submit(nameField(r));
    });
    expect(getAllFonts().map(cachedFontPath)).toEqual(["E:ARIAL.TTF"]);
  });

  it("narrows the list with the filter", async () => {
    const r = render(<FontManager />);
    open(r);
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    fireEvent.change(r.getByLabelText(en.fonts.filterFonts), { target: { value: "lock" } });
    expect(r.queryByText("Arial")).toBeNull();
    expect(r.getByText("Locked")).toBeTruthy();
    fireEvent.change(r.getByLabelText(en.fonts.filterFonts), { target: { value: "zzz" } });
    expect(r.getByText(en.fonts.noFilterMatch)).toBeTruthy();
  });
});
