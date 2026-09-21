// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { FontManager } from "./FontManager";
import { useLabelStore } from "../../store/labelStore";
import { cachedFontPath, getAllFonts, loadFontBytes, removeFont } from "@zplab/core/lib/fontCache";
import { withoutSetupEntry } from "@zplab/core/lib/setupEntries";
import { serializeDesign } from "@zplab/core/lib/designFile";
import type { LabelObject } from "@zplab/core/types/Group";

const text = (printerFontName: string): LabelObject =>
  ({ id: "t1", type: "text", x: 0, y: 0, rotation: 0, props: { content: "x", fontHeight: 30, fontWidth: 0, rotation: "N", printerFontName } }) as unknown as LabelObject;

beforeEach(async () => {
  await loadFontBytes(new Uint8Array([0, 1, 0, 0]), "E:ARIAL.TTF");
  useLabelStore.temporal.getState().clear();
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

const deleteButton = (r: ReturnType<typeof render>) => r.getByLabelText("Delete") as HTMLButtonElement;
/** Focus shows the tooltip without the hover delay. */
const deleteReason = (r: ReturnType<typeof render>) => {
  act(() => {
    fireEvent.focus(deleteButton(r).parentElement as HTMLElement);
  });
  return r.getByRole("tooltip").textContent;
};

describe("FontManager delete", () => {
  it("keeps a font a field names, spelled with another case, out of the delete", () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [text("e:arial.ttf")] }] }));
    const r = render(<FontManager />);
    expect(deleteButton(r).disabled).toBe(true);
    expect(deleteReason(r)).toMatch(/text field or an alias/);
  });

  it("keeps a font an undo step still names, and frees it once the history is gone", () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [text("E:ARIAL.TTF")] }] }));
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const first = render(<FontManager />);
    expect(deleteButton(first).disabled).toBe(true);
    expect(deleteReason(first)).toMatch(/undo step/);
    first.unmount();
    act(() => useLabelStore.temporal.getState().clear());
    expect(deleteButton(render(<FontManager />)).disabled).toBe(false);
  });
});

describe("FontManager delete owners", () => {
  it("keeps a font only the printer profile provisions, and says so", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupFonts: [{ path: "e:arial.ttf" }] } }));
    const r = render(<FontManager />);
    expect(deleteButton(r).disabled).toBe(true);
    expect(deleteReason(r)).toMatch(/printer profile/);
    act(() => useLabelStore.setState({ printerProfile: {} }));
  });

  it("keeps a font an undo step's profile still ships, and lets the live profile name itself first", () => {
    act(() => useLabelStore.getState().patchPrinterProfile({ setupFonts: [{ path: "E:ARIAL.TTF" }] }));
    const provisioned = render(<FontManager />);
    expect(deleteReason(provisioned)).toMatch(/printer profile/);
    provisioned.unmount();
    act(() => useLabelStore.getState().patchPrinterProfileWith((p) => ({ setupFonts: withoutSetupEntry(p.setupFonts, "E:ARIAL.TTF") })));
    const dropped = render(<FontManager />);
    expect(deleteButton(dropped).disabled).toBe(true);
    expect(deleteReason(dropped)).toMatch(/undo step/);
    dropped.unmount();
    act(() => useLabelStore.temporal.getState().clear());
    expect(deleteButton(render(<FontManager />)).disabled).toBe(false);
  });

  it("keeps a font only the replaced design names, and says so", () => {
    act(() => useLabelStore.setState({ replacedDesign: { text: serializeDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [text("E:ARIAL.TTF")] }]), objects: 1 } }));
    const r = render(<FontManager />);
    expect(deleteButton(r).disabled).toBe(true);
    expect(deleteReason(r)).toMatch(/agent replaced/);
    act(() => useLabelStore.setState({ replacedDesign: null }));
  });

  it("keeps a font only the clipboard names, and says so", () => {
    act(() => useLabelStore.setState({ clipboard: [text("E:ARIAL.TTF")] }));
    const r = render(<FontManager />);
    expect(deleteButton(r).disabled).toBe(true);
    expect(deleteReason(r)).toMatch(/clipboard/);
    act(() => useLabelStore.setState({ clipboard: [] }));
  });
});

describe("FontManager manual mappings", () => {
  it("names a mapping that promises an embed but has no bytes to ship", () => {
    act(() => useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8, customFonts: [{ alias: "M", path: "E:GONE.TTF", embedInZpl: true }] } }));
    const r = render(<FontManager />);
    if (!r.queryByText(/Font missing/)) fireEvent.click(r.getByText("Printer-resident fonts"));
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
