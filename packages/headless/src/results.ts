// The answer of each tool as a schema, from which the result types derive and
// the REST server documents. Nothing parses an answer with them.

import { z } from "zod";
import type { ImportReport } from "@zplab/core/lib/zplParser";
import { labelConfigSchema } from "@zplab/core/types/LabelConfig";
import type { DesignFileJson } from "./boundary.js";
import { boundReportSchema, warningReportSchema, type ShapeOf } from "./report.js";

const ok = z.literal(true);

// Documented as an open object: the schema tool describes what a design file holds.
// The generator marks a key as required only when its schema refuses undefined, so the predicate keeps designFile required.
const designFileSchema = z
  .custom<DesignFileJson>((value) => typeof value === "object" && value !== null)
  .meta({ type: "object", additionalProperties: {}, description: "A ZPLab design file. The schema route describes its objects." });

// The OpenAPI generator throws on the core schema's catch and preprocess wrappers, so zod renders it.
const { $schema: _dialect, ...labelDoc } = z.toJSONSchema(labelConfigSchema, { io: "output" });
const labelSchema = labelConfigSchema.meta({ id: "LabelConfig", ...labelDoc, description: "The label size and every printer setting the stream sets" });

/** The report's deduped command buckets. The per-occurrence findings stay out because they only serve navigation in the app. */
export type ZplFindings = Omit<ImportReport, "findings">;

const bucket = z.array(z.string());
const findingsSchema = z
  .object({
    partial: bucket,
    browserLimit: bucket,
    unknown: bucket,
    replayRisk: bucket,
    deviceAction: bucket,
    hostQuery: bucket,
    unterminatedField: bucket,
    hexControl: bucket,
  } satisfies ShapeOf<ZplFindings>)
  .meta({ description: "The parser's command buckets, each deduplicated" });

export const designReportSchema = z.object({ ok, ...boundReportSchema.shape, designFile: designFileSchema });

export const validateDraftReportSchema = z.object({ ok, ...boundReportSchema.shape });

export const exportZplReportSchema = z.object({ ok, ...warningReportSchema.shape, zpl: z.string() });

export const importZplReportSchema = z.object({
  ok,
  ...boundReportSchema.shape,
  designFile: designFileSchema,
  // What the stream itself declared, after the caller's hints and the fallback size: ^PW/^LL win.
  label: labelSchema,
  findings: findingsSchema,
  batch: z
    .object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())), formatPath: z.string().optional() })
    .optional()
    .meta({ description: "The rows the stream's ^XF recall blocks carry for its ^DF template, bound to the variables by the design file's csvMapping" }),
});

export const validateZplReportSchema = z.object({
  ok,
  ...boundReportSchema.shape,
  objectCount: z.number(),
  pageCount: z.number(),
  label: labelSchema,
  findings: findingsSchema,
  batch: z
    .object({ headers: z.array(z.string()), rowCount: z.number() })
    .optional()
    .meta({ description: "The headers and the row count of the stream's ^XF recall blocks for its ^DF template" }),
});

export const schemaResultSchema = z.object({
  note: z.string(),
  objectShape: z.record(z.string(), z.string()),
  types: z.array(
    z.object({
      type: z.string(),
      label: z.string(),
      defaultProps: z.record(z.string(), z.unknown()),
      props: z.record(z.string(), z.string()).optional(),
      domains: z.record(z.string(), z.string()).optional().meta({ description: "The wire domain of each bounded prop" }),
    }),
  ),
});
