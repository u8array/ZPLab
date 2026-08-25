import { importZplText, mergeSetupFonts, replaceImportLabel } from "./zplImportService";
import type { ImportReport } from "./zplParser";
import type { LabelConfig } from "../types/LabelConfig";
import type { PrinterProfile } from "../types/PrinterProfile";
import type { Page } from "../types/Group";
import type { ColumnMapping, Variable } from "../types/Variable";
import { diffEditorState, type EditorStateDiff } from "./editorStateDiff";
import { remapBindingsByFn } from "./variableBinding";

/** A textarea freezes on one megabyte-scale ^GF/~DY payload line long before
 *  the parser would mind. Sized well above a whole single-line foreign label
 *  (driver dumps replay through the overlay with their original line breaks),
 *  below a full-bleed graphic payload. */
export const MAX_SOURCE_LINE_CHARS = 64 * 1024;
export const MAX_SOURCE_CHARS = 512 * 1024;
/** Past this the document is a paste accident, and render/persist costs grow
 *  past interactive. The MCP boundary shares it as its envelope page cap. */
export const MAX_SOURCE_PAGES = 1000;

export type SourceGate =
  | { ok: true }
  | { ok: false; reason: "blobLine" | "tooLarge"; command?: string };

export function sourceEditGate(zpl: string): SourceGate {
  if (zpl.length > MAX_SOURCE_CHARS) return { ok: false, reason: "tooLarge" };
  let start = 0;
  while (start < zpl.length) {
    let end = zpl.indexOf("\n", start);
    if (end === -1) end = zpl.length;
    if (end - start > MAX_SOURCE_LINE_CHARS) {
      const cmd = /^[\^~][A-Z@][A-Z0-9]?/.exec(zpl.slice(start, start + 3));
      return { ok: false, reason: "blobLine", ...(cmd ? { command: cmd[0] } : {}) };
    }
    start = end + 1;
  }
  return { ok: true };
}

/** The document fields a source apply replaces, as one shape for the input
 *  snapshot, the committable result and the store's atomic set. */
export interface SourceDocumentState {
  label: LabelConfig;
  pages: Page[];
  variables: Variable[];
  printerProfile: PrinterProfile;
  columnMapping: ColumnMapping | null;
}

export interface SourceApplyInput {
  text: string;
  /** The session's untouched buffer: keys it set that the edit removed were
   *  deleted by the user and clear (the ^JM absent-means-cleared rule,
   *  generalized). */
  baseline?: string;
  current: SourceDocumentState;
}

export type SourceApplyPlan =
  | {
      ok: false;
      reason: "empty" | "noContent" | "blobLine" | "tooLarge" | "unbalanced" | "tooManyPages";
      command?: string;
    }
  | SourceApplyOk;

export interface SourceApplyOk {
  ok: true;
  /** The complete post-apply document state, atomically committable. */
  next: SourceDocumentState;
  report: ImportReport;
  objectCount: number;
  loss: EditorStateDiff;
}

/** Keys the baseline stream set that the edited stream dropped were deleted
 *  by the user; `keep` names the fields no buffer edit may clear. */
function stripDeletedKeys<T extends object>(
  merged: T,
  baselineKeys: readonly string[],
  editedKeys: ReadonlySet<string>,
  keep: readonly string[],
): T {
  const gone = new Set(baselineKeys.filter((k) => !editedKeys.has(k) && !keep.includes(k)));
  if (gone.size === 0) return merged;
  return Object.fromEntries(Object.entries(merged).filter(([k]) => !gone.has(k))) as T;
}

/** Turn an edited source buffer into a committable document state. Pure: the
 *  caller decides whether to commit. Refuses (empty/noContent/gate/unbalanced/
 *  page cap) instead of healing; setup commands stay in the label ("keep"),
 *  their replayRisk findings ride along in the report instead of a routing
 *  prompt; `next.pages` is never empty. */
export function prepareSourceApply(input: SourceApplyInput): SourceApplyPlan {
  const { current } = input;
  if (input.text.trim() === "") return { ok: false, reason: "empty" };
  const gate = sourceEditGate(input.text);
  if (!gate.ok) return gate;

  // Same dpmm path as the import modal: a ZPLLAB ^FX sidecar in the text wins,
  // foreign text inherits the open label's density.
  const imported = importZplText(input.text, current.label.dpmm);
  // The parser is the only ^CC-aware lexer, so the balance verdict is its: an
  // open format never prints, and its overlay would replay the broken bytes.
  if (imported.unbalancedFormat) return { ok: false, reason: "unbalanced" };
  if (imported.pages.length > MAX_SOURCE_PAGES) return { ok: false, reason: "tooManyPages" };
  const objectCount = imported.pages.reduce((s, p) => s + p.objects.length, 0);
  if (
    objectCount === 0 &&
    Object.keys(imported.labelConfig).length === 0 &&
    Object.keys(imported.printerProfile).length === 0
  ) {
    return { ok: false, reason: "noContent" };
  }

  let label = replaceImportLabel(current.label, imported.labelConfig);
  const profilePatch = imported.printerProfile.setupFonts
    ? {
        ...imported.printerProfile,
        setupFonts: mergeSetupFonts(
          current.printerProfile.setupFonts,
          imported.printerProfile.setupFonts,
        ),
      }
    : imported.printerProfile;
  let printerProfile = { ...current.printerProfile, ...profilePatch };
  // An empty baseline (authoring from scratch) has no keys to strip.
  if (input.baseline !== undefined && input.baseline !== '' && input.baseline !== input.text) {
    const base = importZplText(input.baseline, current.label.dpmm);
    label = stripDeletedKeys(
      label,
      Object.keys(base.labelConfig),
      new Set(Object.keys(imported.labelConfig)),
      // The sidecar trio is document identity, not a deletable command.
      ["dpmm", "widthMm", "heightMm"],
    );
    printerProfile = stripDeletedKeys(
      printerProfile,
      Object.keys(base.printerProfile),
      new Set(Object.keys(imported.printerProfile)),
      // setupFonts merge additively by contract (a stream expresses no deletion).
      ["setupFonts"],
    );
  }

  const remapped = remapBindingsByFn(current.variables, current.columnMapping, imported.variables);
  const loss = diffEditorState(
    { pages: current.pages, variables: current.variables },
    { pages: imported.pages, variables: imported.variables },
    remapped.lost,
  );

  // lossyEdit describes overlay-replay quality for FUTURE canvas edits, not a
  // loss of this apply (the generator's own ^BY-before-^FO shape triggers it
  // on every self round-trip); the import modal keeps it, this dialog not.
  const findings = imported.report.findings.filter((f) => f.kind !== "lossyEdit");
  return {
    ok: true,
    next: {
      label,
      pages: imported.pages.length > 0 ? imported.pages : [{ objects: [] }],
      variables: imported.variables,
      printerProfile,
      columnMapping: remapped.mapping,
    },
    report: { ...imported.report, findings },
    objectCount,
    loss,
  };
}
