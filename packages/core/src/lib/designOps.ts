// The MCP patch tool and the app's agent edits are two callers of this reducer, never two interpreters.

import { applyChanges, type BarcodeFootprint } from "./anchorRepin";
import { rewriteTemplateMarkers } from "./templateObjects";
import { removeVariables } from "./variableRemoval";
import {
  buildVariables,
  canonicalFieldJustify,
  freeId,
  propIssues,
  toLabelObject,
  typeIssues,
  type ObjectInput,
} from "./designInput";
import {
  detachObjectById,
  hasLockedAncestor,
  isGroup,
  mapObjectById,
  pageLabelConfig,
  walkObjects,
  type LabelObject,
  type Page,
} from "../types/Group";
import type { LabelConfig, PageLabel } from "../types/LabelConfig";
import { isValidVariableName, stripMarkerDelimiters, type ColumnMapping, type Variable, type VariableInput } from "../types/Variable";

export type DesignOp =
  | {
      op: "update";
      id: string;
      x?: number;
      y?: number;
      positionType?: "FO" | "FT";
      fieldJustify?: "L" | "C" | "R";
      /** Merged over the object's current props, like create_draft's merge. */
      props?: Record<string, unknown>;
    }
  | { op: "remove"; id: string }
  | { op: "add"; pageIndex?: number; object: ObjectInput }
  | { op: "addVariable"; variable: VariableInput }
  | {
      op: "updateVariable";
      name: string;
      /** Renames the variable and every «marker» that references it. */
      newName?: string;
      defaultValue?: string;
      comment?: string;
    }
  | { op: "removeVariable"; name: string };

export interface DesignDoc {
  label: LabelConfig;
  pages: Page[];
  variables: Variable[];
  columnMapping: ColumnMapping | null;
}

/** Supplied by the caller: the sidecar and the canvas measure differently. */
export type DesignOpsProbe = (
  object: LabelObject,
  ctx: { label: PageLabel; variables: readonly Variable[] },
) => BarcodeFootprint | null;

export type DesignOpsResult =
  | {
      ok: true;
      doc: DesignDoc;
      /** Pages whose capture no longer describes them: their overlay is gone. */
      touched: ReadonlySet<number>;
      /** Pages an update dirtied: they keep their capture, unlike `touched`. */
      edited: ReadonlySet<number>;
      /** Generated add-op ids by op index. */
      assignedIds: ReadonlyMap<number, string>;
    }
  | { ok: false; errors: string[]; opIndex: number };

