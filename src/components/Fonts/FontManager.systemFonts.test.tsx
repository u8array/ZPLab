// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
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

describe("FontManager installed fonts", () => {
  it("caches a picked font under its file name", async () => {
    const r = render(<FontManager />);
    fireEvent.click(r.getByText(en.fonts.addFont));
    fireEvent.click(r.getByText(en.fonts.fromComputer));
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    await act(async () => {
      fireEvent.click(r.getByText("Arial"));
    });
    expect(readSystemFont).toHaveBeenCalledWith("C:\\Windows\\Fonts\\arial.ttf");
    expect(getAllFonts().map(cachedFontPath)).toEqual(["E:ARIAL.TTF"]);
  });

  it("keeps a font with a restricted license out of reach", async () => {
    const r = render(<FontManager />);
    fireEvent.click(r.getByText(en.fonts.addFont));
    fireEvent.click(r.getByText(en.fonts.fromComputer));
    await waitFor(() => expect(r.getByText("Locked")).toBeTruthy());
    const row = r.getByText("Locked").closest("button") as HTMLButtonElement;
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.title).toBe(en.fonts.restrictedLicense);
    await act(async () => {
      fireEvent.click(row);
    });
    expect(readSystemFont).not.toHaveBeenCalled();
  });

  it("takes the typed printer filename over the file's own", async () => {
    const r = render(<FontManager />);
    fireEvent.click(r.getByText(en.fonts.addFont));
    fireEvent.change(r.getByPlaceholderText(en.fonts.printerFilenamePlaceholder), { target: { value: "R:LOGO" } });
    fireEvent.click(r.getByText(en.fonts.fromComputer));
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    await act(async () => {
      fireEvent.click(r.getByText("Arial"));
    });
    expect(getAllFonts().map(cachedFontPath)).toEqual(["R:LOGO.TTF"]);
  });

  it("refuses a second style whose stem folds onto a cached printer name", async () => {
    const r = render(<FontManager />);
    fireEvent.click(r.getByText(en.fonts.addFont));
    fireEvent.click(r.getByText(en.fonts.fromComputer));
    await waitFor(() => expect(r.getAllByText("Noto Sans")).toHaveLength(2));
    await act(async () => {
      fireEvent.click(r.getAllByText("Noto Sans")[0] as HTMLElement);
    });
    expect(getAllFonts().map(cachedFontPath)).toEqual(["E:NOTOSANS.TTF"]);
    readSystemFont.mockResolvedValue(new Uint8Array([0, 1, 0, 1]));
    fireEvent.click(r.getByText(en.fonts.addFont));
    fireEvent.click(r.getByText(en.fonts.fromComputer));
    await waitFor(() => expect(r.getAllByText("Noto Sans")).toHaveLength(2));
    await act(async () => {
      fireEvent.click(r.getAllByText("Noto Sans")[1] as HTMLElement);
    });
    expect(r.getByText(en.fonts.nameTaken)).toBeTruthy();
    expect(getAllFonts().map(cachedFontPath)).toEqual(["E:NOTOSANS.TTF"]);
  });

  it("locks Cancel while a pick is still landing", async () => {
    let finish: (bytes: Uint8Array) => void = () => undefined;
    readSystemFont.mockReturnValue(new Promise<Uint8Array>((resolve) => (finish = resolve)));
    const r = render(<FontManager />);
    fireEvent.click(r.getByText(en.fonts.addFont));
    fireEvent.click(r.getByText(en.fonts.fromComputer));
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    await act(async () => {
      fireEvent.click(r.getByText("Arial"));
    });
    expect((r.getByText(en.fonts.cancel) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      finish(new Uint8Array([0, 1, 0, 0]));
    });
    expect(getAllFonts().map(cachedFontPath)).toEqual(["E:ARIAL.TTF"]);
  });

  it("narrows the list with the filter", async () => {
    const r = render(<FontManager />);
    fireEvent.click(r.getByText(en.fonts.addFont));
    fireEvent.click(r.getByText(en.fonts.fromComputer));
    await waitFor(() => expect(r.getByText("Arial")).toBeTruthy());
    fireEvent.change(r.getByLabelText(en.fonts.filterFonts), { target: { value: "lock" } });
    expect(r.queryByText("Arial")).toBeNull();
    expect(r.getByText("Locked")).toBeTruthy();
    fireEvent.change(r.getByLabelText(en.fonts.filterFonts), { target: { value: "zzz" } });
    expect(r.getByText(en.fonts.noFilterMatch)).toBeTruthy();
  });
});
