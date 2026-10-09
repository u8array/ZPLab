// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, act, fireEvent } from "@testing-library/react";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";
import { formatTemplate } from "../../lib/formatTemplate";
import { BASE_STATE, batchScope, everything, loc, printButton, showDialog } from "./OutputDialog.testkit";

// The printer ways and the printer render only exist in the desktop shell.
vi.mock("../../lib/platform", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isDesktopShell: true }));
vi.mock("../../lib/localPrint", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listLocalPrinters: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../lib/usbPrint", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listUsbPrinters: vi.fn().mockResolvedValue([]),
}));

afterEach(cleanup);

beforeEach(() => {
  act(() => {
    useLabelStore.setState({
      ...BASE_STATE,
      outputChoice: { kind: "print", printWay: null, fileFormat: "pdf", pdfScope: "design" },
      previewProvider: "printer",
    });
  });
});

describe("OutputDialog", () => {
  it("opens on the ways to the printer and offers the file next to them", () => {
    const r = showDialog();

    expect(r.getByText(loc.kindFile)).toBeTruthy();
    expect(r.getByText(loc.tabSystem)).toBeTruthy();
    expect(r.getByDisplayValue("172.17.17.175")).toBeTruthy();
  });

  it("marks the kind showing as the current one", () => {
    const r = showDialog();

    expect(r.getByText(loc.kindFile).getAttribute("aria-current")).toBeNull();
    expect(r.getAllByText(loc.kindPrint)[0]!.getAttribute("aria-current")).toBe("page");
  });

  it("proposes the kind chosen last when it opens again", () => {
    const first = showDialog();
    act(() => {
      fireEvent.click(first.getByText(loc.kindFile));
    });
    expect(useLabelStore.getState().outputChoice.kind).toBe("file");

    cleanup();
    expect(showDialog().getByText(en.app.exportPdf)).toBeTruthy();
  });

  it("puts a setup script on the printer and leaves nothing to choose", () => {
    const r = showDialog({ source: "setupScript" });

    expect(r.queryByText(loc.kindFile)).toBeNull();
    // A setup script draws nothing, so the way that renders is not on offer either.
    expect(r.queryByText(loc.tabSystem)).toBeNull();
    expect(r.getByText(loc.heading)).toBeTruthy();
  });

  it("titles itself as the menu entry names it", () => {
    expect(showDialog().getByText(loc.outputHeading)).toBeTruthy();
  });

  it("hides what needs drawing for a document with nothing to draw", () => {
    const r = showDialog({ facts: { ...everything, hasObjects: false } });

    expect(r.queryByText(loc.kindFile)).toBeNull();
    expect(r.queryByText(loc.tabSystem)).toBeNull();
    expect(r.getByDisplayValue("172.17.17.175")).toBeTruthy();
  });

  it("offers the batch only where a dataset and a renderer meet", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "file" });
    });
    expect(showDialog().getByText(batchScope(3))).toBeTruthy();

    cleanup();
    // Without a renderer the batch export returns without a file, so it is not on offer.
    const alone = showDialog({ facts: { ...everything, canBatchPdf: false } });
    expect(alone.queryByText(batchScope(3))).toBeNull();
    // One scope is no choice, so nothing asks for it.
    expect(alone.queryByText(loc.scopeHeading)).toBeNull();
    expect(alone.container.querySelector("input[type=radio]")).toBeNull();
  });

  it("keeps a batch it cannot offer, so a dataset brings the choice back", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "file", pdfScope: "batch" });
    });
    showDialog({ facts: { ...everything, canBatchExport: false } });

    expect(useLabelStore.getState().outputChoice.pdfScope).toBe("batch");
  });

  it("names on the button what the export covers", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "file" });
    });
    expect(showDialog({ facts: { ...everything, pdfCurrentPageOnly: true } }).getByText(en.app.exportPdfCurrentPage)).toBeTruthy();
  });

  it("names the ten thousand pages on the scope, not on the button", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "file", pdfScope: "batch" });
    });
    const r = showDialog({ facts: { ...everything, batchRowCount: 10_000 } });

    // A ten thousand page render may not start without saying so.
    expect(r.getByText(batchScope(10_000))).toBeTruthy();
    expect(r.getByText(en.app.exportPdf)).toBeTruthy();
  });

  it("asks for consent before the third-party render and stays open meanwhile", async () => {
    act(() => {
      useLabelStore.setState({ previewProvider: "labelary", labelaryNoticeAcknowledged: false });
    });
    const r = showDialog();
    act(() => {
      fireEvent.click(r.getByText(loc.tabSystem));
    });
    act(() => {
      fireEvent.click(printButton(r.container));
    });

    // The waiting state must be the same on the first print as on every later one.
    expect(r.getByText(en.output.previewNoticeTitle)).toBeTruthy();
    expect(r.props.onClose).not.toHaveBeenCalled();
    expect(r.props.onPrintImage).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(r.getByText(en.output.previewNoticeAcknowledge));
    });
    expect(r.props.onPrintImage).toHaveBeenCalled();
    expect(useLabelStore.getState().labelaryNoticeAcknowledged).toBe(true);
  });

  it("stays and says that the label is rendering", async () => {
    let finish: () => void = () => undefined;
    const onPrintImage = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const r = showDialog({ onPrintImage });
    act(() => {
      fireEvent.click(r.getByText(loc.tabSystem));
    });
    act(() => {
      fireEvent.click(printButton(r.container));
    });

    // Several seconds over the network, and a closed dialog would leave the click unanswered.
    expect(r.props.onClose).not.toHaveBeenCalled();
    expect(printButton(r.container).disabled).toBe(true);
    const line = r.getByText(loc.systemRendering);
    expect(line.getAttribute("aria-live")).toBe("polite");
    expect(r.container.querySelector("[aria-busy]")).toBeTruthy();

    await act(async () => {
      finish();
    });
    expect(r.props.onClose).toHaveBeenCalled();
  });

  it("locks the system way's print only while a read holds the channel the render needs", () => {
    act(() => {
      useLabelStore.setState({ printerReading: "~HI" });
    });
    const r = showDialog();
    act(() => {
      fireEvent.click(r.getByText(loc.tabSystem));
    });
    expect(printButton(r.container).disabled).toBe(true);

    cleanup();
    // A Labelary render never touches the printer, so a read in flight is none of its business.
    act(() => {
      useLabelStore.setState({ previewProvider: "labelary", printerReading: "~HI" });
    });
    const web = showDialog();
    act(() => {
      fireEvent.click(web.getByText(loc.tabSystem));
    });
    expect(printButton(web.container).disabled).toBe(false);
  });

  it("keeps the system way out of the address form it has no use for", () => {
    const r = showDialog();
    act(() => {
      fireEvent.click(r.getByText(loc.tabSystem));
    });

    expect(r.queryByDisplayValue("172.17.17.175")).toBeNull();
    expect(r.getByText(loc.tabSystem).getAttribute("aria-current")).toBe("page");
    expect(useLabelStore.getState().printTarget.transport).toBe("network");
  });

  it("writes the Zebra way to the print target and leaves it alone for the system way", () => {
    // USB is not offered in this build, so any write the strip makes to the target would show.
    act(() => {
      useLabelStore.getState().setPrintTarget({ transport: "usb" });
    });
    const r = showDialog();
    act(() => {
      fireEvent.click(r.getByText(loc.tabSystem));
    });
    expect(useLabelStore.getState().outputChoice.printWay).toBe("system");
    expect(useLabelStore.getState().printTarget.transport).toBe("usb");

    act(() => {
      fireEvent.click(r.getByText(loc.tabNetwork));
    });
    expect(useLabelStore.getState().outputChoice.printWay).toBeNull();
    expect(useLabelStore.getState().printTarget.transport).toBe("network");
  });

  it("hands the PDF export the scope that is showing", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "file" });
    });
    const r = showDialog();
    act(() => {
      fireEvent.click(r.getByText(batchScope(3)));
    });
    act(() => {
      fireEvent.click(r.getByText(en.app.exportPdf));
    });

    expect(r.props.onExportPdf).toHaveBeenCalledWith("batch");
  });

  it("saves a PNG from the canvas and remembers the format", () => {
    const r = showDialog();
    act(() => {
      fireEvent.click(r.getByText(loc.kindFile));
    });
    act(() => {
      fireEvent.click(r.getByText(loc.formatPng));
    });
    // The PDF scope is the PDF's own question, so the PNG body does not ask it.
    expect(r.queryByText(batchScope(3))).toBeNull();

    act(() => {
      fireEvent.click(r.getByText(en.app.exportPng));
    });
    expect(r.props.onExportPng).toHaveBeenCalled();
    expect(r.props.onClose).toHaveBeenCalled();
    expect(useLabelStore.getState().outputChoice.fileFormat).toBe("png");
  });

  it("says on the system way which row of a mapped dataset prints, and names no batch total", () => {
    const activeRowLine = (n: string, rows: string) => formatTemplate(loc.systemActiveRowOnlyFmt, { n, rows });
    act(() => {
      useLabelStore.getState().setOutputChoice({ printWay: "system" });
    });
    expect(showDialog().container.textContent).not.toContain(activeRowLine("1", "2"));

    cleanup();
    act(() => {
      useLabelStore.setState({
        dataset: {
          headers: ["sku"],
          rows: [["A1"], ["B2"]],
          source: { kind: "csv", filename: "t.csv", importedAt: "", encoding: "utf-8", delimiter: ",", rowCount: 2 },
          activeRowIndex: 1,
        },
        columnMapping: { bindings: { v1: "sku" }, headerSnapshot: ["sku"] },
        variables: [{ id: "v1", name: "sku", fnNumber: 1, defaultValue: "" }],
      });
    });
    const shown = showDialog().container.textContent;

    expect(shown).toContain(activeRowLine("2", "2"));
    expect(shown).not.toContain(formatTemplate(loc.batchNoticeFmt, { n: "2" }));
  });

  it("keeps the batch total on a Zebra way, which sends every row", () => {
    act(() => {
      useLabelStore.setState({
        dataset: {
          headers: ["sku"],
          rows: [["A1"], ["B2"]],
          source: { kind: "csv", filename: "t.csv", importedAt: "", encoding: "utf-8", delimiter: ",", rowCount: 2 },
          activeRowIndex: 0,
        },
        columnMapping: { bindings: { v1: "sku" }, headerSnapshot: ["sku"] },
        variables: [{ id: "v1", name: "sku", fnNumber: 1, defaultValue: "" }],
      });
    });
    expect(showDialog().container.textContent).toContain(formatTemplate(loc.batchNoticeFmt, { n: "2" }));
  });

  it("reads the code only where it is sent", () => {
    const zpl = vi.fn(() => "^XA^XZ");
    const r = showDialog({ zpl });
    expect(zpl).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(r.getByText(loc.kindFile));
    });
    expect(zpl).not.toHaveBeenCalled();

    cleanup();
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "print", printWay: "system" });
    });
    const system = vi.fn(() => "^XA^XZ");
    showDialog({ zpl: system });

    expect(system).not.toHaveBeenCalled();
  });
});
