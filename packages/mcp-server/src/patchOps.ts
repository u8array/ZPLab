// patch_design: the envelope around the core op reducer, plus the report the agent reads.

import { objectInputSchema, pagesSizeError, parseEnvelope, unknownPropNotes, variableInputSchema, type DesignFileJson, type ToolError } from "./boundary.js";
import { boundReport, type ObjectBounds, type ObjectOverlap, type PreflightWarning } from "./report.js";

import { z } from "zod";
import {
  parseDesignFile,
  serializeDesign,
} from "@zplab/core/lib/designFile";
import { applyDesignOps, nodesById, type DesignOp } from "@zplab/core/lib/designOps";
import { withFootprintBinding } from "./footprint.js";
import { gfaCacheIsOnlyCopy, type ImageProps } from "@zplab/core/registry/image";
import { measureFootprintDots } from "@zplab/core/lib/footprintProber";
import { effectiveDpmm } from "@zplab/core/types/LabelConfig";


export const patchOpSchema: z.ZodType<DesignOp> = z.discriminatedUnion("op", [
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
    newName: z.string().min(1).optional(),
    defaultValue: z.string().optional(),
    comment: z.string().optional(),
  }),
  z.object({ op: z.literal("removeVariable"), name: z.string().min(1) }),
]);
export type PatchOp = DesignOp;

/** Unbounded ops on a 10k-object design would wedge the single-threaded sidecar, which also serves the app's reply routes. */
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

export function patchDesign(designFile: unknown, operations: readonly PatchOp[]): PatchDesignResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const { label } = parsed.value;
  const applied = applyDesignOps(
    { label, pages: parsed.value.pages, variables: parsed.value.variables, columnMapping: parsed.value.columnMapping },
    operations,
    // Bound so the repin measures resolved defaults, not marker text. The editor binds the preview row instead.
    (object, ctx) =>
      withFootprintBinding(label, ctx.variables, () => {
        const fp = measureFootprintDots(object, effectiveDpmm(ctx.label));
        return fp ? { w: fp.w, h: fp.h } : null;
      }),
  );
  if (!applied.ok) return { ok: false, errors: applied.errors };
  const { doc, touched, edited, assignedIds } = applied;

  // Losing a capture is allowed, losing it silently is not. Read from the input, the result already lost the overlay.
  const captureLost = parsed.value.pages.flatMap((p, i) => {
    if (!p.overlay) return [];
    if (touched.has(i)) {
      return [`page ${i + 1}: the imported commands this page carried cannot be replayed around a structural edit (an added or removed object, or a changed variable), so export regenerates the block from the model`];
    }
    if (!p.overlay.regenSafe && edited.has(i)) {
      return [`page ${i + 1}: the imported commands this page carried cannot be replayed around an edit, so export regenerates the block from the model`];
    }
    return [];
  });
  // Add ops can grow the object count past the cap. Checked before the expensive serialize.
  const oversize = pagesSizeError(doc.pages);
  if (oversize) return oversize;
  const serialized = serializeDesign(label, doc.pages, doc.variables, doc.columnMapping, parsed.value.dataSource);
  const next = JSON.parse(serialized) as DesignFileJson;
  // Schema-parse only: the tree was built from validated ops, and the bounds are read from this canonical parse.
  const parsedNext = parseDesignFile(serialized);
  if (!parsedNext.ok) return { ok: false, errors: ["internal: the patched design did not re-parse"] };
  const report = boundReport(
    label,
    parsedNext.value.variables,
    parsedNext.value.pages,
    undefined,
    parsedNext.value.columnMapping !== null,
  );
  const finalNodes = new Map(doc.pages.flatMap((p) => [...nodesById(p.objects)]));
  const ignoredByBytes = operations.flatMap((op) => {
    if (op.op !== "update" || !op.props) return [];
    const target = finalNodes.get(op.id);
    const props = (target as { props?: ImageProps } | undefined)?.props;
    // Fresh bytes in the same op DO change the print, so no note then.
    if (!props || "_gfaCache" in op.props || "rawGf" in op.props) return [];
    // Byte-fixed either way: verbatim ^GF ships as-is, and a cache with no source image cannot re-encode.
    if (!props.rawGf && !gfaCacheIsOnlyCopy(props)) return [];
    if (!("widthDots" in op.props || "threshold" in op.props)) return [];
    // The graphic prints from bytes nothing here can re-encode, so width and threshold change only the model.
    return [`${op.id}: the graphic prints from its stored bytes, so widthDots and threshold do not change it`];
  });
  const opNotes = operations.flatMap((op, i) =>
    op.op === "add"
      ? unknownPropNotes(op.object.type, op.object.id ?? assignedIds.get(i) ?? op.object.type, op.object.props)
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
