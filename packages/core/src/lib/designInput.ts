import { getEntry, ObjectRegistry } from "../registry";
import { gfShipsSafely, parseGfHeader } from "../registry/image";
import { propDomainIssue, propTypeIssue, type PropSpec } from "../types/propSpec";
import { ZPL_PARAM_CHARS } from "./zplParams";
import { isGroup, type LabelObject } from "../types/Group";
import { NON_EMITTING_PROP_KEYS } from "../types/LabelObject";
import type { DeviceFontLabel } from "../types/LabelConfig";
import {
  FN_NUMBER_MAX,
  FN_NUMBER_MIN,
  isValidVariableName,
  nextFreeFnNumber,
  stripMarkerDelimiters,
  type Variable,
  type VariableInput,
} from "../types/Variable";

export interface ObjectInput {
  type: string;
  x: number;
  y: number;
  id?: string;
  positionType?: "FO" | "FT";
  fieldJustify?: "L" | "C" | "R";
  props?: Record<string, unknown>;
}

/** 'C' is a 1D-only control. Elsewhere it would persist as metadata no UI can clear, so every write path canonicalizes here. */
export function canonicalFieldJustify(
  type: string,
  justify: LabelObject["fieldJustify"],
): LabelObject["fieldJustify"] {
  return justify === "C" && getEntry(type)?.barcodeClass !== "1d" ? undefined : justify;
}

export function normalizeLeaves(objects: LabelObject[]): LabelObject[] {
  return objects.map((o) =>
    isGroup(o)
      ? { ...o, children: normalizeLeaves(o.children) }
      : {
          ...o,
          ...(o.fieldJustify !== undefined
            ? { fieldJustify: canonicalFieldJustify(o.type, o.fieldJustify) }
            : {}),
          props: { ...(getEntry(o.type)?.defaultProps ?? {}), ...o.props },
        },
  ) as LabelObject[];
}

/** Sparse input over the registry defaults, so an agent supplies only the props it changes. */
export function toLabelObject(
  input: ObjectInput,
  id: string,
  label?: DeviceFontLabel,
): LabelObject {
  const defaults = getEntry(input.type)?.defaultProps ?? {};
  const justify = canonicalFieldJustify(input.type, input.fieldJustify);
  const base = {
    id,
    type: input.type,
    x: input.x,
    y: input.y,
    rotation: 0,
    ...(input.positionType !== undefined ? { positionType: input.positionType } : {}),
    ...(justify !== undefined ? { fieldJustify: justify } : {}),
    props: { ...defaults, ...(input.props ?? {}) },
    // Unknown types are refused by the callers up front.
  } as LabelObject;
  // The same registry hook every editor edit runs. A full object arrives here, so an ^BF
  // height or ^FB line count must be clamped here too, not only on update.
  const normalize = getEntry(input.type)?.normalizeChanges;
  if (!normalize || input.props === undefined) return base;
  // Same device-font ctx the editor passes, or the hook resolves font 0 here.
  const normalized = normalize(base as never, { props: input.props } as never, { label: label ?? {} });
  return { ...base, ...normalized, props: { ...(base as { props: object }).props, ...normalized.props } } as LabelObject;
}

/** Rejected up front, so a bad payload fails the call instead of printing nothing.
 *  `shipsVerbatim` marks the prop whose string reaches the wire untouched. */
function graphicPropIssue(name: string, value: unknown, shipsVerbatim: boolean): string | null {
  // An array would string-coerce into a valid-looking graphic carrying whatever its second element says.
  if (typeof value !== "string") return `${name} must be a string`;
  const head = parseGfHeader(value);
  if (!head) return `${name} must start with a ^GF header (the format letter is required)`;
  // A header without data emits `^GFB,8,8,1,` and the firmware eats the following ^FS/^XZ, spec p.215.
  // Fatal only for the verbatim prop. A cache degrades through gfaCacheUsable to an empty field.
  if (shipsVerbatim && head.payload.trim() === "") return `${name} carries no graphic data`;
  return gfShipsSafely(value) ? null : `${name} carries characters that are not graphic data`;
}

/** User text the app passes verbatim. Every other prop reaches a ZPL parameter slot, where a control prefix starts a command. */
const FREE_TEXT_PROPS = new Set(["content", "comment", ...NON_EMITTING_PROP_KEYS]);

/** Comma counts too, these values land in comma-delimited slots. Depth-bounded against a self-referential object. */
function hasControlString(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return ZPL_PARAM_CHARS.test(value);
  if (depth > 8 || value === null || typeof value !== "object") return false;
  return Object.values(value).some((v) => hasControlString(v, depth + 1));
}

/** Emitted as written, so the boundary must prove they are graphic data. See graphicPropIssue. */
export const RAW_GRAPHIC_PROPS: ReadonlyMap<string, boolean> = new Map([
  ["rawGf", true],
  ["_gfaCache", false],
]);

