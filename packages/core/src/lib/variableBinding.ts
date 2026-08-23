import type { LabelObject } from "../types/Group";
import { markerOf, type ColumnMapping, type Variable } from "../types/Variable";
import { resolveTemplateMarkers } from "./fnTemplate";
import { channelDatesFrom, hasClockMarkers, resolveClockMarkers } from "./fcTemplate";
import { clockDatesThunk, resolveMarkerChain, type CtrlParity, type ClockResolveCtx } from "./markerResolve";

// Chain internals live in markerResolve (a leaf module): this module sits in
// the registry's own init chain (typedContent/preflight/variableField import
// it), so it must never import the registry back. Capability flags therefore
// arrive as caller params (see `ctrl` / `ctrlParityOf`).
export { clockCtxFromLabel, resolveContentPreview, type ClockResolveCtx, type CtrlParity } from "./markerResolve";

/** Read `props.content` if present and string-typed; one place for the
 *  unsafe cast that consumers walking heterogeneous trees share. */
export function getObjectStringContent(obj: LabelObject): string | undefined {
  const c = (obj as { props?: { content?: unknown } }).props?.content;
  return typeof c === "string" ? c : undefined;
}

/** `preview` = actual print value, `schema` = `«name»` placeholder. */
export type RenderMode = "preview" | "schema";

/** Empty dataset cells render as empty (no defaultValue fallback). */
export function resolveVariableValue(
  variable: Variable,
  active: ActiveRow | null,
  mode: RenderMode = "preview",
): string {
  if (mode === "schema") return markerOf(variable.name);
  if (!active) return variable.defaultValue;
  const header = active.mapping.bindings[variable.id];
  if (header === undefined) return variable.defaultValue;
  const idx = active.headers.indexOf(header);
  if (idx === -1) return variable.defaultValue;
  return active.row[idx] ?? "";
}

export type VariableSource = "bound" | "orphan" | "default";

/** bound=header exists in the dataset, orphan=bound to missing header, default=unbound. */
export function getVariableSource(
  variable: Variable,
  dataset: { headers: readonly string[] } | null,
  columnMapping: ColumnMapping | null,
): VariableSource {
  const header = columnMapping?.bindings[variable.id];
  if (header === undefined) return "default";
  if (!dataset) return "default";
  return dataset.headers.includes(header) ? "bound" : "orphan";
}

/** False when: no dataset, schema mode, unbound, or orphan. */
export function shouldShowFallbackTint(
  variable: Variable | undefined,
  dataset: { headers: readonly string[] } | null,
  columnMapping: ColumnMapping | null,
  mode: RenderMode,
): boolean {
  if (mode !== "preview") return false;
  if (!dataset) return false;
  if (!variable) return false;
  return getVariableSource(variable, dataset, columnMapping) !== "bound";
}

/** Recurse leaves through applyBindingToObject; preserves group structure. */
export function applyBindingToTree<T extends LabelObject>(
  objects: readonly T[],
  variables: readonly Variable[],
  active: ActiveRow | null,
  mode: RenderMode = "preview",
  /** Shared clock context so every leaf sees the same instant and the
   *  same label-level ^SO offsets. */
  clock?: ClockResolveCtx,
  /** Per-leaf control-byte emitter parity (`ctrlParityFor`); see
   *  applyBindingToObject. */
  ctrlParityOf?: (obj: LabelObject) => CtrlParity,
): T[] {
  // Lift once per tree so all leaves share one instant + offsets.
  const now = clock?.now ?? new Date();
  const dates = clock?.dates ?? channelDatesFrom(
    now,
    clock?.secondaryOffset,
    clock?.tertiaryOffset,
  );
  const shared: ClockResolveCtx = { dates };
  return objects.map((o) => {
    const asGroup = o as unknown as { type?: string; children?: readonly T[] };
    if (asGroup.type === "group" && Array.isArray(asGroup.children)) {
      const nextChildren = applyBindingToTree(asGroup.children, variables, active, mode, shared, ctrlParityOf);
      return { ...o, children: nextChildren } as T;
    }
    return applyBindingToObject(o, variables, active, mode, shared, ctrlParityOf?.(o) ?? "literal");
  });
}

export interface ActiveRow {
  headers: readonly string[];
  row: readonly string[];
  mapping: ColumnMapping;
}

/** Dataset column a variable is bound to, or -1 when unbound / the header is
 *  missing from the dataset. The one place for the binding→column lookup. */
export function boundColumnIndex(
  variable: Pick<Variable, "id">,
  dataset: { headers: readonly string[] } | null,
  columnMapping: Pick<ColumnMapping, "bindings"> | null,
): number {
  const header = columnMapping?.bindings[variable.id];
  if (header === undefined || !dataset) return -1;
  return dataset.headers.indexOf(header);
}

/** Print-time resolution of `raw` for a specific dataset row: clock markers via
 *  the primary clock at `now` (offsets shift real dates, never width or
 *  validity), variable markers via the row's bound cell (an empty cell prints
 *  empty) or the default when unbound / `rowIdx < 0`. Unknown markers stay
 *  literal. */
