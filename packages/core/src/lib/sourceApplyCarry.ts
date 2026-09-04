import { exportableLeaves, isGroup, pageLabelConfig, walkExportOrder, walkObjects, type ExportStep, type LabelObject, type Page } from "../types/Group";
import type { LabelConfig } from "../types/LabelConfig";
import { matchVariablesByFn, uniqueVariableName, type Variable } from "../types/Variable";
import type { PageSource } from "./zplParser/types";
import type { OverlayFrame } from "./zplOverlay/overlay";
import { generateMultiPageZplWithMap, shiftIntoFrame, type EmitSpan } from "./zplGenerator";
import { rewriteTemplateMarkersMap } from "./templateObjects";
import { extractTemplateRefs } from "./fnTemplate";
import { getObjectStringContent } from "./variableBinding";
import { pickEditorState } from "./editorStateDiff";
import { indexAtOrBefore } from "./lineDiff";
import { diffBlocks, type BlockDiff } from "./blockDiff";
import { canonicalPrefixes } from "./zplCanonicalPrefixes";

export interface CarryInput {
  /** A subset, not SourceDocumentState: naming that type here would cycle through zplSourceEdit. */
  current: { label: LabelConfig; pages: Page[]; variables: readonly Variable[] };
  /** Must equal the export of `current`, else nothing carries. */
  baseline: string | undefined;
  text: string;
  importedLabel: LabelConfig;
  imported: Page[];
  importedVariables: readonly Variable[];
  /** Index-parallel to `imported`. */
  pageSources: readonly PageSource[];
}

interface Located {
  id: string;
  page: Page;
}

interface Parsed extends Located {
  start: number;
  end: number;
}

/** A run's reach in a page: it enters at the anchored end and may find its reprints up to the other. */
interface Slot {
  page: Page;
  from: number;
  to: number;
  anchor: "from" | "to";
}

interface Ctx {
  current: CarryInput["current"];
  importedLabel: LabelConfig;
  importedVariables: readonly Variable[];
  diff: BlockDiff;
  baseText: string;
  baseSpan: Map<string, EmitSpan>;
  /** Ascending by start, `starts` alongside for the bisect. */
  parsed: Parsed[];
  starts: number[];
  /** Parsed ^LH/^LT frame per linked object id. */
  frames: Map<string, OverlayFrame>;
  pages: Page[];
  /** Parsed ids already standing for a model object. */
  claimed: Set<string>;
  /** Ids of carried subtrees already in a page. */
  placed: Set<string>;
}

/** The field's own bytes identify it; every leading ^FX (comment, sidecar) is annotation. */
const COMMENT_PREFIX_RE = /^(?:\^FX[^^~]*(?:\^FS)?\s*)+/;

const fieldStart = (text: string, span: EmitSpan): number =>
  span.start + (COMMENT_PREFIX_RE.exec(text.slice(span.start, span.end))?.[0].length ?? 0);

const patched = <T extends LabelObject>(o: T, patch: Partial<LabelObject>): T => ({ ...o, ...patch }) as T;

const indexOf = (p: Located): number => p.page.objects.findIndex((o) => o.id === p.id);

const pairedPage = (ctx: Ctx, pageIndex: number): Page | undefined => {
  const j = ctx.diff.pairs.get(pageIndex);
  return j === undefined ? undefined : ctx.pages[j];
};

/** Neighbours come from `page` only: a mapped offset never crosses its block. */
function neighbours(ctx: Ctx, page: Page, offset: number): { inside?: Parsed; before?: Parsed; after?: Parsed } {
  const i = indexAtOrBefore(ctx.starts, offset);
  const within = (p: Parsed | undefined) => (p && p.page === page ? p : undefined);
  const p = ctx.parsed[i];
  if (!p || p.start > offset) return { after: within(p) };
  return offset < p.end ? { inside: within(p) } : { before: within(p), after: within(ctx.parsed[i + 1]) };
}

/** One object's comment-free bytes as the model emits them, the ^LH/^LT of `frame` unfolded. */
function canonicalBytes(ctx: Ctx, page: Page, object: LabelObject, variables: readonly Variable[], frame?: OverlayFrame): string | undefined {
  const [unframed] = shiftIntoFrame([object], frame, pageLabelConfig(ctx.importedLabel, page));
  if (!unframed) return undefined;
  const { text, spans } = generateMultiPageZplWithMap(ctx.importedLabel, [{ ...page, overlay: undefined, objects: [unframed] }], variables);
  const span = spans[0];
  return span === undefined ? undefined : text.slice(fieldStart(text, span), span.end);
}

