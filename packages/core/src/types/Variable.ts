import { z } from "zod";
import { CLOCK_BODY_RE } from "./clockMarker";
import { CTRL_BODY_RE } from "./controlKey";

/** Classic ZPL ^FN bounds; newer firmware allows more but stay portable. */
export const FN_NUMBER_MIN = 1;
export const FN_NUMBER_MAX = 99;

export const variableSchema = z.object({
  id: z.string(),
  name: z.string(),
  fnNumber: z.number().int().min(FN_NUMBER_MIN).max(FN_NUMBER_MAX),
  defaultValue: z.string(),
  comment: z.string().optional(),
});

export type Variable = z.infer<typeof variableSchema>;

export interface VariableInput {
  name: string;
  defaultValue?: string;
  /** Explicit slot. When omitted, the store assigns the next free number. */
  fnNumber?: number;
  comment?: string;
}

/** Lowest unused fnNumber in [1, 99], or null when all 99 taken. */
export function nextFreeFnNumber(used: readonly number[]): number | null {
  const taken = new Set(used);
  for (let n = FN_NUMBER_MIN; n <= FN_NUMBER_MAX; n++) {
    if (!taken.has(n)) return n;
  }
  return null;
}

// Names matching the shared clock-body grammar are reserved: `classifyMarkerBody`
// short-circuits on that exact shape before resolving variable names. A longer
// name like `clock:Year` is never a clock marker and stays a valid variable.

/** A variable name must round-trip as a `«name»` content marker, so it can carry
 *  no marker delimiters / newline, and must not collide with a clock body. The
 *  name is the single-bind identity since `variableId` was removed, so this
 *  guards the data model, not just the UI. */
export function isValidVariableName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === '') return false;
  if (/[«»\n]/.test(trimmed)) return false;
  if (CLOCK_BODY_RE.test(trimmed)) return false;
  if (CTRL_BODY_RE.test(trimmed)) return false;
  return true;
}

/** Wrap a marker body (a variable name or a clock token like `clock:Y`) in the
 *  `«…»` content-marker delimiters. Single source for marker construction,
 *  paired with `stripMarkerDelimiters`. */
export function markerOf(body: string): string {
  return `«${body}»`;
}

// Marker RECOGNITION grammar, single source next to markerOf (construction):
// the body forbids `»` so adjacent markers can't merge. Consumers must not
// re-declare it; independent copies invite grammar drift.

/** Fresh global scan regex per call (stateful `lastIndex`, never share one). */
export const markerRe = (): RegExp => /«([^»]+)»/g;

/** Whole string is exactly one marker: the single-bind shape. */
export const SINGLE_MARKER_RE = /^«([^»]+)»$/;

/** Strip variable-marker delimiters from a literal value. A default/fallback
 *  can't carry a `«…»` marker: preview would resolve it while single-bind export
 *  emits it verbatim (a phantom re-bind / silent drift). Single source for that
 *  strip, shared by every variable mutator. */
export function stripMarkerDelimiters(value: string): string {
  return value.replace(/[«»]/g, '');
}

/** True iff names+fnNumbers are valid (marker-safe), in-range, and unique. */
export function validateVariablesUnique(variables: readonly Variable[]): boolean {
  const names = new Set<string>();
  const fns = new Set<number>();
  for (const v of variables) {
    const trimmed = v.name.trim();
    if (!isValidVariableName(trimmed) || names.has(trimmed)) return false;
    names.add(trimmed);
    if (v.fnNumber < FN_NUMBER_MIN || v.fnNumber > FN_NUMBER_MAX) return false;
    if (fns.has(v.fnNumber)) return false;
    fns.add(v.fnNumber);
  }
  return true;
}

/** Pairs variables across a reparse by ^FN slot, the only identity the wire carries. */
export function matchVariablesByFn(
  prev: readonly Variable[],
  next: readonly Variable[],
): { kept: { from: Variable; to: Variable }[]; dropped: Variable[] } {
  const nextByFn = new Map(next.map((v) => [v.fnNumber, v]));
  const kept: { from: Variable; to: Variable }[] = [];
  const dropped: Variable[] = [];
  for (const from of prev) {
    const to = nextByFn.get(from.fnNumber);
    if (to) kept.push({ from, to });
    else dropped.push(from);
  }
  return { kept, dropped };
}

/** Append `_2`, `_3`, ... until unique. */
export function uniqueVariableName(
  base: string,
  existing: readonly Variable[],
): string {
  const taken = new Set(existing.map((v) => v.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/** `var_N` with lowest N that yields a unique name. */
export function nextDefaultVariableName(existing: readonly Variable[]): string {
  const taken = new Set(existing.map((v) => v.name));
  let i = 1;
  while (taken.has(`var_${i}`)) i++;
  return `var_${i}`;
}

/** Parse options remembered so re-import uses the same delimiter/encoding/
 *  header decision. Omission = default (auto-detect, UTF-8, header present). */
export const csvParseOptionsPersistedSchema = z.object({
  delimiter: z.string().optional(),
  hasHeaderRow: z.boolean().optional(),
  skipRows: z.number().int().min(0).optional(),
  encoding: z.string().optional(),
});
export type CsvParseOptionsPersisted = z.infer<typeof csvParseOptionsPersistedSchema>;

export const columnMappingSchema = z.object({
  /** variable.id -> header name. Missing entries fall back to defaultValue. */
  bindings: z.record(z.string(), z.string()),
  /** Headers the mapping was made against; differing re-imports trigger warning. */
  headerSnapshot: z.array(z.string()),
  /** Parse options at last apply; optional for back-compat. */
  parseOptions: csvParseOptionsPersistedSchema.optional(),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

/** Mapping <-> headers compatibility. Headerless: column-count match.
 *  Header-row: order-independent name-set match. */
export function isMappingCompatibleWith(
  mapping: ColumnMapping,
  headers: readonly string[],
): boolean {
  const headerless = mapping.parseOptions?.hasHeaderRow === false;
  if (headerless) return mapping.headerSnapshot.length === headers.length;
  if (mapping.headerSnapshot.length !== headers.length) return false;
  const known = new Set(mapping.headerSnapshot);
  for (const h of headers) if (!known.has(h)) return false;
  return true;
}

/** parseOptions kept when a mapping moves onto a named-header (db/excel) source:
 *  delimiter/encoding/skipRows survive for a later CSV re-import, but hasHeaderRow
 *  is dropped so it can't poison {@link isMappingCompatibleWith}. */
export function dbExcelParseOptions(
  opts: CsvParseOptionsPersisted | undefined,
): CsvParseOptionsPersisted | undefined {
  if (!opts) return undefined;
  const { hasHeaderRow: _drop, ...rest } = opts;
  void _drop;
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/** Loose header match: case-insensitive, collapse spaces/dashes/underscores. */
export function normalizeHeaderForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

/** variable.id -> headerName via normalizeHeaderForMatch; each header
 *  consumed at most once, ties go to first variable. */
export function suggestColumnMapping(
  variables: readonly Variable[],
  headers: readonly string[],
): Record<string, string> {
  const taken = new Set<string>();
  const bindings: Record<string, string> = {};
  for (const v of variables) {
    const normName = normalizeHeaderForMatch(v.name);
    const match = headers.find(
      (h) => !taken.has(h) && normalizeHeaderForMatch(h) === normName,
    );
    if (match !== undefined) {
      bindings[v.id] = match;
      taken.add(match);
    }
  }
  return bindings;
}
