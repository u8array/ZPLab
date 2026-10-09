import { describe, it, expect, beforeEach } from "vitest";
import { exportPrinterImpact } from "./exportImpact";
import { sendZpl } from "./sendZpl";
import { useLabelStore } from "../store/labelStore";
import type { Page } from "@zplab/core/types/Group";

const pages: Page[] = [
  { objects: [{ id: "t", type: "text", x: 10, y: 10, rotation: 0, props: { content: "[sku]", fontHeight: 30 } } as never] },
];
const dataset = {
  headers: ["sku"],
  rows: [["A1"], ["B2"], ["C3"]],
  source: { kind: "csv" as const, filename: "t.csv", importedAt: "", encoding: "utf-8", delimiter: ",", rowCount: 3 },
  activeRowIndex: 0,
};

beforeEach(() => {
  useLabelStore.setState({
    label: { widthMm: 50, heightMm: 30, dpmm: 8 },
    pages,
    currentPageIndex: 0,
    variables: [{ id: "v1", name: "sku", fnNumber: 1, defaultValue: "" }],
    dataset: null,
    columnMapping: null,
    keepExportMetadata: false,
  });
});

describe("sendZpl", () => {
  it("emits the document when no dataset is mapped", () => {
    const zpl = sendZpl(useLabelStore.getState());
    expect(zpl).toContain("^FD[sku]");
    expect(zpl).not.toContain("^XF");
  });

  it("emits the batch job once a dataset is mapped", () => {
    useLabelStore.setState({ dataset, columnMapping: { bindings: { v1: "sku" }, headerSnapshot: ["sku"] } });
    const zpl = sendZpl(useLabelStore.getState());

    expect(zpl).toContain("^DFR:LBL.ZPL");
    expect(zpl.match(/\^XFR:LBL\.ZPL/g)).toHaveLength(3);
  });

  it("keeps the printer impact of the whole job in a one-row sample", () => {
    useLabelStore.setState({ dataset, columnMapping: { bindings: { v1: "sku" }, headerSnapshot: ["sku"] } });
    const s = useLabelStore.getState();

    expect(sendZpl(s, 1).match(/\^XFR:LBL\.ZPL/g)).toHaveLength(1);
    expect(exportPrinterImpact(sendZpl(s, 1))).toEqual(exportPrinterImpact(sendZpl(s)));
  });
});