/** A printing object whose field line survived keeps its editor state; the parse
 *  stays authoritative for everything the buffer expresses. */
function carryIdentity(ctx: Ctx): void {
  ctx.current.pages.forEach((prev, pageIndex) => {
    const page = pairedPage(ctx, pageIndex);
    if (!page) return;
    for (const leaf of exportableLeaves(prev.objects)) {
      const span = ctx.baseSpan.get(leaf.id);
      if (!span) continue;
      const start = fieldStart(ctx.baseText, span);
      if (!ctx.diff.rangeMatched(start, span.end)) continue;
      const target = neighbours(ctx, page, ctx.diff.mapOffset(start).offset).inside;
      if (!target || ctx.claimed.has(target.id)) continue;
      const i = indexOf(target);
      const parsed = page.objects[i];
      if (!parsed) continue;
      ctx.claimed.add(target.id);
      page.objects[i] = patched(parsed, pickEditorState(leaf));
    }
  });
}

// A claimed or carried object belongs to someone else, so a run never reaches across it.
const isBoundary = (ctx: Ctx, o: LabelObject | undefined): boolean => !!o && (ctx.claimed.has(o.id) || ctx.placed.has(o.id));

function slotAt(ctx: Ctx, page: Page, index: number, anchor: Slot["anchor"]): Slot {
  const objects = page.objects;
  let from = index;
  let to = index;
  if (anchor === "from") while (to < objects.length && !isBoundary(ctx, objects[to])) to++;
  else while (from > 0 && !isBoundary(ctx, objects[from - 1])) from--;
  return { page, from, to, anchor };
}

/** Where a run of excluded subtrees goes: right after its predecessor's mapped field,
 *  else before its successor's; a deleted neighbour passes the question on; without
 *  any, the end of the page, which is then its whole reach. */
function slotFor(ctx: Ctx, order: readonly ExportStep[], first: number, last: number, page: Page, placedIn: ReadonlyMap<string, Located>): Slot {
  for (const s of order.slice(0, first).reverse()) {
    if ("excluded" in s) {
      const p = placedIn.get(s.excluded.id);
      const i = p ? indexOf(p) : -1;
      if (p && i >= 0) return slotAt(ctx, p.page, i + 1, "from");
      continue;
    }
    const span = ctx.baseSpan.get(s.leaf.id);
    if (!span) continue;
    const at = ctx.diff.mapOffset(span.end - 1);
    if (at.deleted) continue;
    const n = neighbours(ctx, page, at.offset);
    const p = n.inside ?? n.before;
    const i = p ? indexOf(p) : -1;
    if (p && i >= 0) return slotAt(ctx, page, i + 1, "from");
  }
  for (const s of order.slice(last)) {
    if (!("leaf" in s)) continue;
    const span = ctx.baseSpan.get(s.leaf.id);
    if (!span) continue;
    const at = ctx.diff.mapOffset(fieldStart(ctx.baseText, span));
    if (at.deleted) continue;
    const n = neighbours(ctx, page, at.offset);
    const p = n.inside ?? n.after;
    const i = p ? indexOf(p) : -1;
    if (p && i >= 0) return slotAt(ctx, page, i, "to");
  }
  return slotAt(ctx, page, page.objects.length, "to");
}

/** Rebuilds a run of excluded subtrees at its slot. A leaf the buffer prints again
 *  within the run's reach (an older export) is that leaf: the parsed copy joins its
 *  subtree with its editor state; everything else comes back as a clone. */
function placeExcluded(ctx: Ctx, roots: readonly LabelObject[], slot: Slot, renames: ReadonlyMap<string, string>): { placed: LabelObject[]; carried: LabelObject[] } {
  const nodes = [...walkObjects(roots)];
  const state = new Map(nodes.map((o) => [o.id, pickEditorState(o)] as const));
  const page = slot.page;
  const objects = page.objects;
  // Each side resolves markers under its own variable names; the leaf must un-exclude or it emits nothing.
  const leaves = nodes.filter((o) => !isGroup(o));
  const bytesOf = new Map(leaves.map((l) => [l.id, canonicalBytes(ctx, page, patched(l, { includeInExport: undefined }), ctx.current.variables)] as const));
  const twins = new Map<string, LabelObject>();
  const taken: number[] = [];
  for (let i = slot.from; i < slot.to; i++) {
    const candidate = objects[i];
    if (!candidate || isBoundary(ctx, candidate) || isGroup(candidate)) continue;
    const bytes = canonicalBytes(ctx, page, candidate, ctx.importedVariables, ctx.frames.get(candidate.id));
    const leaf = bytes === undefined ? undefined : leaves.find((l) => !twins.has(l.id) && bytesOf.get(l.id) === bytes);
    if (!leaf) continue;
    ctx.claimed.add(candidate.id);
    twins.set(leaf.id, candidate);
    taken.push(i);
  }
  const carried: LabelObject[] = [];
  const rebuild = (node: LabelObject): LabelObject => {
    const own = state.get(node.id) ?? {};
    if (isGroup(node)) return { ...patched(structuredClone({ ...node, children: [] }), own), children: node.children.map(rebuild) };
    const twin = twins.get(node.id);
    if (twin) return patched(twin, own);
    const clone = structuredClone(patched(node, own));
    const [renamed = clone] = rewriteTemplateMarkersMap([clone], renames);
    carried.push(renamed);
    return renamed;
  };
  const placed = roots.map(rebuild);
  for (const i of taken.reverse()) objects.splice(i, 1);
  // Removals sat below the "to" anchor and above the "from" one, so only "to" shifts.
  objects.splice(slot.anchor === "from" ? slot.from : slot.to - taken.length, 0, ...placed);
  for (const p of placed) ctx.placed.add(p.id);
  return { placed, carried };
}

