import { render } from "@testing-library/react";
import { vi } from "vitest";
import { OutputDialog } from "./OutputDialog";
import { type OutputFacts } from "../../lib/outputChoice";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";

export const loc = en.zebraPrint;

export const everything: OutputFacts = {
  hasObjects: true,
  documentEmits: true,
  sourceEditing: false,
  canBatchExport: true,
  canBatchPdf: true,
  pdfCurrentPageOnly: false,
  batchRowCount: 3,
};

/** Everything the dialog needs to open on the printer ways, with an address to send to. */
export const BASE_STATE = {
  outputSource: "label" as const,
  printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175" },
  printerReading: undefined,
  thirdParty: { labelary: true },
  dataset: null,
  columnMapping: null,
  labelaryNoticeAcknowledged: true,
};

// The kind segment and the system way's button read the same word, so the body's is the later one.
export function printButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .filter((b) => b.textContent === loc.kindPrint)
    .at(-1);
  if (button === undefined) throw new Error("no print button in the dialog");
  return button;
}

export const batchScope = (n: number) =>
  loc.scopeCountFmt.replace("{label}", loc.scopeBatch).replace("{n}", String(n));

export const showDialog = (over: Partial<Parameters<typeof OutputDialog>[0]> = {}) => {
  const props = {
    zpl: () => "^XA^XZ",
    source: "label" as const,
    facts: everything,
    onClose: vi.fn(),
    onPrintImage: vi.fn(() => Promise.resolve()),
    onExportPdf: vi.fn(),
    onExportPng: vi.fn(),
    ...over,
  };
  // The shell portals into the body, so the body is the container the assertions read.
  return { ...render(<OutputDialog {...props} />), container: document.body, props };
};
