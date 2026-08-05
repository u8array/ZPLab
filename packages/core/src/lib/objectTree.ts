/** Shape-erasing helpers for walking a persisted object tree without
 *  committing to a parsed type. Migrations and the JSON-import path
 *  both need to visit leaves before the schema is locked in, so the
 *  walkers must accept `unknown`. */
import { isValidVariableName, markerOf } from "../types/Variable";
import { renameTemplateMarkers } from "./fnTemplate";

interface UnknownNode {
  type?: unknown;
  props?: unknown;
  children?: unknown;
}

/** Apply `visit` to every leaf (non-group) node found under `pages`.
 *  `pages` is treated permissively: any nested `objects`/`children`
 *  arrays are walked. Mutates leaves in-place via the visitor. */
export function visitLeavesInPages(pages: unknown, visit: (leaf: UnknownNode) => void): void {
  if (!Array.isArray(pages)) return;
  for (const page of pages) walkNode(page, visit);
}

function walkNode(node: unknown, visit: (leaf: UnknownNode) => void): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const n = node as UnknownNode & { objects?: unknown };
  if (Array.isArray(n.objects)) {
    for (const child of n.objects) walkNode(child, visit);
    return;
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) walkNode(child, visit);
    return;
  }
  visit(n);
}

/** Shared migration leaf-mutators, used by both the persist-store and design-file
 *  migration channels so the per-leaf rewrite lives in one place. */

/** Legacy TLC39 slot mismatch: `microPdfRowHeight` held the ^BT w2 value and
 *  `microPdfRows` the h2 value, so remapping keeps the wire bytes identical.
 *  Also backfills the props the legacy shape never had (wideRatio); emit and
 *  canvas read them unguarded. */
export function fixTlc39SlotsLeaf(leaf: UnknownNode): void {
  if (leaf.type !== "tlc39" || !leaf.props || typeof leaf.props !== "object") return;
  const props = leaf.props as Record<string, unknown>;
  if ("microPdfRows" in props) {
    // A mixed shape (new key already present next to the stale legacy one)
    // keeps the new values; only a pure legacy shape is slot-remapped.
    if (!("microPdfModuleWidth" in props)) {
      props.microPdfModuleWidth =
        typeof props.microPdfRowHeight === "number" ? props.microPdfRowHeight : 2;
      props.microPdfRowHeight =
        typeof props.microPdfRows === "number" ? props.microPdfRows : 4;
    }
    delete props.microPdfRows;
  }
  // Non-positive or out-of-range values (hand-edited JSON) fall to the
  // parser's defaults; oversized module widths stay byte-stable on purpose
  // (the wire carried them under main too).
  if (typeof props.wideRatio !== "number" || props.wideRatio < 2 || props.wideRatio > 3) {
    props.wideRatio = 2;
  }
  if (typeof props.microPdfModuleWidth !== "number" || props.microPdfModuleWidth < 1) {
    props.microPdfModuleWidth = 2;
  }
  if (typeof props.microPdfRowHeight !== "number" || props.microPdfRowHeight < 1) {
    props.microPdfRowHeight = 4;
  }
}

/** Legacy standalone `serial` object type → `text` field with a `serial` prop. */
export function foldSerialLeaf(leaf: UnknownNode): void {
  if (leaf.type !== "serial" || !leaf.props || typeof leaf.props !== "object") return;
  const props = leaf.props as Record<string, unknown>;
  const increment = typeof props.increment === "number" ? props.increment : 1;
  const zplMode = props.zplMode === "SF" ? "SF" : "SN";
  (leaf as { type: string }).type = "text";
  props.serial = { increment, zplMode };
  delete props.increment;
  delete props.zplMode;
}

/** Pick a marker-safe, unique name: valid names keep their trimmed form, invalid
 *  ones fall back to `field_<fn>`; collisions get a `_n` suffix. Mutates `taken`. */
function pickSafeName(original: string, fn: number, taken: Set<string>): string {
  const base = isValidVariableName(original) ? original.trim() : `field_${fn}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  taken.add(name);
  return name;
}

/** Assign marker-safe, unique names keyed by variable id (mutates each `name`),
 *  returning id -> final name. The `variableId -> «name»` migration uses this so
 *  duplicate legacy names are disambiguated PER ID before the markers are written
 *  (otherwise two ids sharing `sku` would collapse onto one name). */
export function safeUniqueNameById(
  variables: { id?: unknown; name?: unknown; fnNumber?: unknown }[],
): Map<string, string> {
  const taken = new Set<string>();
  const byId = new Map<string, string>();
  for (const v of variables) {
    const original = typeof v?.name === "string" ? v.name : "";
    const fn = typeof v?.fnNumber === "number" ? v.fnNumber : 0;
    const name = pickSafeName(original, fn, taken);
    v.name = name;
    if (typeof v?.id === "string") byId.set(v.id, name);
  }
  return byId;
}

/** Enforce the variable-name invariants when loading existing data (persist
 *  rehydrate / design-file open). Since the name is now the single-bind
 *  identity, names must be marker-safe AND unique: an old/foreign name like
 *  `clock:Y` would load as a clock chip, and a duplicate (incl. one produced by
 *  trimming `" sku "` next to `"sku"`) makes `«name»` markers ambiguous.
 *  Renames each offender to a unique, marker-safe name (in place) and rewrites
 *  its `«name»` markers across pages. */
export function sanitiseVariableNames(
  variables: { name?: unknown; fnNumber?: unknown }[],
  pages: unknown,
): void {
  const taken = new Set<string>();
  const kept = new Set<string>();
  const assigned: { original: string; final: string }[] = [];
  for (const v of variables) {
    const original = typeof v?.name === "string" ? v.name : "";
    const fn = typeof v?.fnNumber === "number" ? v.fnNumber : 0;
    const name = pickSafeName(original, fn, taken);
    v.name = name;
    assigned.push({ original, final: name });
    if (name === original) kept.add(original);
  }
  const renames = new Map<string, string>();
  for (const { original, final } of assigned) {
    // Skip exact duplicates: another variable kept this exact name and owns its
    // «name» markers. Those markers are indistinguishable from this one's (same
    // string), so rewriting by the shared original would hijack the keeper's
    // markers onto the renamed duplicate. The duplicate's markers correctly stay
    // with the first variable; only its own name changes.
    if (final === original || kept.has(original)) continue;
    renames.set(original, final);
  }
  if (renames.size === 0) return;
  // One pass against the original names, so a trim collision (" sku "/"sku") or
  // any swap can't cascade through already-rewritten markers.
  visitLeavesInPages(pages, (leaf) => {
    const l = leaf as { props?: { content?: unknown } };
    if (typeof l.props?.content !== "string") return;
    l.props.content = renameTemplateMarkers(l.props.content, renames);
  });
}

/** Legacy single-bind `variableId` → a `«name»` content marker. A resolving id
 *  wins (single-bind emitted ^FN+default); an orphan id just drops, leaving the
 *  literal fallback content as before. */
export function bindSingleMarkerLeaf(
  leaf: UnknownNode & { variableId?: unknown },
  nameById: ReadonlyMap<string, string>,
): void {
  if (typeof leaf.variableId !== "string") return;
  const name = nameById.get(leaf.variableId);
  if (name && leaf.props && typeof leaf.props === "object") {
    (leaf.props as Record<string, unknown>).content = markerOf(name);
  }
  delete leaf.variableId;
}
