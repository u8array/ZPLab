import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import {
  createDraft,
  createDraftShape,
  designFileEnvelopeSchema,
  designReportSchema,
  dpmmSchema,
  exportZpl,
  exportZplInputSchema,
  exportZplReportSchema,
  getSchema,
  importZpl,
  importZplReportSchema,
  INSIDE_DESIGN_FILE,
  INSIDE_OBJECT_ENTRY,
  patchDesign,
  patchDesignShape,
  schemaResultSchema,
  schemaToolError,
  strictShape,
  toolErrorSchema,
  validateDraft,
  validateDraftReportSchema,
  validateZpl,
  validateZplReportSchema,
  zplInputShape,
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
const dpmmDoc = dpmmSchema.meta({ type: "number", enum: [...dpmmSchema.values] });
const draftBody = { ...createDraftShape, dpmm: dpmmDoc };
const zplBody = { ...zplInputShape, dpmm: z.optional(dpmmDoc) };

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
  draft: post("createDraft", "/draft", draftBody, INSIDE_OBJECT_ENTRY, designReportSchema, "Build a design file from a size and a list of objects"),
  validate: post("validateDraft", "/validate", designFileEnvelopeSchema.shape, INSIDE_DESIGN_FILE, validateDraftReportSchema, "Report a design file"),
  patch: post("patchDesign", "/patch", patchDesignShape, INSIDE_DESIGN_FILE, designReportSchema, "Edit a design file by operations"),
  export: post("exportZpl", "/export", exportZplInputSchema.shape, INSIDE_DESIGN_FILE, exportZplReportSchema, "Generate the ZPL of a design file"),
  import: post("importZpl", "/import", zplBody, "", importZplReportSchema, "Parse raw ZPL into a design file"),
  validateZpl: post("validateZpl", "/validate-zpl", zplBody, "", validateZplReportSchema, "Report raw ZPL without building a design"),
  schema: createRoute({
    method: "get",
    operationId: "getSchema",
    path: "/schema",
    summary: "The object types and props a design file takes",
    security: [{ bearerAuth: [] }],
    responses: {
      200: json(schemaResultSchema, "The schema"),
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