/** Unchecked, a caller's string reaches the emitted ZPL ("^A0N,gross,0"). */
export function propIssues(
  type: string,
  props: Record<string, unknown> | undefined,
  /** `caller`: held to payload, ownership and domain. `design`: a whole file read back,
   *  held to types only, so one preserved import value never fails the design. */
  origin: "caller" | "design" = "caller",
): string[] {
  if (!props) return [];
  const specs = getEntry(type)?.propSpecs as Record<string, PropSpec> | undefined;
  const issues: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const shipsVerbatim = RAW_GRAPHIC_PROPS.get(key);
    if (shipsVerbatim !== undefined) {
      // Both origins: core reads these as strings, so a non-string would throw out of emit instead of failing here.
      if (typeof value !== "string") issues.push(`${type}.${key} must be a string`);
      else if (origin === "caller") {
        const issue = graphicPropIssue(key, value, shipsVerbatim);
        if (issue) issues.push(issue);
      }
      continue;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      issues.push(`${type}.${key} must be a finite number`);
      continue;
    }
    // A null merged over a default stringifies into its parameter slot.
    if (value === null) {
      issues.push(`${type}.${key} must not be null (drop the key to keep the current value)`);
      continue;
    }
    // Nested strings reach parameter slots too, storedAs.name and the serial fields among them.
    if (!FREE_TEXT_PROPS.has(key) && hasControlString(value)) {
      issues.push(`${type}.${key} must not contain ^ ~ or , (they end the ZPL parameter)`);
      continue;
    }
    if (!specs) continue;
    const spec = Object.hasOwn(specs, key) ? specs[key] : undefined;
    if (!spec) {
      if (origin === "caller" && registryReadsProp(key)) issues.push(`${type}.${key} is not a ${type} prop`);
      continue;
    }
    if (value === undefined) continue;
    const issue = propTypeIssue(spec, value) ?? (origin === "caller" ? propDomainIssue(spec, value) : null);
    if (issue) issues.push(`${type}.${key} ${issue}`);
  }
  return issues;
}

function registryReadsProp(key: string): boolean {
  return Object.values(ObjectRegistry).some((e) => Object.hasOwn(e.propSpecs, key));
}

/** Within one edit per three characters, so `code127` finds `code128` and nothing unrelated matches. */
function nearestType(type: string): string | null {
  const budget = Math.max(1, Math.floor(type.length / 3));
  let best: { name: string; distance: number } | null = null;
  for (const name of Object.keys(ObjectRegistry)) {
    const distance = editDistance(type.toLowerCase(), name.toLowerCase());
    if (distance <= budget && (best === null || distance < best.distance)) {
      best = { name, distance };
    }
  }
  return best?.name ?? null;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

export function typeIssues(types: readonly string[]): string[] {
  return [...new Set(types.filter((t) => getEntry(t) === undefined))].map((type) => {
    const near = nearestType(type);
    return `Unknown object type: ${type}${near ? ` (did you mean ${near}?)` : ""}`;
  });
}

/** A count-derived id collides as soon as the design skipped or reused the sequence. */
export function freeId(type: string, taken: ReadonlySet<string>): string {
  let n = taken.size + 1;
  while (taken.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

/** A duplicate id or ^FN slot merges two fields silently. parseDesignFile resolves duplicate slots but never dedupes ids. */
export function duplicateVariableIssue(variables: readonly Variable[]): string | null {
  const dup = (key: (v: Variable) => string | number) => {
    const all = variables.map(key);
    return all.find((k, i) => all.indexOf(k) !== i);
  };
  const id = dup((v) => v.id);
  if (id !== undefined) return `Duplicate variable id: ${id}`;
  const slot = dup((v) => v.fnNumber);
  if (slot !== undefined) return `Duplicate ^FN slot: ${slot}`;
  return null;
}

/** Ids, free ^FN slots and stripped defaults for named inputs. Duplicates are the caller's policy. */
export function completeVariables(
  inputs: readonly VariableInput[],
  existing: readonly Variable[] = [],
): { value: Variable[] } | { error: string } {
  const taken: number[] = [
    ...existing.map((v) => v.fnNumber),
    ...inputs.flatMap((v) => (v.fnNumber === undefined ? [] : [v.fnNumber])),
  ];
  const usedIds = new Set([...existing.map((v) => v.id), ...inputs.flatMap((v) => (v.id === undefined ? [] : [v.id]))]);
  const out: Variable[] = [];
  for (const input of inputs) {
    // Trimmed like every reader trims, or the stored name could never be addressed again.
    const name = input.name.trim();
    if (!isValidVariableName(name)) {
      return { error: `Invalid variable name: ${JSON.stringify(input.name)}` };
    }
    if (input.fnNumber !== undefined && (input.fnNumber < FN_NUMBER_MIN || input.fnNumber > FN_NUMBER_MAX)) {
      return { error: `^FN slot must be ${FN_NUMBER_MIN}-${FN_NUMBER_MAX} (got ${input.fnNumber})` };
    }
    let fnNumber = input.fnNumber;
    if (fnNumber === undefined) {
      const free = nextFreeFnNumber(taken);
      if (free === null) return { error: "No free ^FN slot left (1-99)" };
      fnNumber = free;
      taken.push(free);
    }
    let id = input.id;
    if (id === undefined) {
      let idIndex = existing.length + out.length + 1;
      while (usedIds.has(`var-${idIndex}`)) idIndex++;
      id = `var-${idIndex}`;
      usedIds.add(id);
    }
    out.push({
      id,
      name,
      fnNumber,
      // A default carrying its own «…» would resolve in preview and emit verbatim, see stripMarkerDelimiters.
      defaultValue: stripMarkerDelimiters(input.defaultValue ?? ""),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    });
  }
  return { value: out };
}

/** create_draft's variables: completed, then duplicates refused, since they would merge fields silently. */
export function buildVariables(
  inputs: readonly VariableInput[],
  existing: readonly Variable[] = [],
): { value: Variable[] } | { error: string } {
  const built = completeVariables(inputs, existing);
  if ("error" in built) return built;
  const all = [...existing, ...built.value];
  const name = all.map((v) => v.name).find((n, i, names) => names.indexOf(n) !== i);
  if (name !== undefined) return { error: `Duplicate variable name: ${name}` };
  const dup = duplicateVariableIssue(all);
  return dup === null ? built : { error: dup };
}