export function resolveForRow(
  raw: string,
  rowIdx: number,
  variables: readonly Variable[],
  dataset: { headers: readonly string[]; rows: readonly (readonly string[])[] } | null,
  columnMapping: ColumnMapping | null,
  now: Date = new Date(),
): string {
  let next = raw;
  if (hasClockMarkers(next)) {
    next = resolveClockMarkers(next, channelDatesFrom(now, undefined, undefined));
  }
  const byName = new Map(variables.map((v) => [v.name, v]));
  return resolveTemplateMarkers(next, (name) => {
    const v = byName.get(name);
    if (!v) return undefined;
    if (rowIdx >= 0 && dataset) {
      const col = boundColumnIndex(v, dataset, columnMapping);
      if (col >= 0) return dataset.rows[rowIdx]?.[col] ?? "";
    }
    return v.defaultValue;
  });
}

/** Every value a variable's marker can substitute at print time: its default
 *  plus, when bound, all cells of its dataset column. One tested place for the
 *  column-lookup/row-walk that validation consumers share. */
export function variableSubstitutions(
  variable: Variable,
  dataset: { headers: readonly string[]; rows: readonly (readonly string[])[] } | null,
  columnMapping: ColumnMapping | null,
): string[] {
  const out = [variable.defaultValue];
  const col = boundColumnIndex(variable, dataset, columnMapping);
  if (col === -1 || !dataset) return out;
  for (const row of dataset.rows) {
    // An empty cell prints as empty (no default fallback), so it IS a
    // substitution; a short row's missing cell prints empty too.
    out.push(row[col] ?? "");
  }
  return out;
}

/** Null when no dataset, no mapping, or active index out of bounds. */
export function buildActiveRow(
  dataset: {
    headers: readonly string[];
    rows: readonly (readonly string[])[];
    activeRowIndex: number;
  } | null,
  columnMapping: ColumnMapping | null,
): ActiveRow | null {
  if (!dataset || !columnMapping) return null;
  const row = dataset.rows[dataset.activeRowIndex];
  if (!row) return null;
  return { headers: dataset.headers, row, mapping: columnMapping };
}

/** The active row's bound cell for `variable`, or undefined when there is no
 *  active row or the variable isn't bound to a present column (unbound / stale
 *  header). A present-but-empty cell yields ""; unlike resolveVariableValue this
 *  never folds in the default, so editor hints can pick their own fallback. */
export function activeCellValue(
  variable: Pick<Variable, "id">,
  active: ActiveRow | null,
): string | undefined {
  if (!active) return undefined;
  const header = active.mapping.bindings[variable.id];
  if (header === undefined) return undefined;
  const idx = active.headers.indexOf(header);
  if (idx === -1) return undefined;
  return active.row[idx] ?? "";
}

/** Identity-preserving: returns same ref when unbound or unchanged. */
export function applyBindingToObject<T extends LabelObject>(
  obj: T,
  variables: readonly Variable[],
  active: ActiveRow | null = null,
  mode: RenderMode = "preview",
  /** Lazy-initialised inside the clock branch. */
  clock?: ClockResolveCtx,
  /** Emitter parity for control bytes (`ctrlParityFor(obj)`); default keeps a
   *  chip literal, matching export on incapable types. */
  ctrl: CtrlParity = "literal",
): T {
  const content = getObjectStringContent(obj);
  if (content === undefined) return obj;

  // Content is the only source: `«name»` markers (single known marker is the
  // derived single-bind, others are templates) resolve to the variable value,
  // exactly as `fdFieldFor`/`classifyField` decide on export, so preview and
  // export can never diverge. Clock/control resolve in preview mode only
  // (export emits ^FC / ^FH itself).
  const byName = new Map(variables.map((v) => [v.name, v]));
  const next = resolveMarkerChain(
    content,
    (name) => {
      const v = byName.get(name);
      return v ? resolveVariableValue(v, active, mode) : undefined;
    },
    mode === "preview" ? clockDatesThunk(clock) : null,
    ctrl,
  );
  if (next === content) return obj;
  const props = (obj as { props: object }).props;
  return {
    ...obj,
    props: { ...props, content: next },
  } as unknown as T;
}

/** Bindings survive a source apply by the same ^FN-slot key as
 *  `variablesRenamed` in editorStateDiff; a renumbered slot loses its
 *  binding, and the diff says so. */
export function remapBindingsByFn(
  prevVariables: readonly Variable[],
  mapping: ColumnMapping | null,
  nextVariables: readonly Variable[],
): { mapping: ColumnMapping | null; remapped: number; lost: number } {
  if (!mapping) return { mapping: null, remapped: 0, lost: 0 };
  const prevById = new Map(prevVariables.map((v) => [v.id, v]));
  const nextByFn = new Map(nextVariables.map((v) => [v.fnNumber, v]));
  const bindings: Record<string, string> = {};
  let remapped = 0;
  let lost = 0;
  for (const [varId, header] of Object.entries(mapping.bindings)) {
    const fn = prevById.get(varId)?.fnNumber;
    const nextVar = fn === undefined ? undefined : nextByFn.get(fn);
    if (nextVar) {
      bindings[nextVar.id] = header;
      remapped++;
    } else {
      lost++;
    }
  }
  return { mapping: { ...mapping, bindings }, remapped, lost };
}
