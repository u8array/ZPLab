// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { FontManager } from "./FontManager";
import { useLabelStore } from "../../store/labelStore";
import { cachedFontPath, getAllFonts, loadFontBytes, removeFont } from "@zplab/core/lib/fontCache";

beforeEach(async () => {
  await loadFontBytes(new Uint8Array([0, 1, 0, 0]), "E:ARIAL.TTF");
  act(() => useLabelStore.setState({ pages: [{ objects: [] }], label: { widthMm: 70, heightMm: 40, dpmm: 8 }, sourceEdit: { status: "off" } }));
});

afterEach(() => {
  cleanup();
  for (const f of getAllFonts()) removeFont(cachedFontPath(f));
});

const pick = async (r: ReturnType<typeof render>, file: File) => {
  fireEvent.click(r.getByText("Add font"));
  const input = r.container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};

describe("FontManager manual mappings", () => {
  it("names a mapping that promises an embed but has no bytes to ship", () => {
    act(() => useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8, customFonts: [{ alias: "M", path: "E:GONE.TTF", embedInZpl: true }] } }));
    const r = render(<FontManager />);
    expect(r.getByText(/Font missing/)).toBeTruthy();
  });
});

describe("FontManager embed toggle", () => {
  it("writes only the flag on the mapping, the path being the identity", () => {
    act(() => useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8, customFonts: [{ alias: "M", path: "e:arial.ttf" }] } }));
    const r = render(<FontManager />);
    act(() => {
      fireEvent.click(r.getByLabelText("Send with print job"));
    });
    expect(useLabelStore.getState().label.customFonts).toEqual([{ alias: "M", path: "e:arial.ttf", embedInZpl: true }]);
  });
});

describe("FontManager alias", () => {
  it("keeps the embed flag when the alias changes", () => {
    act(() => useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8, customFonts: [{ alias: "A", path: "E:ARIAL.TTF", embedInZpl: true }] } }));
    const r = render(<FontManager />);
    const alias = r.getAllByPlaceholderText("A-Z")[0] as HTMLInputElement;
    act(() => {
      fireEvent.change(alias, { target: { value: "m" } });
    });
    expect(useLabelStore.getState().label.customFonts).toEqual([{ alias: "M", path: "E:ARIAL.TTF", embedInZpl: true }]);
  });
});

describe("FontManager upload", () => {
  it("refuses a file whose name folds onto a cached font holding other bytes", async () => {
    const r = render(<FontManager />);
    await pick(r, new File(["other bytes"], "arial.ttf"));
    expect(r.getByText(/Rename the file/)).toBeTruthy();
    expect(getAllFonts()).toHaveLength(1);
  });

  it("refuses a file whose name leaves no printer name", async () => {
    const r = render(<FontManager />);
    await pick(r, new File(["x"], "日本.ttf"));
    expect(r.getByText(/leaves no printer name/)).toBeTruthy();
    expect(getAllFonts()).toHaveLength(1);
  });

  it("stores a picked file under the .TTF printer name ^CW can reference", async () => {
    const r = render(<FontManager />);
    await pick(r, new File(["x"], "My Logo.otf"));
    expect(getAllFonts().map((f) => f.name).sort()).toEqual(["E:ARIAL.TTF", "E:MYLOGO.TTF"]);
  });
});
