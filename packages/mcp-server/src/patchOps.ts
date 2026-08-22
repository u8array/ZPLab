// patch_design: the op pipeline over an existing design file.

import { buildVariables, canonicalFieldJustify, freeId, objectInputSchema, pagesSizeError, parseEnvelope, propIssues, toLabelObject, typeIssues, unknownPropNotes, variableInputSchema, type DesignFileJson, type ToolError } from "./boundary.js";
import { boundReport, type ObjectBounds, type ObjectOverlap, type PreflightWarning } from "./report.js";

import { z } from "zod";
import {
  parseDesignFile,
  serializeDesign,
  type DesignFile,
} from "@zplab/core/lib/designFile";
import {
  withFootprintBinding,
} from "./footprint.js";
import {
  rewriteTemplateMarkers,
  substituteTemplateMarkers,
} from "@zplab/core/lib/templateObjects";
import { applyChanges } from "@zplab/core/lib/anchorRepin";
import { gfaCacheIsOnlyCopy, type ImageProps } from "@zplab/core/registry/image";
import { measureFootprintDots } from "@zplab/core/lib/footprintProber";
import {
  detachObjectById,
  hasLockedAncestor,
  isGroup,
  mapObjectById,
  pageLabelConfig,
  walkObjects,
  type LabelObject,
} from "@zplab/core/types/Group";
import { effectiveDpmm, type PageLabel } from "@zplab/core/types/LabelConfig";
import {
  isValidVariableName,
  stripMarkerDelimiters,
  type Variable,
} from "@zplab/core/types/Variable";


export const patchOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update"),
    id: z.string(),
    x: z
      .number()
      .optional()
      .describe(
        "Model x in dots. For a right-justified (fieldJustify 'R') text, symbol " +
          "or 2D field this is the printed RIGHT edge, so it is NOT the bounds " +
          "report's x (that is the ink left edge); nudging from a reported x " +
          "would jump the field by its own width.",
      ),
    y: z.number().optional(),
    positionType: z.enum(["FO", "FT"]).optional(),
    fieldJustify: z.enum(["L", "C", "R"]).optional(),
    /** Merged over the object's current props, like create_draft's merge. */
    props: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ op: z.literal("remove"), id: z.string() }),
  z.object({
    op: z.literal("add"),
    pageIndex: z.number().int().nonnegative().optional(),
    object: objectInputSchema,
  }),
  z.object({ op: z.literal("addVariable"), variable: variableInputSchema }),
  z.object({
    op: z.literal("updateVariable"),
    name: z.string().min(1),
    /** Renames the variable and every «marker» that references it. */
    newName: z.string().min(1).optional(),
    defaultValue: z.string().optional(),
    comment: z.string().optional(),
  }),
  z.object({ op: z.literal("removeVariable"), name: z.string().min(1) }),
]);
export type PatchOp = z.infer<typeof patchOpSchema>;

/** Every non-add op walks the whole tree a few times, so unbounded operations
 *  against a 10k-object design would wedge the single-threaded sidecar (which
 *  also serves the app's reply routes). Far beyond any real patch. */
export const MAX_PATCH_OPS = 1000;

export const patchDesignShape = {
  designFile: z.record(z.string(), z.unknown()),
  operations: z.array(patchOpSchema).min(1).max(MAX_PATCH_OPS),
};

export type PatchDesignResult =
  | {
      ok: true;
      designFile: DesignFileJson;
      warnings: PreflightWarning[];
      notes?: string[];
      bounds: ObjectBounds[];
      overlaps: ObjectOverlap[];
      geometryTruncated?: boolean;
    }
  | ToolError;

/** Apply edits to a design without rebuilding it. An updated object is marked
 *  dirty so the emitter regenerates just that field and replays the page's captured
 *  bytes around it; adding, removing or renaming a variable changes what the capture describes. */
