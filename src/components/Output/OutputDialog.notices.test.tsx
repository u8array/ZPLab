// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, act } from "@testing-library/react";
import { useLabelStore } from "../../store/labelStore";
import { formatTemplate } from "../../lib/formatTemplate";
import { fallbackTranslations as en } from "../../locales";
import { BASE_STATE, loc, showDialog } from "./OutputDialog.testkit";

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

const dataset = {
  headers: ["sku"],
  rows: [["A1"], ["B2"], ["C3"]],
  source: { kind: "csv" as const, filename: "t.csv", importedAt: "", encoding: "utf-8", delimiter: ",", rowCount: 3 },
  activeRowIndex: 0,
};
const variables = [{ id: "v1", name: "sku", fnNumber: 1, defaultValue: "" }];
const columnMapping = { bindings: { v1: "sku" }, headerSnapshot: ["sku"] };
const text = { id: "t", type: "text", x: 10, y: 10, rotation: 0, props: { content: "A", fontHeight: 30 } } as never;

const batchNotice = () => formatTemplate(loc.batchNoticeFmt, { n: "3" });

beforeEach(() => {
  act(() => {
    useLabelStore.setState({
      ...BASE_STATE,
      outputChoice: { kind: "print", printWay: null, fileFormat: "pdf", pdfScope: "design" },
      previewProvider: "printer",
      pages: [{ objects: [text] }],
      currentPageIndex: 0,
      variables: [],
      label: { widthMm: 50, heightMm: 30, dpmm: 8 },
    });
  });
});

describe("the notices above the ways", () => {
  it("counts the labels a mapped dataset prints", () => {
    act(() => {
      useLabelStore.setState({ dataset, columnMapping, variables });
    });
    expect(showDialog().container.textContent).toContain(batchNotice());
  });

  it("multiplies by the per-label print quantity, because ^PQ rides every recall", () => {
    act(() => {
      useLabelStore.setState({ dataset, columnMapping, variables, label: { widthMm: 50, heightMm: 30, dpmm: 8, printQuantity: 4 } });
    });
    const expected = formatTemplate(loc.batchNoticeQtyFmt, { n: "12", rows: "3", q: "4" });

    expect(showDialog().container.textContent).toContain(expected);
  });

  it("names the format a batch job stores, because the job carries its own template", () => {
    act(() => {
      useLabelStore.setState({ dataset, columnMapping, variables });
    });
    expect(showDialog().container.textContent).toContain(
      formatTemplate(en.output.storesSomeFormatFmt, { path: "R:LBL.ZPL" }),
    );
  });

  it("says nothing about the dataset for a setup script", () => {
    act(() => {
      useLabelStore.setState({ dataset, columnMapping, variables });
    });
    expect(showDialog({ source: "setupScript" }).container.textContent).not.toContain(batchNotice());
  });

  it("names what the document stores on the printer, from the document and not from the job" , () => {
    act(() => {
      useLabelStore.setState({ pages: [{ objects: [text], storedFormatPath: "R:LBL.ZPL" }] });
    });
    const r = showDialog({ zpl: () => "^XA^XZ" });

    expect(r.container.textContent).toContain(formatTemplate(en.output.storesFormatFmt, { path: "R:LBL.ZPL" }));
  });

  it("names a page that only recalls its format", () => {
    act(() => {
      useLabelStore.setState({ pages: [{ objects: [text], storedFormatPath: "E:JOB.ZPL", storedFormatDelivery: "printer" }] });
    });
    expect(showDialog().container.textContent).toContain(formatTemplate(en.output.recallOnlyPrinterFmt, { path: "E:JOB.ZPL" }));
  });

  it("leaves the printer's own settings unremarked", () => {
    act(() => {
      useLabelStore.setState({ pages: [{ objects: [text], storedFormatPath: "R:LBL.ZPL" }] });
    });
    const r = showDialog({ source: "setupScript" });

    expect(r.container.textContent).not.toContain(formatTemplate(en.output.storesFormatFmt, { path: "R:LBL.ZPL" }));
  });
});
