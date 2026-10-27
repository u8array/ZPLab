import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import {
  createDraft,
  createDraftShape,
  designFileEnvelopeSchema,
  dpmmSchema,
  exportZpl,
  exportZplInputSchema,
  getSchema,
  importZpl,
  INSIDE_DESIGN_FILE,
  INSIDE_OBJECT_ENTRY,
  labelConfigSchema,
  patchDesign,
  patchDesignShape,
  schemaToolError,
  strictShape,
  validateDraft,
  validateZpl,
  zplInputShape,
  type ObjectBounds,
  type ObjectOverlap,
  type ToolError,
  type ZplFindings,
} from "@zplab/headless";
import { requireToken, toolError } from "./auth.js";

export interface AppOptions {
  token: string;
  version: string;
}

/** Same bound as the MCP transport, see packages/mcp-server/src/http.ts. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const strictBody = <T extends z.ZodRawShape>(shape: T, belongs = "") => strictShape(shape, "field", "This route", belongs);

// The generator documents a multi-value literal by its first value only, so the enum restates every value.
// Rebuilt with this z: zod copies methods per instance, so the facade's schema predates the openapi extension.
const dpmmDoc = z.literal([...dpmmSchema.values]).openapi({ type: "number", enum: [...dpmmSchema.values] });
const draftBody = { ...createDraftShape, dpmm: dpmmDoc };
const zplBody = { ...zplInputShape, dpmm: z.optional(dpmmDoc) };

const toolErrorSchema: z.ZodType<ToolError> = z
  .object({ ok: z.literal(false), errors: z.array(z.string()) })
  .openapi("ToolError", { description: "Every refusal, whichever layer raised it" });
const designFileDoc = z.record(z.string(), z.unknown()).openapi({ description: "A ZPLab design file; the schema route describes its objects" });
const rectDots = { x: z.number(), y: z.number(), width: z.number(), height: z.number() };
const warning = z
  .object({ pageIndex: z.number(), objectId: z.string(), kind: z.string(), severity: z.enum(["error", "warning"]), detail: z.string().optional() })
  .openapi("PreflightWarning", { description: "A print problem on one object" });
const objectBounds: z.ZodType<ObjectBounds> = z
  .object({ pageIndex: z.number(), objectId: z.string(), type: z.string(), content: z.string().optional(), ...rectDots, approx: z.boolean() })
  .openapi("ObjectBounds", { description: "The box of one object in dots from the top-left, an estimate where approx is true" });
const objectOverlap: z.ZodType<ObjectOverlap> = z
  .object({ pageIndex: z.number(), a: z.string(), b: z.string(), ...rectDots, approx: z.boolean() })
  .openapi("ObjectOverlap", { description: "The dots the boxes of objects a and b share" });
const reportKeys = { ok: z.literal(true), warnings: z.array(warning), notes: z.array(z.string()).optional() };
const geometryKeys = { bounds: z.array(objectBounds), overlaps: z.array(objectOverlap), geometryTruncated: z.boolean().optional() };
// The generator cannot read the catch and preprocess wrappers of the core schema, so zod renders it.
// Its JSON Schema type allows boolean subschemas, which the OpenAPI type lacks, so the cast is needed.
const { $schema: _dialect, ...labelDoc } = z.toJSONSchema(labelConfigSchema, { io: "output" });
const label = z
  .record(z.string(), z.unknown())
  .openapi("LabelConfig", { ...(labelDoc as object), description: "The label size and every printer setting the stream sets" });
const bucket = z.array(z.string());
const findings: z.ZodType<ZplFindings> = z
  .object({
    partial: bucket,
    browserLimit: bucket,
    unknown: bucket,
    replayRisk: bucket,
    deviceAction: bucket,
    hostQuery: bucket,
    unterminatedField: bucket,
    hexControl: bucket,
  })
  .openapi({ description: "The parser's command buckets, each deduplicated" });
const designReport = z.looseObject({ ...reportKeys, ...geometryKeys, designFile: designFileDoc });
const report = z.looseObject({ ...reportKeys, ...geometryKeys });
const exportReport = z.looseObject({ ...reportKeys, zpl: z.string() });
const importReport = z.looseObject({
  ...reportKeys,
  ...geometryKeys,
  designFile: designFileDoc,
  label,
  findings,
  batch: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())), formatPath: z.string().optional() }).optional(),
});
const zplReport = z.looseObject({
  ...reportKeys,
  ...geometryKeys,
  objectCount: z.number(),
  pageCount: z.number(),
  label,
  findings,
  batch: z.object({ headers: z.array(z.string()), rowCount: z.number() }).optional(),
});
const schemaType = z.looseObject({
  type: z.string(),
  label: z.string(),
  defaultProps: z.record(z.string(), z.unknown()),
  props: z.record(z.string(), z.string()).optional(),
  domains: z.record(z.string(), z.string()).optional(),
});

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const refusals = {
  400: json(toolErrorSchema, "What the input lacks"),
  401: json(toolErrorSchema, "Missing or wrong bearer token"),
  413: json(toolErrorSchema, "Body over 16 MiB"),
  415: json(toolErrorSchema, "Body is not application/json"),
  500: json(toolErrorSchema, "A server fault"),
};

const post = <T extends z.ZodRawShape, R extends z.ZodType>(operationId: string, path: string, body: T, belongs: string, result: R, summary: string) =>
  createRoute({
    method: "post",
    operationId,
    path,
    summary,
    security: [{ bearerAuth: [] }],
    request: { body: { ...json(strictBody(body, belongs), "request"), required: true } },
    responses: { 200: json(result, "The result and its report"), ...refusals },
  });

const routes = {
  draft: post("createDraft", "/draft", draftBody, INSIDE_OBJECT_ENTRY, designReport, "Build a design file from a size and a list of objects"),
  validate: post("validateDraft", "/validate", designFileEnvelopeSchema.shape, INSIDE_DESIGN_FILE, report, "Report a design file"),
  patch: post("patchDesign", "/patch", patchDesignShape, INSIDE_DESIGN_FILE, designReport, "Edit a design file by operations"),
  export: post("exportZpl", "/export", exportZplInputSchema.shape, INSIDE_DESIGN_FILE, exportReport, "Generate the ZPL of a design file"),
  import: post("importZpl", "/import", zplBody, "", importReport, "Parse raw ZPL into a design file"),
  validateZpl: post("validateZpl", "/validate-zpl", zplBody, "", zplReport, "Report raw ZPL without building a design"),
  schema: createRoute({
    method: "get",
    operationId: "getSchema",
    path: "/schema",
    summary: "The object types and props a design file takes",
    security: [{ bearerAuth: [] }],
    responses: {
      200: json(z.object({ note: z.string(), objectShape: z.record(z.string(), z.string()), types: z.array(schemaType) }), "The schema"),
      401: refusals[401],
      500: refusals[500],
    },
  }),
  health: createRoute({
    method: "get",
    operationId: "health",
    path: "/health",
    summary: "Liveness and the running version",
    responses: { 200: json(z.object({ ok: z.literal(true), version: z.string() }), "Alive") },
  }),
};

/** The app without a listener, so tests drive it through `app.request()`. */
export function createApp({ token, version }: AppOptions) {
  if (token === "") throw new Error("the bearer token must not be empty");
  const app = new OpenAPIHono({
    defaultHook: (result, c) => (result.success ? undefined : c.json(schemaToolError(result.error, "body"), 400)),
  }).basePath("/api/v1");

  // Hono and the validator answer in plain text, so every refusal is mapped to the ToolError shape.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json(toolError(err.message || "request refused"), err.status);
    process.stderr.write(`${err.stack ?? err.message}\n`);
    return c.json(toolError("internal error"), 500);
  });
  app.notFound((c) => c.json(toolError("no such route"), 404));

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer" });
  app.doc31("/openapi.json", { openapi: "3.1.0", info: { title: "ZPLab server", version } });
  app.openapi(routes.health, (c) => c.json({ ok: true as const, version }, 200));

  // Registered after the two public routes, so they alone answer without a token.
  app.use("*", requireToken(token));
  app.post("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(toolError("body exceeds 16 MiB"), 413) }));

  app.openapi(routes.draft, (c) => {
    const r = createDraft(c.req.valid("json"));
    return r.ok ? c.json(r, 200) : c.json(r, 400);
  });
  app.openapi(routes.validate, (c) => {
    const r = validateDraft(c.req.valid("json").designFile);
    return r.ok ? c.json(r, 200) : c.json(r, 400);
  });
  app.openapi(routes.patch, (c) => {
    const { designFile, operations } = c.req.valid("json");
    const r = patchDesign(designFile, operations);
    return r.ok ? c.json(r, 200) : c.json(r, 400);
  });
  app.openapi(routes.export, (c) => {
    const { designFile, metadata, batch } = c.req.valid("json");
    const r = exportZpl(designFile, { metadata, batch });
    return r.ok ? c.json(r, 200) : c.json(r, 400);
  });
  app.openapi(routes.import, (c) => {
    const { zpl, dpmm, widthMm, heightMm } = c.req.valid("json");
    const r = importZpl(zpl, dpmm, widthMm, heightMm);
    return r.ok ? c.json(r, 200) : c.json(r, 400);
  });
  app.openapi(routes.validateZpl, (c) => {
    const { zpl, dpmm, widthMm, heightMm } = c.req.valid("json");
    const r = validateZpl(zpl, dpmm, widthMm, heightMm);
    return r.ok ? c.json(r, 200) : c.json(r, 400);
  });
  app.openapi(routes.schema, (c) => c.json(getSchema(), 200));
  return app;
}
