// The two levels of the output dialog: what the label becomes, and how, where there is a choice.

/** The bytes the dialog is about: the label itself, or a script that only configures the printer. */
export type OutputSource = "label" | "setupScript";

/** What the label becomes. */
export type OutputKind = "zpl" | "image" | "pdf";

/** The second level of the PDF kind. The batch count is shown and not chosen, so this is all that
 *  is left to decide. */
export type PdfScope = "design" | "batch";

/** What the dialog proposes again next time. The transport way is not in here: it already rides the
 *  print target, where the printer settings read it too. */
export interface OutputChoice {
  kind: OutputKind;
  pdfScope: PdfScope;
}

export const DEFAULT_OUTPUT_CHOICE: OutputChoice = { kind: "zpl", pdfScope: "design" };

/** What this document can produce, in the terms the menu already works out. The menu entries and
 *  the dialog read the same answer, so they cannot disagree about what is possible. */
export interface OutputFacts {
  hasObjects: boolean;
  documentEmits: boolean;
  /** A live source-edit session may not emit the document it is about to replace. */
  sourceEditing: boolean;
  canBatchExport: boolean;
  canBatchPdf: boolean;
  /** Named on the batch action, so the dialog commits the user to as many pages as the menu does. */
  batchRowCount: number;
  /** Without a renderer the PDF holds the current page only, which the action names. */
  pdfCurrentPageOnly: boolean;
}

/** A config-only overlay stream is a legitimate setup job, so ZPL goes out where nothing renders.
 *  The two rendered kinds need objects, because rendering nothing has no value. */
export const producibleKinds = (f: OutputFacts): Record<OutputKind, boolean> => {
  const live = !f.sourceEditing;
  return {
    zpl: live && f.documentEmits,
    image: live && f.hasObjects,
    pdf: live && f.hasObjects,
  };
};

/** The one door to the dialog, open as soon as anything at all can come out of it. */
export const anyProducible = (f: OutputFacts): boolean => Object.values(producibleKinds(f)).some(Boolean);

/** A setup script is the printer's own settings and nothing to put on paper, so it goes one way and
 *  asks nothing of the document. */
export function offeredKinds(source: OutputSource, f: OutputFacts): OutputKind[] {
  if (source === "setupScript") return ["zpl"];
  const can = producibleKinds(f);
  return (["zpl", "image", "pdf"] as const).filter((kind) => can[kind]);
}

/** The batch needs a mapped dataset and a renderer that can draw every row. Without both there is
 *  nothing to choose, and the export covers the whole design. */
export function offeredScopes(f: OutputFacts): PdfScope[] {
  return f.canBatchExport && f.canBatchPdf ? ["design", "batch"] : ["design"];
}

/** Falls back to the choice that always holds, without touching what is remembered. Mapping a
 *  dataset again brings the batch back on its own. */
export const effectiveKind = (kind: OutputKind, offered: OutputKind[]): OutputKind =>
  offered.includes(kind) ? kind : (offered[0] ?? "zpl");

export const effectiveScope = (scope: PdfScope, offered: PdfScope[]): PdfScope => (offered.includes(scope) ? scope : "design");
