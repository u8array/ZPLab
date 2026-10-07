// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { loadFontBytes, removeFont } from "@zplab/core/lib/fontCache";
import { StoredFontsTab } from "./StoredFontsTab";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";
import type { HostDirectory } from "@zplab/core/lib/hostDirectory";

vi.mock("../../lib/platform", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isDesktopShell: true }));

const loc = en.printerSettings.objects;
const fontsLoc = en.printerSettings.fonts;
const object = (device: string, name: string, ext: string, size = 1000) => ({ device, name, ext, size });
const dir = (device: string, objects: HostDirectory["objects"]): HostDirectory => ({ device, objects, bytesFree: undefined });
const listed = (directories: HostDirectory[]) =>
  act(() => useLabelStore.setState({ printerObjects: { phase: "done", key: "net:172.17.17.175:9100", at: 0, directories } }));

beforeEach(async () => {
  await loadFontBytes(new Uint8Array([0, 1, 0, 0]), "E:ARIAL.TTF");
  act(() =>
    useLabelStore.setState({
      printerProfile: {},
      printerObjects: { phase: "idle" },
      printerReading: undefined,
      printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175" },
    }),
  );
});

afterEach(() => {
  cleanup();
  removeFont("E:ARIAL.TTF");
});

describe("StoredFontsTab against the printer", () => {
  it("marks each row with where it stands and keeps one row per file", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupFonts: [{ path: "E:ARIAL.TTF" }, { path: "R:GONE.TTF" }] } }));
    listed([
      dir("R", []),
      dir("E", [object("E", "ARIAL", "TTF", 4096), object("E", "CG_TIMES", "TTF")]),
    ]);
    const r = render(<StoredFontsTab />);
    expect(r.getAllByTitle(/\.TTF$/).map((el) => el.getAttribute("title"))).toEqual(["E:ARIAL.TTF", "R:GONE.TTF", "E:CG_TIMES.TTF"]);
    expect(r.getByText(loc.originOnPrinter)).toBeTruthy();
    expect(r.getByText(loc.originMissing)).toBeTruthy();
    expect(r.getByText(loc.originPrinterOnly)).toBeTruthy();
    expect(r.getByText(loc.objectSizeFmt.replace("{kb}", "4"))).toBeTruthy();
  });

  it("offers the setup script only for a file whose bytes it has, and the printer actions only for a listed one", () => {
    listed([dir("E", [object("E", "CG_TIMES", "TTF")])]);
    const r = render(<StoredFontsTab />);
    // The cached E:ARIAL.TTF can be provisioned, the printer's own font cannot.
    expect(r.getAllByLabelText(new RegExp(fontsLoc.uploadToggle))).toHaveLength(1);
    expect(r.getAllByText(loc.showObject)).toHaveLength(1);
  });

  it("claims absence only for a drive that answered", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupFonts: [{ path: "B:OTHER.TTF" }] } }));
    listed([dir("E", [object("E", "ARIAL", "TTF")])]);
    const r = render(<StoredFontsTab />);
    expect(r.queryByText(loc.originMissing)).toBeNull();
    expect(r.getByText(loc.originOnPrinter)).toBeTruthy();
  });

  it("says nothing about the printer before a read", () => {
    const r = render(<StoredFontsTab />);
    expect(r.getByText(loc.printerNotRead)).toBeTruthy();
    for (const text of [loc.originOnPrinter, loc.originAbsent, loc.originMissing, loc.originPrinterOnly]) expect(r.queryByText(text)).toBeNull();
  });
});
