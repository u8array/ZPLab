// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { StoredFontsTab } from "./StoredFontsTab";
import { useLabelStore } from "../../store/labelStore";
import { getAllFonts, loadFontBytes, removeFont } from "@zplab/core/lib/fontCache";

beforeEach(async () => {
  await loadFontBytes(new Uint8Array([0, 1, 0, 0]), "E:ARIAL.TTF");
  act(() => useLabelStore.setState({ printerProfile: {} }));
});

afterEach(() => {
  cleanup();
  for (const name of ["E:ARIAL.TTF", "R:ARIAL.TTF", "E:NEW.TTF", "E:OLD.BIN", "E:MYLOGO.TTF", "R:GONE.TTF", "E:OTHER.TTF"]) removeFont(name);
});

describe("StoredFontsTab", () => {
  it("lists a cached font and adds it to the setup script", () => {
    const { getByLabelText, getByTitle } = render(<StoredFontsTab />);
    expect(getByTitle("E:ARIAL.TTF")).toBeTruthy();
    act(() => {
      fireEvent.click(getByLabelText(/Send at setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupFonts).toEqual([{ path: "E:ARIAL.TTF" }]);
  });

  it("follows the cache while mounted, with no profile write in between", async () => {
    const { getAllByTitle, queryByTitle } = render(<StoredFontsTab />);
    await act(async () => {
      await loadFontBytes(new Uint8Array([0, 1, 0, 0]), "E:NEW.TTF");
    });
    expect(getAllByTitle(/\.TTF/)).toHaveLength(2);
    act(() => removeFont("E:NEW.TTF"));
    expect(queryByTitle("E:NEW.TTF")).toBeNull();
  });

  it("lists only fonts the setup script can carry", async () => {
    await loadFontBytes(new Uint8Array([0, 1, 0, 0]), "E:OLD.BIN");
    const { queryByTitle } = render(<StoredFontsTab />);
    expect(queryByTitle("E:OLD.BIN")).toBeNull();
  });

  it("keeps the drive an import wrote and finds the bytes cached for that drive", async () => {
    await loadFontBytes(new Uint8Array([0, 1, 0, 0]), "R:ARIAL.TTF");
    act(() => useLabelStore.setState({ printerProfile: { setupFonts: [{ path: "R:ARIAL.TTF" }] } }));
    const { getByTitle, queryByText, getAllByLabelText } = render(<StoredFontsTab />);
    expect(getByTitle("R:ARIAL.TTF")).toBeTruthy();
    expect(queryByText(/Font missing/)).toBeNull();
    // The E: row from the cache sits next to it, unchecked.
    expect(getAllByLabelText(/Send at setup/).filter((el) => (el as HTMLInputElement).checked)).toHaveLength(1);
  });

  it("shows one row per profile entry, and only the drive that holds the bytes is ready", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupFonts: [{ path: "E:ARIAL.TTF" }, { path: "R:ARIAL.TTF" }] } }));
    const { getAllByTitle, getByText, getAllByLabelText } = render(<StoredFontsTab />);
    expect(getAllByTitle(/ARIAL\.TTF/).map((el) => el.getAttribute("title"))).toEqual(["E:ARIAL.TTF", "R:ARIAL.TTF"]);
    expect(getByText(/Font missing/)).toBeTruthy();
    expect(getAllByLabelText(/Send at setup/)).toHaveLength(1);
  });

  it("names a profile entry the setup script could never send", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupFonts: [{ path: "E:OLD.BIN" }] } }));
    const { getByText } = render(<StoredFontsTab />);
    expect(getByText(/not a TrueType font/)).toBeTruthy();
  });

  it("names an entry whose bytes are gone and lets it go", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupFonts: [{ path: "E:GONE.TTF" }] } }));
    const { getByText, getByLabelText } = render(<StoredFontsTab />);
    expect(getByText(/Font missing/)).toBeTruthy();
    act(() => {
      fireEvent.click(getByLabelText(/Remove stale entry/));
    });
    expect(useLabelStore.getState().printerProfile.setupFonts).toBeUndefined();
  });

  it("repairs a missing entry under its own path instead of the default drive", async () => {
    act(() => useLabelStore.setState({ printerProfile: { setupFonts: [{ path: "R:GONE.TTF" }] } }));
    const { getByText, getByLabelText, queryByText } = render(<StoredFontsTab />);
    act(() => {
      fireEvent.click(getByText("Upload the file"));
    });
    await act(async () => {
      fireEvent.change(getByLabelText(/Upload font/), { target: { files: [new File(["x"], "other.ttf")] } });
    });
    expect(getAllFonts().map((f) => f.name)).toContain("R:GONE.TTF");
    expect(queryByText(/Font missing/)).toBeNull();
    expect(useLabelStore.getState().printerProfile.setupFonts).toEqual([{ path: "R:GONE.TTF" }]);
  });

  it("uploads a font file into the cache and the setup script in one step", async () => {
    const { getByLabelText } = render(<StoredFontsTab />);
    await act(async () => {
      fireEvent.change(getByLabelText(/Upload font/), { target: { files: [new File(["x"], "new.ttf")] } });
    });
    expect(getAllFonts().map((f) => f.name)).toContain("E:NEW.TTF");
    expect(useLabelStore.getState().printerProfile.setupFonts).toEqual([{ path: "E:NEW.TTF" }]);
  });

  it("gives a picked file a printer name the ~DY operand can carry", async () => {
    const { getByLabelText } = render(<StoredFontsTab />);
    await act(async () => {
      fireEvent.change(getByLabelText(/Upload font/), { target: { files: [new File(["x"], "my logo.ttf")] } });
    });
    expect(useLabelStore.getState().printerProfile.setupFonts).toEqual([{ path: "E:MYLOGO.TTF" }]);
  });

  it("locks every profile control while the editor is frozen, instead of snapping back", () => {
    act(() => useLabelStore.setState({ sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 1 } }));
    const { getByLabelText, getByRole } = render(<StoredFontsTab />);
    const toggle = getByLabelText(/Send at setup/) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    const upload = (getByLabelText(/Upload font/) as HTMLInputElement).closest("div")?.querySelector("button") as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    // A disabled control swallows its own events, so the reason sits on the wrapper.
    act(() => {
      fireEvent.focus(upload.parentElement as HTMLElement);
    });
    expect(getByRole("tooltip").textContent).toMatch(/locked by the source session/);
    act(() => useLabelStore.setState({ sourceEdit: { status: "off" } }));
  });

  it("refuses a second file that folds onto a cached printer name with different bytes", async () => {
    const { getByLabelText, getByText } = render(<StoredFontsTab />);
    await act(async () => {
      fireEvent.change(getByLabelText(/Upload font/), { target: { files: [new File(["other bytes"], "arial.ttf")] } });
    });
    expect(getAllFonts()).toHaveLength(1);
    expect(getByText(/Rename the file/)).toBeTruthy();
    expect(useLabelStore.getState().printerProfile.setupFonts).toBeUndefined();
  });

  it("names a failed upload", async () => {
    const { getByLabelText, getByText } = render(<StoredFontsTab />);
    await act(async () => {
      fireEvent.change(getByLabelText(/Upload font/), { target: { files: [new File(["x"], "bad.txt")] } });
    });
    expect(getByText(/Could not load the font file/)).toBeTruthy();
  });
});
