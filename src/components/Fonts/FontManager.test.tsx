// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act, within } from "@testing-library/react";
import { FontManager } from "./FontManager";
import { useLabelStore, forgetHistoryUsing } from "../../store/labelStore";
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

  it("deletes a font an undo step names, and that step with it", () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [text("E:ARIAL.TTF")] }] }));
    act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
    const r = render(<FontManager />);
    expect(deleteButton(r).disabled).toBe(false);
    act(() => {
      fireEvent.click(deleteButton(r));
    });
    expect(r.getByRole("alertdialog").textContent).toMatch(/drops (the one step|\d+ steps) in the undo history/);
    act(() => {
      fireEvent.click(within(r.getByRole("alertdialog")).getByText("Delete"));
    });
    expect(getAllFonts()).toHaveLength(0);
    expect(forgetHistoryUsing("fonts", "E:ARIAL.TTF")).toBe(0);
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

  it("frees a font once the profile entry is gone, whatever an undo step's profile shipped", () => {
    act(() => useLabelStore.getState().patchPrinterProfile({ setupFonts: [{ path: "E:ARIAL.TTF" }] }));
    const provisioned = render(<FontManager />);
    expect(deleteReason(provisioned)).toMatch(/printer profile/);
    provisioned.unmount();
    act(() => useLabelStore.getState().patchPrinterProfileWith((p) => ({ setupFonts: withoutSetupEntry(p.setupFonts, "E:ARIAL.TTF") })));
    const dropped = render(<FontManager />);
    expect(deleteButton(dropped).disabled).toBe(false);
    act(() => {
      fireEvent.click(deleteButton(dropped));
    });
    expect(dropped.getByRole("alertdialog").textContent).not.toMatch(/undo history/);
  });

  it("keeps a font when the editor freezes while the dialog stands", () => {
    const r = render(<FontManager />);
    act(() => {
      fireEvent.click(deleteButton(r));
    });
    act(() => useLabelStore.setState({ sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 1 } }));
    act(() => {
      fireEvent.click(within(r.getByRole("alertdialog")).getByText("Delete"));
    });
    expect(getAllFonts()).toHaveLength(1);
  });

  it("keeps a font while the editor is frozen, and says so", () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [text("E:ARIAL.TTF")] }] }));
    act(() => useLabelStore.setState({ pages: [{ objects: [] }], sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 1 } }));
    const r = render(<FontManager />);
    expect(deleteButton(r).disabled).toBe(true);
    expect(deleteReason(r)).toMatch(/locked/);
  });

  it("keeps a font only the replaced design names, and says so", () => {
    act(() => useLabelStore.setState({ replacedDesign: { text: serializeDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [text("E:ARIAL.TTF")] }]), objects: 1, source: "agent" } }));
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

const choose = (r: ReturnType<typeof render>, option: string) => {
  act(() => {
    fireEvent.click(r.getAllByRole("button", { name: /^Delivery/ })[0] as HTMLElement);
  });
  act(() => {
    r.getByRole("option", { name: option }).click();
  });
};

describe("FontManager delivery", () => {
  it("writes only the flag on the mapping, the path being the identity", () => {
    act(() => useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8, customFonts: [{ alias: "M", path: "e:arial.ttf" }] } }));
    const r = render(<FontManager />);
    choose(r, "With every job");
    expect(useLabelStore.getState().label.customFonts).toEqual([{ alias: "M", path: "e:arial.ttf", embedInZpl: true }]);
  });

  it("moves a font from the job into the setup script and back out to the printer, the profile following each step", () => {
    act(() => useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8, customFonts: [{ alias: "M", path: "E:ARIAL.TTF", embedInZpl: true }] } }));
    const r = render(<FontManager />);
    choose(r, "Once in the setup script");
    expect(useLabelStore.getState().printerProfile.setupFonts).toEqual([{ path: "E:ARIAL.TTF" }]);
    expect(useLabelStore.getState().label.customFonts).toEqual([{ alias: "M", path: "E:ARIAL.TTF", embedInZpl: undefined }]);
    expect(r.getByText(/setup script of this printer profile/)).toBeTruthy();
    choose(r, "Already on the printer");
    expect(useLabelStore.getState().printerProfile.setupFonts).toBeUndefined();
    expect(r.getByText(/default font/)).toBeTruthy();
  });

  it("keeps the profile entry when the job takes the font back", () => {
    act(() => useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8, customFonts: [{ alias: "M", path: "E:ARIAL.TTF" }] }, printerProfile: { setupFonts: [{ path: "E:ARIAL.TTF" }] } }));
    const r = render(<FontManager />);
    choose(r, "With every job");
    expect(useLabelStore.getState().printerProfile.setupFonts).toEqual([{ path: "E:ARIAL.TTF" }]);
    expect(useLabelStore.getState().label.customFonts?.[0]?.embedInZpl).toBe(true);
  });

  it("blocks the job for a font without an alias, since no ^CW could name it", () => {
    act(() => useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8 } }));
    const r = render(<FontManager />);
    act(() => {
      fireEvent.click(r.getAllByRole("button", { name: /^Delivery/ })[0] as HTMLElement);
    });
    expect((r.getByRole("option", { name: "With every job" }) as HTMLElement).getAttribute("aria-disabled")).toBe("true");
  });

  it("steps the design back first on undo, spends nothing on a re-pick, and leaves the design still when only the profile moves", () => {
    act(() => useLabelStore.setState({ label: { widthMm: 70, heightMm: 40, dpmm: 8, customFonts: [{ alias: "M", path: "E:ARIAL.TTF", embedInZpl: true }] } }));
    const temporal = useLabelStore.temporal.getState();
    const steps = () => useLabelStore.temporal.getState().pastStates.length;
    const before = steps();
    const r = render(<FontManager />);
    choose(r, "With every job");
    expect(steps()).toBe(before);
    choose(r, "Once in the setup script");
    // The design steps back first, and with the entry still in the profile the derivation reads job again.
    act(() => temporal.undo());
    expect(useLabelStore.getState().label.customFonts?.[0]?.embedInZpl).toBe(true);
    expect(useLabelStore.getState().printerProfile.setupFonts).toEqual([{ path: "E:ARIAL.TTF" }]);
    act(() => temporal.redo());
    const label = useLabelStore.getState().label;
    choose(r, "Already on the printer");
    expect(useLabelStore.getState().label).toBe(label);
    expect(useLabelStore.getState().printerProfile.setupFonts).toBeUndefined();
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

describe("FontManager stored fonts hand-off", () => {
  afterEach(() => act(() => useLabelStore.setState({ printerSettingsTab: null })));

  it("links a TrueType font to the stored fonts tab and leaves a bare printer name unlinked", async () => {
    await loadFontBytes(new Uint8Array([0, 1, 0, 0]), "R:MYFONT");
    const r = render(<FontManager />);
    expect(r.queryByRole("button", { name: "Manage stored objects: R:MYFONT" })).toBeNull();
    act(() => {
      fireEvent.click(r.getByRole("button", { name: "Manage stored objects: E:ARIAL.TTF" }));
    });
    expect(useLabelStore.getState().printerSettingsTab).toBe("storedFonts");
  });
});
