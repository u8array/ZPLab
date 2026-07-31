// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { VariablesPanel } from "./VariablesPanel";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";
import type { ColumnMapping } from "@zplab/core/types/Variable";

afterEach(cleanup);

const VAR = { id: "v1", name: "sku", fnNumber: 1, defaultValue: "" };

const csvSource = {
  kind: "csv" as const,
  filename: "d.csv",
  importedAt: "",
  encoding: "utf-8",
  delimiter: ",",
  rowCount: 2,
};

const mapping = (bindings: Record<string, string>): ColumnMapping => ({
  bindings,
  headerSnapshot: ["sku"],
});

function defaultInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input[aria-label="${en.variables.defaultLabel}"]`,
  );
  if (!el) throw new Error("default input not found");
  return el;
}

beforeEach(() => {
  act(() => {
    useLabelStore.setState({ variables: [VAR], columnMapping: null, dataset: null });
  });
});

describe("VariableRow default placeholder from bound cell", () => {
  it("shows the active row's cell value for a mapped variable", () => {
    act(() => {
      useLabelStore.getState().loadDataset({ headers: ["sku"], rows: [["A1"], ["B2"]], source: csvSource });
      useLabelStore.getState().setColumnMapping(mapping({ v1: "sku" }));
    });
    const { container } = render(<VariablesPanel />);
    expect(defaultInput(container).placeholder).toBe("A1");
  });

  it("follows the row stepper", () => {
    act(() => {
      useLabelStore.getState().loadDataset({ headers: ["sku"], rows: [["A1"], ["B2"]], source: csvSource });
      useLabelStore.getState().setColumnMapping(mapping({ v1: "sku" }));
    });
    const { container } = render(<VariablesPanel />);
    act(() => {
      useLabelStore.getState().setActiveRow(1);
    });
    expect(defaultInput(container).placeholder).toBe("B2");
  });

  it("falls back to the generic label for an empty cell", () => {
    act(() => {
      useLabelStore.getState().loadDataset({ headers: ["sku"], rows: [[""]], source: csvSource });
      useLabelStore.getState().setColumnMapping(mapping({ v1: "sku" }));
    });
    const { container } = render(<VariablesPanel />);
    expect(defaultInput(container).placeholder).toBe(en.variables.defaultLabel);
  });

  // Consistent with buildActiveRow: whitespace is a genuine print value, so it
  // is shown, not treated as empty.
  it("shows a whitespace-only cell verbatim", () => {
    act(() => {
      useLabelStore.getState().loadDataset({ headers: ["sku"], rows: [["  "]], source: csvSource });
      useLabelStore.getState().setColumnMapping(mapping({ v1: "sku" }));
    });
    const { container } = render(<VariablesPanel />);
    expect(defaultInput(container).placeholder).toBe("  ");
  });

  it("keeps the generic label when unmapped", () => {
    act(() => {
      useLabelStore.getState().loadDataset({ headers: ["sku"], rows: [["A1"]], source: csvSource });
      useLabelStore.getState().setColumnMapping(null);
    });
    const { container } = render(<VariablesPanel />);
    expect(defaultInput(container).placeholder).toBe(en.variables.defaultLabel);
  });

  // Header dropped from the dataset since the mapping was saved (stale binding).
  it("falls back when the bound header is gone from the dataset", () => {
    act(() => {
      useLabelStore.getState().loadDataset({ headers: ["qty"], rows: [["10"]], source: csvSource });
      useLabelStore.getState().setColumnMapping(mapping({ v1: "sku" }));
    });
    const { container } = render(<VariablesPanel />);
    expect(defaultInput(container).placeholder).toBe(en.variables.defaultLabel);
  });

  it("keeps the generic label with no dataset even if a mapping exists", () => {
    act(() => {
      useLabelStore.getState().setColumnMapping(mapping({ v1: "sku" }));
    });
    const { container } = render(<VariablesPanel />);
    expect(defaultInput(container).placeholder).toBe(en.variables.defaultLabel);
  });
});
