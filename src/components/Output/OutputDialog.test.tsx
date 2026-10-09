// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { OutputDialog } from "./OutputDialog";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_OUTPUT_CHOICE, type OutputFacts } from "../../lib/outputChoice";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);

const loc = en.zebraPrint;

const everything: OutputFacts = {
  hasObjects: true,
  documentEmits: true,
  sourceEditing: false,
  canBatchExport: true,
  canBatchPdf: true,
  pdfCurrentPageOnly: false,
  batchRowCount: 3,
};

beforeEach(() => {
  act(() => {
    useLabelStore.setState({
      zebraPrintSource: "label",
      outputChoice: DEFAULT_OUTPUT_CHOICE,
      printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175" },
    });
  });
});

const show = (over: Partial<Parameters<typeof OutputDialog>[0]> = {}) => {
  const props = {
    zpl: () => "^XA^XZ",
    source: "label" as const,
    facts: everything,
    onClose: vi.fn(),
    onPrintImage: vi.fn(() => undefined),
    onExportPdf: vi.fn(),
    ...over,
  };
  return { ...render(<OutputDialog {...props} />), props };
};

describe("OutputDialog", () => {
  it("opens on the ways to the printer and offers the two other kinds", () => {
    const r = show();

    expect(r.getByText(loc.kindImage)).toBeTruthy();
    expect(r.getByText(loc.kindPdf)).toBeTruthy();
    // The ZPL kind shows the send panel, address field and all.
    expect(r.getByDisplayValue("172.17.17.175")).toBeTruthy();
  });

  it("proposes the kind chosen last when it opens again", () => {
    const first = show();
    act(() => {
      fireEvent.click(first.getByText(loc.kindPdf));
    });
    expect(useLabelStore.getState().outputChoice.kind).toBe("pdf");

    cleanup();
    expect(show().getByText(en.app.exportPdf)).toBeTruthy();
  });

  it("puts a setup script on the printer and leaves nothing to choose", () => {
    const r = show({ source: "setupScript" });

    // Printer settings are nothing to put on paper, so the first level has one entry and stays away.
    expect(r.queryByText(loc.kindImage)).toBeNull();
    expect(r.queryByText(loc.kindPdf)).toBeNull();
    expect(r.getByText(loc.heading)).toBeTruthy();
  });

  it("hides the rendered kinds for a document with nothing to draw", () => {
    // A config-only overlay emits code but renders a blank sheet, as the menu entries already say.
    const r = show({ facts: { ...everything, hasObjects: false } });

    expect(r.queryByText(loc.kindImage)).toBeNull();
    expect(r.queryByText(loc.kindPdf)).toBeNull();
    expect(r.getByDisplayValue("172.17.17.175")).toBeTruthy();
  });

  it("offers the batch only where a dataset and a renderer meet", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "pdf" });
    });
    expect(show().getByText(loc.scopeBatch)).toBeTruthy();

    cleanup();
    // Without a renderer the batch export returns without a file, so it is not on offer.
    const alone = show({ facts: { ...everything, canBatchPdf: false } });
    expect(alone.queryByText(loc.scopeBatch)).toBeNull();
    expect(alone.queryByText(loc.scopeDesign)).toBeNull();
  });

  it("keeps a batch it cannot offer, so a dataset brings the choice back", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "pdf", pdfScope: "batch" });
    });
    show({ facts: { ...everything, canBatchExport: false } });

    expect(useLabelStore.getState().outputChoice.pdfScope).toBe("batch");
  });

  it("names on the button what the export covers", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "pdf" });
    });
    expect(show({ facts: { ...everything, pdfCurrentPageOnly: true } }).getByText(en.app.exportPdfCurrentPage)).toBeTruthy();
  });

  it("commits the user to as many pages as the menu entry would", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "pdf", pdfScope: "batch" });
    });
    const r = show({ facts: { ...everything, batchRowCount: 10_000 } });

    // A ten thousand page render may not start without saying so, as the menu entry does not.
    expect(r.getByText(en.app.exportBatchPdfFmt.replace("{n}", "10000"))).toBeTruthy();
  });

  it("steps aside at once when the work has not started", () => {
    const r = show();
    act(() => {
      fireEvent.click(r.getByText(loc.kindImage));
    });
    act(() => {
      fireEvent.click(r.getByText(loc.imagePrint));
    });

    // Nothing came back, so a notice is waiting to be answered and this modal is in its way.
    expect(r.props.onClose).toHaveBeenCalled();
    expect(r.props.onPrintImage).toHaveBeenCalled();
  });

  it("stays and shows the wait while the label renders", async () => {
    let finish: () => void = () => undefined;
    const onPrintImage = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const r = show({ onPrintImage });
    act(() => {
      fireEvent.click(r.getByText(loc.kindImage));
    });
    act(() => {
      fireEvent.click(r.getByText(loc.imagePrint));
    });

    // Several seconds over the network, and a closed dialog would leave the click unanswered.
    expect(r.props.onClose).not.toHaveBeenCalled();
    expect((r.getByText(loc.imagePrint) as HTMLButtonElement).disabled).toBe(true);
    expect(r.container.querySelector(".animate-pulse")).toBeTruthy();

    await act(async () => {
      finish();
    });
    expect(r.props.onClose).toHaveBeenCalled();
  });

  it("hands the PDF export the scope that is showing", () => {
    act(() => {
      useLabelStore.getState().setOutputChoice({ kind: "pdf" });
    });
    const r = show();
    act(() => {
      fireEvent.click(r.getByText(loc.scopeBatch));
    });
    act(() => {
      fireEvent.click(r.getByText(en.app.exportBatchPdfFmt.replace("{n}", "3")));
    });

    expect(r.props.onExportPdf).toHaveBeenCalledWith("batch");
  });

  it("reads the code only for the kind that sends it", () => {
    const zpl = vi.fn(() => "^XA^XZ");
    const r = show({ zpl });
    expect(zpl).toHaveBeenCalled();

    zpl.mockClear();
    act(() => {
      fireEvent.click(r.getByText(loc.kindPdf));
    });
    // A mapped dataset regenerates the whole batch, which the PDF and image bodies never read.
    expect(zpl).not.toHaveBeenCalled();
  });
});