/** Carries what a reparse cannot express from `current` into the parsed pages, keyed on
 *  the block-then-line diff between the session baseline and the edited text. */
export function carryAcrossApply(input: CarryInput): { pages: Page[]; variables: Variable[] } {
  const { current, imported, importedVariables, importedLabel, text } = input;
  const base = generateMultiPageZplWithMap(current.label, current.pages, current.variables);
  if (!input.baseline || input.baseline !== base.text) return { pages: imported, variables: [...importedVariables] };

  // A ^CC/^CT/^CD remap rewrites every line but no field; both texts diff in canonical prefixes.
  const baseText = canonicalPrefixes(base.text);
  const pages = imported.map((p) => ({ ...p, objects: [...p.objects] }));
  const parsed: Parsed[] = [];
  const frames = new Map<string, OverlayFrame>();
  pages.forEach((page, i) => {
    const source = input.pageSources[i];
    for (const [id, span] of source?.objectSpans ?? []) parsed.push({ id, page, ...span });
    for (const [id, frame] of source?.objectFrames ?? []) frames.set(id, frame);
  });
  parsed.sort((a, b) => a.start - b.start);
  const ctx: Ctx = {
    current,
    importedLabel,
    importedVariables,
    diff: diffBlocks(baseText, base.blocks, canonicalPrefixes(text), input.pageSources.map((s) => s.span)),
    baseText,
    baseSpan: new Map(base.spans.map((s) => [s.objectId, s] as const)),
    parsed,
    starts: parsed.map((p) => p.start),
    frames,
    pages,
    claimed: new Set<string>(),
    placed: new Set<string>(),
  };
  carryIdentity(ctx);

  // Names are settled before any clone exists, so the rewrite stays clone-scoped.
  const { kept, dropped } = matchVariablesByFn(current.variables, importedVariables);
  const renames = new Map(kept.filter((p) => p.from.name !== p.to.name).map((p) => [p.from.name, p.to.name] as const));
  const reserved = [...importedVariables];
  const candidates = dropped.map((v) => {
    const name = uniqueVariableName(v.name, reserved);
    if (name !== v.name) renames.set(v.name, name);
    const candidate = name === v.name ? v : { ...v, name };
    reserved.push(candidate);
    return candidate;
  });

  const carried: LabelObject[] = [];
  current.pages.forEach((prev, pageIndex) => {
    const page = pairedPage(ctx, pageIndex);
    if (!page) return;
    const order = [...walkExportOrder(prev.objects)];
    const excludedAt = (i: number): LabelObject | undefined => {
      const s = order[i];
      return s && "excluded" in s ? s.excluded : undefined;
    };
    const placedIn = new Map<string, Located>();
    let k = 0;
    while (k < order.length) {
      const roots: LabelObject[] = [];
      for (let r = excludedAt(k); r; r = excludedAt(k + roots.length)) roots.push(r);
      if (roots.length > 0) {
        const slot = slotFor(ctx, order, k, k + roots.length, page, placedIn);
        const result = placeExcluded(ctx, roots, slot, renames);
        carried.push(...result.carried);
        roots.forEach((r, i) => placedIn.set(r.id, { id: result.placed[i]?.id ?? r.id, page: slot.page }));
      }
      k += Math.max(1, roots.length);
    }
  });

  const refs = new Set(carried.flatMap((o) => extractTemplateRefs(getObjectStringContent(o) ?? "")));
  return { pages, variables: [...importedVariables, ...candidates.filter((v) => refs.has(v.name))] };
}
