// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { StoredGraphicsTab } from "./StoredGraphicsTab";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import type { LabelObject } from "@zplab/core/types/Group";
import { fallbackTranslations as en } from "../../locales";
import type { HostDirectory } from "@zplab/core/lib/hostDirectory";

vi.mock("../../lib/platform", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isDesktopShell: true }));

const loc = en.printerSettings.objects;
const object = (device: string, name: string, ext: string, size = 1000) => ({ device, name, ext, size });
const dir = (device: string, objects: HostDirectory["objects"]): HostDirectory => ({ device, objects, bytesFree: undefined });
const listed = (directories: HostDirectory[]) =>
  act(() => useLabelStore.setState({ printerObjects: { phase: "done", key: "net:172.17.17.175:9100", at: 0, directories } }));

beforeEach(() => {
  act(() =>
    useLabelStore.setState({
      pages: [{ objects: [] }],
      printerProfile: {},
      printerObjects: { phase: "idle" },
      printerReading: undefined,
      printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175" },
    }),
  );
});

afterEach(cleanup);

describe("StoredGraphicsTab against the printer", () => {
  it("lists a profile entry and the printer's own graphics in one list, each with its origin", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: "^GFA,1,1,1,00" }] } }));
    listed([
      dir("R", [object("R", "LOGO", "GRF"), object("R", "LBL", "ZPL")]),
      dir("E", [object("E", "CHK06", "PNG", 2203)]),
    ]);
    const r = render(<StoredGraphicsTab />);
    expect(r.getAllByTitle(/^[RE]:/).map((el) => el.getAttribute("title"))).toEqual(["R:LOGO.GRF", "E:CHK06.PNG"]);
    expect(r.getByText(loc.originOnPrinter)).toBeTruthy();
    expect(r.getByText(loc.originPrinterOnly)).toBeTruthy();
    expect(r.getAllByText(loc.showObject)).toHaveLength(2);
  });

  it("names a profile entry the printer does not hold", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupGraphics: [{ path: "R:LOGO.GRF", gfa: "^GFA,1,1,1,00" }] } }));
    listed([dir("R", [])]);
    const r = render(<StoredGraphicsTab />);
    expect(r.getByText(loc.originMissing)).toBeTruthy();
    expect(r.queryByText(loc.showObject)).toBeNull();
  });

  it("calls a recall whose bytes are gone the printer's own copy, and says so before deleting it", () => {
    const orphan = {
      id: "img1",
      type: "image",
      x: 0,
      y: 0,
      rotation: 0,
      props: { imageId: "", widthDots: 8, heightDots: 4, threshold: 128, storedAs: { device: "R", name: "LOGO", embedInZpl: false } },
    } as unknown as LabelObject;
    act(() => useLabelStore.setState({ pages: [{ objects: [orphan] }] }));
    listed([dir("R", [object("R", "LOGO", "GRF")])]);
    const r = render(<StoredGraphicsTab />);
    expect(r.getByText(loc.originPrinterOnly)).toBeTruthy();
    fireEvent.click(r.getByText(loc.deleteObject));
    expect(r.getByRole("alertdialog").textContent).toContain(loc.deleteNoCopyHint);
  });

  it("keeps the local image cache a section of its own", () => {
    listed([dir("R", [object("R", "LOGO", "GRF")])]);
    const r = render(<StoredGraphicsTab />);
    expect(r.getByText(loc.cacheHeading)).toBeTruthy();
    expect(r.getByText(loc.noCached)).toBeTruthy();
  });
});