export function patchDesign(designFile: unknown, operations: readonly PatchOp[]): PatchDesignResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const { label } = parsed.value;
  let variables = [...parsed.value.variables];
  const pages = parsed.value.pages.map((p) => ({ ...p, objects: [...p.objects] }));
  const touched = new Set<number>();
  /** Pages an update dirtied: they keep their capture, unlike `touched`. */
  const editedPages = new Set<number>();
  const takenIds = new Set(pages.flatMap((p) => allIds(p.objects)));
  // Memoised per page, dropped on any write to it: an object added earlier in
  // this call is still found (its add invalidates the page), while a 1000-update
  // patch on a 10k-object design no longer rebuilds the index per op.
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
  const droppedVariableIds = new Set<string>();
  /** Generated add-op ids, so a note can name the object the agent can address. */
  const assignedIds = new Map<PatchOp, string>();

  for (const op of operations) {
    if (op.op === "addVariable" || op.op === "updateVariable" || op.op === "removeVariable") {
      const applied = applyVariableOp(variables, pages, op, droppedVariableIds);
      if ("error" in applied) return { ok: false, errors: [applied.error] };
      // Marker rewrites rebuild page.objects, so every memoised node is stale.
      nodeIndex.clear();
      const before = variables;
      variables = applied.variables;
      // The captured bytes carry the ^FN declaration lines, so anything that
      // changes a variable's name, default or comment makes them stale; a call
      // that changes nothing leaves them alone.
      if (changesCapture(op, before)) for (let i = 0; i < pages.length; i++) touched.add(i);
      continue;
    }
    if (op.op === "add") {
      const index = op.pageIndex ?? 0;
      const page = pages[index];
      if (!page) return { ok: false, errors: [`No page at index ${index}`] };
      const typeErrors = typeIssues([op.object.type]);
      if (typeErrors.length > 0) return { ok: false, errors: typeErrors };
      const addIssues = propIssues(op.object.type, op.object.props);
      if (addIssues.length > 0) return { ok: false, errors: addIssues };
      if (op.object.id !== undefined && takenIds.has(op.object.id)) {
        return { ok: false, errors: [`Duplicate object id: ${op.object.id}`] };
      }
      const id = op.object.id ?? freeId(op.object.type, takenIds);
      assignedIds.set(op, id);
      takenIds.add(id);
      page.objects.push(toLabelObject(op.object, id, label));
      invalidate(index);
      touched.add(index);
      continue;
    }
    const found = locate(op.id);
    if (!found) return { ok: false, errors: [`No object with id ${op.id}`] };
    const { page, index, node: target } = found;
    // The editor's lock gate (applyObjectChanges / removeObject): everything a
    // patch op can touch is lock-blocked there, so refusing loudly beats the
    // editor's silent ignore, which would report ok on an edit that never lands.
    if (target.locked || hasLockedAncestor(page.objects, op.id)) {
      return { ok: false, errors: [`${op.id} is locked; unlock it in the app first`] };
    }
    if (op.op === "update") {
      // No registry entry to validate against, and its box comes from its
      // children, not its x/y: the edit would be accepted and do nothing.
      if (isGroup(target)) {
        return {
          ok: false,
          errors: [`${op.id} is a group; patch the objects inside it instead`],
        };
      }
      const updateIssues = propIssues(target.type, op.props);
      if (updateIssues.length > 0) return { ok: false, errors: updateIssues };
    }
    if (op.op === "remove") {
      touched.add(index);
      // Freed with the object: a remove followed by re-adding the same id is
      // the natural rename shape, and the patch is all-or-nothing.
      for (const gone of allIds([target])) takenIds.delete(gone);
      page.objects = detachObjectById(page.objects, op.id).rest;
      invalidate(index);
      continue;
    }
    // Marked dirty; the emitter regenerates this field and replays the rest,
    // same as the editor. Bound so the repin's probe measures resolved defaults,
    // not marker text (the editor binds the preview row instead; same rule, other source).
    editedPages.add(index);
    page.objects = withFootprintBinding(label, variables, () =>
      mapObjectById(page.objects, op.id, (o) => ({
        ...applyUpdate(o, op, pageLabelConfig(label, page)),
        dirty: true,
      })),
    );
    invalidate(index);
  }

  // Only structural edits invalidate the capture: an added object is not in it
  // and a removed one still is, so those pages re-emit from the model.
  const nextPages = pages.map((p, i) =>
    touched.has(i) ? { ...p, overlay: undefined } : p,
  );
  // Losing a capture is allowed, losing it silently is not (roundtrip rule): read
  // the pre-drop pages, since nextPages already lost the overlay this note is about.
  const captureLost = pages.flatMap((p, i) => {
    if (!p.overlay) return [];
    if (touched.has(i)) {
      return [`page ${i + 1}: the imported commands this page carried cannot be replayed around a structural edit (an added or removed object, or a changed variable), so export regenerates the block from the model`];
    }
    if (!p.overlay.regenSafe && editedPages.has(i)) {
      return [`page ${i + 1}: the imported commands this page carried cannot be replayed around an edit, so export regenerates the block from the model`];
    }
    return [];
  });
  // The user's dataset binding is not ours to drop; a deleted variable takes its
  // own binding with it, like the editor. The one full-tree check an op can flip:
  // add ops grow the object count past the cap, checked before the expensive serialize below.
  const oversize = pagesSizeError(nextPages);
  if (oversize) return oversize;
  const serialized = serializeDesign(
    label,
    nextPages,
    variables,
    withoutDroppedBindings(parsed.value.columnMapping, droppedVariableIds),
    parsed.value.dataSource,
  );
  const next = JSON.parse(serialized) as DesignFileJson;
  // Schema-parse only, not a second parseEnvelope: re-running propIssues/
  // duplicate-id over a tree built from validated ops pays for checks no op can
  // fail, and bounds are read from this canonical parse to describe exactly what we return.
  const parsedNext = parseDesignFile(serialized);
  if (!parsedNext.ok) return { ok: false, errors: ["internal: the patched design did not re-parse"] };
  const report = boundReport(
    label,
    parsedNext.value.variables,
    parsedNext.value.pages,
    undefined,
    parsedNext.value.columnMapping !== null,
  );
  // One index over the final tree for the notes passes: they only read, so
  // the per-op live lookup (see nodesById) is not needed here.
  const finalNodes = new Map(pages.flatMap((p) => [...nodesById(p.objects)]));
  const ignoredByBytes = operations.flatMap((op) => {
    if (op.op !== "update" || !op.props) return [];
    const target = finalNodes.get(op.id);
    const props = (target as { props?: ImageProps } | undefined)?.props;
    // Fresh bytes in the same op DO change the print, so no note then.
    if (!props || "_gfaCache" in op.props || "rawGf" in op.props) return [];
    // Byte-fixed either way: verbatim ^GF ships as-is, and a cache with no
    // source image behind it cannot re-encode (headerByteSource precedence).
    if (!props.rawGf && !gfaCacheIsOnlyCopy(props)) return [];
    if (!("widthDots" in op.props || "threshold" in op.props)) return [];
    // The graphic prints from its bytes, which nothing here can re-encode, so
    // a new width or threshold changes the model and not the print.
    return [`${op.id}: the graphic prints from its stored bytes, so widthDots and threshold do not change it`];
  });
  const opNotes = operations.flatMap((op) =>
    op.op === "add"
      ? unknownPropNotes(op.object.type, op.object.id ?? assignedIds.get(op) ?? op.object.type, op.object.props)
      : op.op === "update"
        ? unknownPropNotes(finalNodes.get(op.id)?.type ?? "", op.id, op.props)
        : [],
  );
  const notes = [...opNotes, ...ignoredByBytes, ...captureLost, ...(report.notes ?? [])];
  return {
    ok: true,
    designFile: next,
    ...report,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

type VariableOp = Extract<PatchOp, { op: `${string}Variable` }>;

/** Does this op change what a page's captured bytes describe? Add/remove change
 *  the ^FN declaration; for an update only the default reaches emitted bytes
 *  (inline ^FN{n}^FD{default}), so a rename or comment alone leaves the capture valid. */
function changesCapture(op: VariableOp, before: readonly Variable[]): boolean {
  if (op.op !== "updateVariable") return true;
  // Against the current value, not mere presence: re-asserting the same default
  // is a natural idempotent call and must not cost the overlays. Through the
  // same strip the mutator applies, or a stripped-equal value reads as a change.
  const current = before.find((v) => v.name === op.name);
  return (
    op.defaultValue !== undefined &&
    stripMarkerDelimiters(op.defaultValue) !== current?.defaultValue
  );
}

/** Bindings for variables that no longer exist would re-attach to whatever
 *  takes their id next, so they leave with them. */
function withoutDroppedBindings(
  mapping: DesignFile["columnMapping"],
  dropped: ReadonlySet<string>,
): DesignFile["columnMapping"] {
  if (!mapping || dropped.size === 0) return mapping;
  const bindings = Object.fromEntries(
    Object.entries(mapping.bindings).filter(([id]) => !dropped.has(id)),
  );
  return { ...mapping, bindings };
}

/** Variable edits mirror the editor: a rename rewrites every «marker», a delete
 *  leaves the last value as literal text rather than an orphan marker that
 *  would print its guillemets. */
function applyVariableOp(
  variables: readonly Variable[],
  pages: { objects: LabelObject[] }[],
  op: VariableOp,
  /** Ids whose dataset binding goes with them, collected for the caller. */
  dropped: Set<string>,
): { variables: Variable[] } | { error: string } {
  if (op.op === "addVariable") {
    // Append; a rebuild would renumber every id, and columnMapping.bindings is
    // keyed by id, so the user's dataset columns would silently unbind.
    const built = buildVariables([op.variable], variables);
    return "error" in built ? built : { variables: [...variables, ...built.value] };
  }
  const current = variables.find((v) => v.name === op.name);
  const index = current ? variables.indexOf(current) : -1;
  if (!current) return { error: `No variable named ${op.name}` };
  if (op.op === "removeVariable") {
    dropped.add(current.id);
    for (const page of pages) {
      // Delimiters stripped like the editor does: a default carrying «…» would
      // re-parse as a marker and bind the field to another variable.
      page.objects = substituteTemplateMarkers(
        page.objects,
        current.name,
        stripMarkerDelimiters(current.defaultValue),
      );
    }
    return { variables: variables.filter((_, i) => i !== index) };
  }
  // Trimmed like buildVariables stores it (boundary.ts): a rename must not write
  // a name no later call can address.
  const renamed = op.newName?.trim();
  const newName = renamed !== undefined && renamed !== current.name ? renamed : null;
  if (newName !== null) {
    if (!isValidVariableName(newName)) {
      return { error: `Invalid variable name: ${JSON.stringify(newName)}` };
    }
    if (variables.some((v) => v.name === newName)) {
      return { error: `Duplicate variable name: ${newName}` };
    }
    for (const page of pages) {
      page.objects = rewriteTemplateMarkers(page.objects, current.name, newName);
    }
  }
  const next = variables.map((v, i) =>
    i === index
      ? {
          ...v,
          ...(renamed !== undefined ? { name: renamed } : {}),
          ...(op.defaultValue !== undefined
            ? { defaultValue: stripMarkerDelimiters(op.defaultValue) }
            : {}),
          ...(op.comment !== undefined ? { comment: op.comment } : {}),
        }
      : v,
  );
  return { variables: next };
}

/** Every id in the tree, groups included: the bounds report names leaf ids, so
 *  a patch has to reach them and an auto-generated id must not collide with one. */
function allIds(objects: readonly LabelObject[]): string[] {
  return [...walkObjects(objects)].map((o) => o.id);
}

/** Every leaf and group node, keyed by id. */
function nodesById(objects: readonly LabelObject[]): Map<string, LabelObject> {
  return new Map([...walkObjects(objects)].map((o) => [o.id, o]));
}


/** Positional fields replace, props merge: an agent that only knows one prop
 *  must not have to restate the rest of the object. */
function applyUpdate(
  object: LabelObject,
  op: Extract<PatchOp, { op: "update" }>,
  // Page-folded (^JM halves the density), like every other geometry consumer.
  label: PageLabel,
): LabelObject {
  // Computed first: 'C' on a non-1D type canonicalizes to nothing, and writing
  // that undefined into the merge would CLEAR an existing anchor instead of
  // ignoring the meaningless ask (clearing is expressed as 'L').
  const justify =
    op.fieldJustify !== undefined ? canonicalFieldJustify(object.type, op.fieldJustify) : undefined;
  const changes = {
    ...(op.x !== undefined ? { x: op.x } : {}),
    ...(op.y !== undefined ? { y: op.y } : {}),
    ...(op.positionType !== undefined ? { positionType: op.positionType } : {}),
    ...(justify !== undefined ? { fieldJustify: justify } : {}),
    ...(op.props ? { props: op.props } : {}),
  };
  // The editor's pipeline (applyChanges), fed the sidecar's registered footprint
  // measurer as its probe and the same device-font ctx the editor passes, or a
  // ^FB growth would derive block metrics from font 0 here.
  return applyChanges(
    object,
    changes as never,
    (o) => {
      const fp = measureFootprintDots(o, effectiveDpmm(label));
      return fp ? { w: fp.w, h: fp.h } : null;
    },
    { label },
  );
}
