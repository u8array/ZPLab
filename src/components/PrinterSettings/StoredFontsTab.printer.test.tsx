// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { loadFontBytes, removeFont } from "@zplab/core/lib/fontCache";
import { StoredFontsTab } from "./StoredFontsTab";
import { PrinterStorageUsage } from "./PrinterStorage";
import { StoredObjectHoverProvider } from "./storedObjectHover";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";
import type { HostDirectory } from "@zplab/core/lib/hostDirectory";

vi.mock("../../lib/platform", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isDesktopShell: true }));

const loc = en.printerSettings.objects;
const fontsLoc = en.printerSettings.fonts;
const object = (device: string, name: string, ext: string, size = 1000) => ({ device, name, ext, size });
const dir = (device: string, objects: HostDirectory["objects"], bytesFree?: number): HostDirectory => ({ device, objects, bytesFree });
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

/** The modal puts the lists and the drive bars under one provider, so a hover test needs both. */
const withUsage = () =>
  render(
    <StoredObjectHoverProvider>
      <StoredFontsTab />
      <PrinterStorageUsage />
    </StoredObjectHoverProvider>,
  );

describe("StoredFontsTab against the printer", () => {
  it("shows how full a drive is, counting the graphics the tab does not list", () => {
    listed([dir("E", [object("E", "ARIAL", "TTF", 1024), object("E", "LOGO", "GRF", 1024)], 2048), dir("R", [])]);
    const r = withUsage();
    expect(r.getByText("E: 2 KB used, 2 KB free")).toBeTruthy();
    // R: never said how much room is left, so it gets no bar.
    expect(r.queryByText(/^R:/)).toBeNull();
  });

  it("names the hovered row's share and lifts it out of the used block", () => {
    listed([dir("E", [object("E", "ARIAL", "TTF", 1024), object("E", "LOGO", "GRF", 1024)], 2048)]);
    const r = withUsage();
    const width = (part: string) => (r.container.querySelector(`[data-part="${part}"]`) as HTMLElement).style.width;
    expect(width("highlight")).toBe("0%");
    fireEvent.mouseEnter(r.getByTitle("E:ARIAL.TTF").closest("li") as HTMLElement);
    expect(r.getByText("E:ARIAL.TTF: 1 KB, 25.0%")).toBeTruthy();
    expect(width("highlight")).toBe("25%");
    expect(width("used")).toBe("25%");
  });

  it("drops the mark when the next listing no longer holds the hovered file", () => {
    listed([dir("E", [object("E", "ARIAL", "TTF", 1024), object("E", "LOGO", "GRF", 1024)], 2048)]);
    const r = withUsage();
    fireEvent.mouseEnter(r.getByTitle("E:ARIAL.TTF").closest("li") as HTMLElement);
    expect(r.getByText("E:ARIAL.TTF: 1 KB, 25.0%")).toBeTruthy();
    // The row can vanish under a pointer that never left it, so a fresh listing has the last word.
    listed([dir("E", [object("E", "LOGO", "GRF", 1024)], 3072)]);
    expect(r.queryByText(/E:ARIAL\.TTF: /)).toBeNull();
  });

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
