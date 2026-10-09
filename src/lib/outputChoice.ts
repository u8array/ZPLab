// The two levels of the output dialog: where the label goes, and how, where there is a choice.
import { effectiveTransport, type PrintTransport, type PrintWay } from "./printTarget";

/** The bytes the dialog is about: the label itself, or a script that only configures the printer. */
export type OutputSource = "label" | "setupScript";

export type OutputKind = "print" | "file";

export type FileFormat = "pdf" | "png";

/** The batch count is shown and not chosen, so the scope is all that is left to decide. */
export type PdfScope = "design" | "batch";

/** What the dialog proposes again next time. */
export interface OutputChoice {
  kind: OutputKind;
  /** Only the system dialog, because the four Zebra ways are the print target the printer settings own. */
  printWay: "system" | null;
  fileFormat: FileFormat;
  pdfScope: PdfScope;
}

/** The desktop shell owns a printer channel, so the code is the shortest way out, and a browser tab has
 *  only the system dialog. */
export const defaultOutputChoice = (desktop: boolean): OutputChoice => ({
  kind: "print",
  printWay: desktop ? null : "system",
  fileFormat: "pdf",
  pdfScope: "design",
});

/** What this document can produce, in the terms the menu already works out. The menu entries and
 *  the dialog read the same answer, so they cannot disagree about what is possible. */
export interface OutputFacts {
  hasObjects: boolean;
  /** An overlay page emits even with no objects, so emitting and saving gate on this, not on hasObjects. */
  documentEmits: boolean;
  /** A live source-edit session may not emit the document it is about to replace. */
  sourceEditing: boolean;
  canBatchExport: boolean;
  /** A batch PDF needs a renderer for every row. */
  canBatchPdf: boolean;
  /** Named on the batch action, so the dialog commits the user to as many pages as the menu does. */
  batchRowCount: number;
  /** Without a renderer the PDF holds the current page only, which the action names. */
  pdfCurrentPageOnly: boolean;
}

/** A config-only overlay stream is a legitimate setup job, so the printer ways stay open where nothing
 *  renders. A file always holds the drawn label and needs objects. */
const producibleKinds = (f: OutputFacts): Record<OutputKind, boolean> => {
  const live = !f.sourceEditing;
  return {
    print: live && f.documentEmits,
    file: live && f.hasObjects,
  };
};

export const anyProducible = (f: OutputFacts): boolean => Object.values(producibleKinds(f)).some(Boolean);

/** A setup script asks nothing of the document. */
export function offeredKinds(source: OutputSource, f: OutputFacts): OutputKind[] {
  if (source === "setupScript") return ["print"];
  const can = producibleKinds(f);
  return (["print", "file"] as const).filter((kind) => can[kind]);
}

/** A rendered label is what the system dialog and a PNG carry, and a setup script draws nothing. */
export const renderableOutput = (source: OutputSource, f: OutputFacts): boolean =>
  source === "label" && f.hasObjects && !f.sourceEditing;

/** The batch needs a mapped dataset and a renderer that can draw every row. Without both there is
 *  nothing to choose, and the export covers the whole design. */
export function offeredScopes(f: OutputFacts): PdfScope[] {
  return f.canBatchExport && f.canBatchPdf ? ["design", "batch"] : ["design"];
}

/** Falls back to the choice that always holds, without touching what is remembered. Mapping a
 *  dataset again brings the batch back on its own. */
export const effectiveKind = (kind: OutputKind, offered: OutputKind[]): OutputKind =>
  offered.includes(kind) ? kind : (offered[0] ?? "print");

export const effectiveScope = (scope: PdfScope, offered: PdfScope[]): PdfScope => (offered.includes(scope) ? scope : "design");

/** The way the dialog shows and the Zebra tab behind it. A remembered system dialog wins while it is on
 *  offer, and otherwise the stored Zebra way decides, so a change in the printer settings carries over. */
export function effectivePrintWay(
  remembered: "system" | null,
  stored: PrintTransport,
  offered: readonly PrintWay[],
): { way: PrintWay; tab: PrintTransport } {
  const tab = effectiveTransport(stored, offered);
  return { way: remembered === "system" && offered.includes("system") ? "system" : tab, tab };
}