/** All or nothing: the first failing op returns its issues and the input doc is untouched. */
export function applyDesignOps(doc: DesignDoc, ops: readonly DesignOp[], probe: DesignOpsProbe): DesignOpsResult {
  const { label } = doc;
  let variables = [...doc.variables];
  let columnMapping = doc.columnMapping;
  const pages = doc.pages.map((p) => ({ ...p, objects: [...p.objects] }));
  const touched = new Set<number>();
  const edited = new Set<number>();
  const takenIds = new Set(pages.flatMap((p) => allIds(p.objects)));
  // Memoised per page and dropped on any write to it: a 1000-op patch on a 10k-object design must not rebuild the index per op.
  const nodeIndex = new Map<number, Map<string, LabelObject>>();
  const invalidate = (index: number) => nodeIndex.delete(index);
  const locate = (id: string): { page: (typeof pages)[number]; index: number; node: LabelObject } | undefined => {
    for (const [index, page] of pages.entries()) {
      let byId = nodeIndex.get(index);
      if (!byId) {
        byId = nodesById(page.objects);
        nodeIndex.set(index, byId);
      }
      const node = byId.get(id);
      if (node) return { page, index, node };
    }
    return undefined;
  };
  const assignedIds = new Map<number, string>();
  const fail = (errors: string | string[], opIndex: number): DesignOpsResult => ({ ok: false, errors: [errors].flat(), opIndex });

  for (const [opIndex, op] of ops.entries()) {
    if (op.op === "addVariable" || op.op === "updateVariable" || op.op === "removeVariable") {
      const applied = applyVariableOp({ variables, pages, columnMapping }, op);
      if ("error" in applied) return fail(applied.error, opIndex);
      // Marker rewrites rebuild page.objects, so every memoised node is stale.
      nodeIndex.clear();
      variables = applied.variables;
      columnMapping = applied.columnMapping;
      for (const [i, page] of applied.pages.entries()) pages[i] = page;
      if (applied.changesCapture) for (let i = 0; i < pages.length; i++) touched.add(i);
      continue;
    }
    if (op.op === "add") {
      const index = op.pageIndex ?? 0;
      const page = pages[index];
      if (!page) return fail(`No page at index ${index}`, opIndex);
      const typeErrors = typeIssues([op.object.type]);
      if (typeErrors.length > 0) return fail(typeErrors, opIndex);
      const addIssues = propIssues(op.object.type, op.object.props);
      if (addIssues.length > 0) return fail(addIssues, opIndex);
      if (op.object.id !== undefined && takenIds.has(op.object.id)) {
        return fail(`Duplicate object id: ${op.object.id}`, opIndex);
      }
      const id = op.object.id ?? freeId(op.object.type, takenIds);
      assignedIds.set(opIndex, id);
      takenIds.add(id);
      page.objects.push(toLabelObject(op.object, id, label));
      invalidate(index);
      touched.add(index);
      continue;
    }
    const found = locate(op.id);
    if (!found) return fail(`No object with id ${op.id}`, opIndex);
    const { page, index, node: target } = found;
    // The editor ignores edits on locked objects silently. Here that would report ok on an edit that never landed.
    if (target.locked || hasLockedAncestor(page.objects, op.id)) {
      return fail(`${op.id} is locked; unlock it in the app first`, opIndex);
    }
    if (op.op === "update") {
      // A group has no registry entry and takes its box from its children, so the edit would do nothing.
      if (isGroup(target)) return fail(`${op.id} is a group; patch the objects inside it instead`, opIndex);
      const updateIssues = propIssues(target.type, op.props);
      if (updateIssues.length > 0) return fail(updateIssues, opIndex);
    }
    if (op.op === "remove") {
      touched.add(index);
      // Freed with the object, so a remove followed by re-adding the same id reads as a rename.
      for (const gone of allIds([target])) takenIds.delete(gone);
      page.objects = detachObjectById(page.objects, op.id).rest;
      invalidate(index);
      continue;
    }
    // Marked dirty; the emitter regenerates this field and replays the rest, same as the editor.
    edited.add(index);
    const pageLabel = pageLabelConfig(label, page);
    const bound = variables;
    page.objects = mapObjectById(page.objects, op.id, (o) => ({
      ...applyUpdate(o, op, pageLabel, (candidate) => probe(candidate, { label: pageLabel, variables: bound })),
      dirty: true,
    }));
    invalidate(index);
  }

  // Only structural edits invalidate the capture: an added object is not in it and a removed one still is.
  const nextPages = pages.map((p, i) => (touched.has(i) ? { ...p, overlay: undefined } : p));
  return { ok: true, doc: { label, pages: nextPages, variables, columnMapping }, touched, edited, assignedIds };
}

/** Pages whose capture the ops dropped, and pages whose capture export can no longer replay around an edit. */
export function captureLoss(
  before: readonly Page[],
  touched: ReadonlySet<number>,
  edited: ReadonlySet<number>,
): { lost: number[]; atRisk: number[] } {
  const lost: number[] = [];
  const atRisk: number[] = [];
  before.forEach((p, i) => {
    if (!p.overlay) return;
    if (touched.has(i)) lost.push(i);
    else if (!p.overlay.regenSafe && edited.has(i)) atRisk.push(i);
  });
  return { lost, atRisk };
}

