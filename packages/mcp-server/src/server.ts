import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAppAttached, requestCurrentDesign, requestOpenDraft, requestRaster } from "./appBridge.js";
import { registerSidecarFootprintMeasurer } from "./footprint.js";
import { registerPrompts } from "./prompts.js";
import {
  buildCurrentDesignResult,
  createDraft,
  createDraftShape,
  designFileEnvelopeSchema,
  exportZplInputSchema,
  exportZpl,
  getSchema,
  importZpl,
  openInApp,
  patchDesign,
  patchDesignShape,
  rasterImageResult,
  rasterImageShape,
  validateDraft,
  validateZpl,
  zplInputShape,
} from "./tools.js";

export interface BuildServerOptions {
  /** This transport can reach a desktop window. HTTP only: the app tools talk
   *  over stdout event lines, which in stdio mode IS the protocol. */
  hosted?: boolean;
}

const NO_WINDOW = {
  ok: false,
  errors: ["No ZPLab window is connected to this server."],
};

/** Mid-grey: what the app's own image import uses. */
const DEFAULT_RASTER_THRESHOLD = 128;

// Compact on purpose: pretty-printing inflates every tool result by ~45%
// whitespace tokens the model does not need.
const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/** The three window tools exist only on a hosted transport, so a stdio client
 *  must not be promised tools its server never registers. */
const WINDOW_TOOL_INSTRUCTIONS =
  "Three tools reach the desktop window and answer with a reason when none " +
  "is connected: open_in_app " +
  "replaces the design in the editor (confirm with the user first), " +
  "get_current_design reads it back including the user's own edits, and " +
  "raster_image turns a data: URL into a placeable 1-bit graphic.";

/** Workflow recipe the host injects at initialize, so a session starts
 *  pre-trained instead of discovering it by trial. */
export const SERVER_INSTRUCTIONS =
  "ZPLab builds Zebra ZPL label designs. Call get_schema first to learn the " +
  "object types and their props. Build a label with create_draft (x/y in dots " +
  "from the top-left origin; props merge over defaults), then read the returned " +
  "warnings, bounds, and overlaps and iterate until nothing unintended remains. " +
  "Values that differ per printed label belong in `variables`, referenced from " +
  "content as «name», so one design serves many rows. " +
  "Bounds marked approx are estimates (unrendered content, marker substitution, " +
  "unencodable payloads): keep extra " +
  "clearance around those. Overlaps are neutral facts, not errors: a frame or " +
  "reverse box overlaps its contents by design. Bring existing ZPL through " +
  "import_zpl (editable design file) or validate_zpl (lint only). Editing an " +
  "existing design goes through patch_design rather than a rebuild, so nothing " +
  "the user made is lost. export_zpl returns the final ZPL.";