type VariableOp = Extract<DesignOp, { op: `${string}Variable` }>;

interface VariableDoc {
  variables: Variable[];
  pages: Page[];
  columnMapping: ColumnMapping | null;
}

function applyVariableOp(
  doc: VariableDoc,
  op: VariableOp,
): (VariableDoc & { changesCapture: boolean }) | { error: string } {
  const { variables, pages, columnMapping } = doc;
  if (op.op === "addVariable") {
    // Appended, not rebuilt: columnMapping.bindings is keyed by id, so renumbering would unbind the dataset.
    const built = buildVariables([op.variable], variables);
    if ("error" in built) return built;
    return { variables: [...variables, ...built.value], pages, columnMapping, changesCapture: true };
  }
  const current = variables.find((v) => v.name === op.name);
  if (!current) return { error: `No variable named ${op.name}` };
  if (op.op === "removeVariable") {
    return { ...removeVariables({ variables, pages, columnMapping }, new Set([current.id])), changesCapture: true };
  }
  // Trimmed like buildVariables stores it.
  const renamed = op.newName?.trim();
  const newName = renamed !== undefined && renamed !== current.name ? renamed : null;
  let nextPages = pages;
  if (newName !== null) {
    if (!isValidVariableName(newName)) return { error: `Invalid variable name: ${JSON.stringify(newName)}` };
    if (variables.some((v) => v.name === newName)) return { error: `Duplicate variable name: ${newName}` };
    nextPages = pages.map((page) => ({ ...page, objects: rewriteTemplateMarkers(page.objects, current.name, newName) }));
  }
  // Only the default reaches emitted bytes, so a rename or comment alone keeps the capture.
  // Compared after the same strip, so re-asserting an equal default costs nothing.
  const nextDefault = op.defaultValue !== undefined ? stripMarkerDelimiters(op.defaultValue) : undefined;
  const changesCapture = nextDefault !== undefined && nextDefault !== current.defaultValue;
  const next = variables.map((v) =>
    v === current
      ? {
          ...v,
          ...(renamed !== undefined ? { name: renamed } : {}),
          ...(nextDefault !== undefined ? { defaultValue: nextDefault } : {}),
          ...(op.comment !== undefined ? { comment: op.comment } : {}),
        }
      : v,
  );
  return { variables: next, pages: nextPages, columnMapping, changesCapture };
}

/** Groups included: a generated id must not collide with one. */
function allIds(objects: readonly LabelObject[]): string[] {
  return [...walkObjects(objects)].map((o) => o.id);
}

export function nodesById(objects: readonly LabelObject[]): Map<string, LabelObject> {
  return new Map([...walkObjects(objects)].map((o) => [o.id, o]));
}

/** Positional fields replace, props merge, so an agent need not restate the whole object. */
function applyUpdate(
  object: LabelObject,
  op: Extract<DesignOp, { op: "update" }>,
  // Page-folded (^JM halves the density), like every other geometry consumer.
  label: PageLabel,
  probe: (o: LabelObject) => BarcodeFootprint | null,
): LabelObject {
  // Computed first: 'C' on a non-1D type canonicalizes to undefined, and merging that would
  // clear an existing anchor instead of ignoring the ask.
  const justify =
    op.fieldJustify !== undefined ? canonicalFieldJustify(object.type, op.fieldJustify) : undefined;
  const changes = {
    ...(op.x !== undefined ? { x: op.x } : {}),
    ...(op.y !== undefined ? { y: op.y } : {}),
    ...(op.positionType !== undefined ? { positionType: op.positionType } : {}),
    ...(justify !== undefined ? { fieldJustify: justify } : {}),
    ...(op.props ? { props: op.props } : {}),
  };
  // Same device-font ctx the editor passes, or a ^FB growth would derive block metrics from font 0.
  return applyChanges(object, changes as never, probe, { label });
}