/** Single tool definition shared by the stdio and HTTP entry points. */
export function buildServer(options: BuildServerOptions = {}): McpServer {
  registerSidecarFootprintMeasurer();
  // Display identity the MCP client shows; matches the config-snippet key.
  const server = new McpServer(
    { name: "zplab", version: "0.0.0" },
    {
      instructions:
        options.hosted === true
          ? `${SERVER_INSTRUCTIONS} ${WINDOW_TOOL_INSTRUCTIONS}`
          : SERVER_INSTRUCTIONS,
    },
  );

  registerPrompts(server, options.hosted === true);

  server.registerTool(
    "create_draft",
    {
      title: "Create ZPLab draft",
      description:
        "Build a ZPLab label draft from a size, a list of objects and optional " +
        "variables. Returns the parseable design file, preflight warnings, " +
        "per-object bounds (dots), and bbox overlaps. Declare every value that " +
        "changes per print as a variable and reference it in content as " +
        "«name»; it becomes a ^FN slot the user can fill from a data " +
        "source. Call get_schema for object types.",
      inputSchema: createDraftShape,
    },
    async (args) => json(createDraft(args)),
  );

  server.registerTool(
    "validate_draft",
    {
      title: "Validate ZPLab draft",
      description:
        "Parse a design file and return schema errors, preflight warnings, per-object " +
        "bounds (dots), and bbox overlaps.",
      inputSchema: designFileEnvelopeSchema.shape,
    },
    async ({ designFile }) => json(validateDraft(designFile)),
  );

  server.registerTool(
    "patch_design",
    {
      title: "Edit a ZPLab design",
      description:
        "Change an existing design instead of rebuilding it: update (positions " +
        "and merged props), remove or add objects by id, and addVariable / " +
        "updateVariable / removeVariable for the design's variables (a rename " +
        "rewrites the «markers» that reference it). Ids come from any report's " +
        "bounds. Adding or removing an object or a variable, or changing a " +
        "variable's default, drops the affected pages' captured import bytes " +
        "(a note says so) and the model re-emits them; an " +
        "update keeps them and replays around the edited field. " +
        "Returns the edited design file plus fresh warnings, bounds and overlaps.",
      inputSchema: patchDesignShape,
    },
    async ({ designFile, operations }) => json(patchDesign(designFile, operations)),
  );

  server.registerTool(
    "export_zpl",
    {
      title: "Export ZPL",
      description:
        "Parse a design file and return its generated ZPL: plain printer bytes, or with " +
        "ZPLab's ^FX metadata when `metadata` is true (lossless re-import).",
      inputSchema: exportZplInputSchema.shape,
    },
    async ({ designFile, metadata }) => json(exportZpl(designFile, { metadata })),
  );

  server.registerTool(
    "validate_zpl",
    {
      title: "Validate raw ZPL",
      description:
        "Parse a raw ZPL stream (one page per ^XA block) and report it: object/page " +
        "count, detected label, parser findings (unknown/partial/hardware-bound " +
        "commands), preflight warnings, per-object bounds (dots), and bbox overlaps. " +
        "widthMm/heightMm are fallbacks for streams without ^PW/^LL.",
      inputSchema: zplInputShape,
    },
    async ({ zpl, dpmm, widthMm, heightMm }) => json(validateZpl(zpl, dpmm, widthMm, heightMm)),
  );

  server.registerTool(
    "import_zpl",
    {
      title: "Import raw ZPL",
      description:
        "Parse a raw ZPL stream into an editable design file (one page per ^XA block; " +
        "feed it to export_zpl or open_in_app) plus parser findings, per-object bounds " +
        "(dots), and bbox overlaps. Size falls back to the caller's hints then 100x50mm. " +
        "Right-justified z=1 1D barcodes (^FO/^FT) are normalised to top-left x (bwip-" +
        "measured, same as the app import) and enable the label's emit1dZJustify gate.",
      inputSchema: zplInputShape,
    },
    async ({ zpl, dpmm, widthMm, heightMm }) => json(importZpl(zpl, dpmm, widthMm, heightMm)),
  );

  server.registerTool(
    "get_schema",
    {
      title: "Get object schema",
      description: "List supported object types and their props for building a draft.",
      inputSchema: {},
    },
    async () => json(getSchema()),
  );

  // Listed whenever the transport could reach a window, not only once one has:
  // a client that connected during startup would otherwise cache a tool list it
  // never sees updated (stateless transport, so listChanged reaches nobody).
  if (options.hosted) {
    server.registerTool(
      "open_in_app",
      {
        title: "Open draft in ZPLab",
        description:
          "Push a design file into the running ZPLab desktop app and wait for the " +
          "app to confirm. This REPLACES whatever the user has open and clears " +
          "their undo history, so ask before calling it; the reply reports how " +
          "many objects were displaced.",
        inputSchema: designFileEnvelopeSchema.shape,
      },
      async ({ designFile }) => {
        if (!isAppAttached()) return json(NO_WINDOW);
        const result = openInApp(designFile);
        if (!result.ok) return json(result);
        const receipt = await requestOpenDraft(result.designFile);
        if (receipt === null) {
          // The app applies before it confirms (see OPEN_DRAFT_TIMEOUT_MS); a
          // blind retry on this null could apply the push twice.
          return json({
            ok: false,
            errors: [
              "The ZPLab app did not confirm the draft. It may still have been applied; check get_current_design before retrying.",
            ],
          });
        }
        if (!receipt.ok) return json({ ok: false, errors: [receipt.error ?? "rejected"] });
        // Opening replaces the editor's document and clears its undo history;
        // say so rather than reporting a bare success.
        return json({
          ok: true,
          replaced: { objects: receipt.replacedObjects ?? 0, undoHistoryCleared: true },
        });
      },
    );

    server.registerTool(
      "raster_image",
      {
        title: "Rasterize an image for a label",
        description:
          "Turn an image (data: URL, e.g. a logo you fetched) into a 1-bit ZPL " +
          "graphic at the given width in dots. Returns an image object to place " +
          "via create_draft or patch_design. Fetch the bytes yourself and pass " +
          "them here; the app renders them, it does not download anything.",
        inputSchema: rasterImageShape,
      },
      async ({ dataUrl, widthDots, threshold }) => {
        if (!isAppAttached()) return json(NO_WINDOW);
        const used = threshold ?? DEFAULT_RASTER_THRESHOLD;
        const response = await requestRaster(dataUrl, widthDots, used);
        if (response === null) {
          return json({ ok: false, errors: ["The ZPLab app did not answer the raster request."] });
        }
        return json(rasterImageResult(response, used));
      },
    );

    server.registerTool(
      "get_current_design",
      {
        title: "Get current ZPLab design",
        description:
          "Read the design currently open in the ZPLab desktop app: the design file " +
          "plus print-true bounds and overlaps (barcodes probed at print scale; text " +
          "and images use the app's render measurements). Only available while a " +
          "ZPLab window is connected.",
        inputSchema: {},
      },
      async () => {
        if (!isAppAttached()) return json(NO_WINDOW);
        const response = await requestCurrentDesign();
        if (response === null) {
          return json({ ok: false, errors: ["The ZPLab app did not respond."] });
        }
        return json(buildCurrentDesignResult(response));
      },
    );
  }

  return server;
}
