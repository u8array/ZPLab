import { z } from "zod";
import {
  serializeDesign,
} from "@zplab/core/lib/designFile";
import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { zplForExport } from "@zplab/core/lib/zplLabelMeta";
import { importZplText, type ZplImportResult } from "@zplab/core/lib/zplImportService";
import {
  withFootprintBinding,
} from "./footprint.js";
import type { ImportReport } from "@zplab/core/lib/zplParser";
import type { DesignResponse, RasterResponse } from "./appBridge.js";
import { ObjectRegistry } from "@zplab/core/registry";
import { DPMM_VALUES, type Dpmm, type LabelConfig } from "@zplab/core/types/LabelConfig";


export * from "./boundary.js";
export * from "./report.js";
export * from "./patchOps.js";
import { buildObjects, buildVariables, pagesSizeError, parseEnvelope, typeIssues, unknownPropNotes, propIssues, type DesignFileJson, type ToolError, type CreateDraftInput, PROP_SUMMARIES } from "./boundary.js";
import { boundReport, warningReport, type ObjectBounds, type ObjectOverlap, type PreflightWarning } from "./report.js";

export type CreateDraftResult =
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


export function createDraft(input: CreateDraftInput): CreateDraftResult {
  const tooMany = pagesSizeError([{ objects: input.objects }]);
  if (tooMany) return tooMany;
  const errors = [
    ...typeIssues(input.objects.map((o) => o.type)),
    ...input.objects.flatMap((o) => propIssues(o.type, o.props)),
  ];
  if (errors.length > 0) return { ok: false, errors };
  const label: LabelConfig = { widthMm: input.widthMm, heightMm: input.heightMm, dpmm: input.dpmm };
  const built = buildObjects(input.objects, label);
  if ("error" in built) return { ok: false, errors: [built.error] };
  const variables = buildVariables(input.variables ?? []);
  if ("error" in variables) return { ok: false, errors: [variables.error] };
  const serialized = serializeDesign(label, [{ objects: built.objects }], variables.value);
  const designFile = JSON.parse(serialized) as DesignFileJson;
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const report = boundReport(label, parsed.value.variables, parsed.value.pages);
  const notes = [
    ...built.objects.flatMap((o, i) => unknownPropNotes(o.type, o.id, input.objects[i]?.props)),
    ...(report.notes ?? []),
  ];
  return { ok: true, designFile, ...report, ...(notes.length > 0 ? { notes } : {}) };
}

export type ValidateDraftResult =
  | {
      ok: true;
      warnings: PreflightWarning[];
      notes?: string[];
      bounds: ObjectBounds[];
      overlaps: ObjectOverlap[];
      geometryTruncated?: boolean;
    }
  | ToolError;

export function validateDraft(designFile: unknown): ValidateDraftResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const { label, pages, variables } = parsed.value;
  return { ok: true, ...boundReport(label, variables, pages, undefined, parsed.value.columnMapping !== null) };
}

export type GetCurrentDesignResult =
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

/** Turn the app's read-back (design + render-measured footprints) into the
 *  standard tool report. Barcodes are re-probed print-true (the app's number
 *  is its zoom view); the other measurements make text/images render-exact. */
export function buildCurrentDesignResult(response: DesignResponse): GetCurrentDesignResult {
  const parsed = parseEnvelope(response.designFile);
  if (!parsed.ok) return parsed;
  const { label, pages, variables } = parsed.value;
  const measured = response.measured ? new Map(Object.entries(response.measured)) : undefined;
  return {
    ok: true,
    designFile: response.designFile as unknown as DesignFileJson,
    ...boundReport(label, variables, pages, measured, parsed.value.columnMapping !== null),
  };
}

/** A data URL keeps the fetch on the agent's side: the app only ever renders
 *  bytes it was handed, so no tool call reaches into the network or the disk. */
export const rasterImageShape = {
  dataUrl: z.string().startsWith("data:"),
  widthDots: z.number().int().positive().max(4000),
  threshold: z.number().int().min(0).max(255).optional(),
};

export type RasterImageResult =
  | { ok: true; object: { type: "image"; props: Record<string, unknown> } }
  | ToolError;

/** Shape the raster into the image object create_draft and patch_design take. */
export function rasterImageResult(response: RasterResponse, threshold: number): RasterImageResult {
  if (!response.ok || !response.gfa || response.widthDots === undefined) {
    return { ok: false, errors: [response.error ?? "The image could not be rasterized."] };
  }
  return {
    ok: true,
    object: {
      type: "image",
      props: {
        imageId: "",
        widthDots: response.widthDots,
        ...(response.heightDots !== undefined ? { heightDots: response.heightDots } : {}),
        threshold,
        rotation: "N",
        _gfaCache: response.gfa,
      },
    },
  };
}

export type OpenInAppResult = { ok: true; designFile: unknown } | ToolError;

/** Validate the design file the app is asked to open; the bridge owns the
 *  event line and its receipt. Forwards the PARSED design re-serialized, not
 *  the raw object: a sparse envelope would emit NaN slots on load, and a migrated file must not re-migrate under its old schemaVersion. */
export function openInApp(designFile: unknown): OpenInAppResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  return {
    ok: true,
    designFile: JSON.parse(
      serializeDesign(v.label, v.pages, v.variables, v.columnMapping, v.dataSource),
    ) as unknown,
  };
}

export type ExportZplResult =
  | { ok: true; zpl: string; warnings: PreflightWarning[]; notes?: string[] }
  | ToolError;

/** The ZPL plus the warnings that apply to it: an agent that exports straight
 *  from a design it did not build itself would otherwise never see them. */
export function exportZpl(designFile: unknown, opts: { metadata?: boolean } = {}): ExportZplResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const { label, pages, variables } = parsed.value;
  // Same report the draft tools give, dataset caveat included: an empty warning
  // list read as a clean bill of health is worst right before printing.
  const report = warningReport(label, variables, pages, parsed.value.columnMapping !== null);
  // Same path as the app's export: per-page emit replays captured overlays.
  const zpl = withFootprintBinding(label, variables, () => generateMultiPageZPL(label, pages, variables));
  return {
    ok: true,
    zpl: zplForExport(zpl, opts.metadata),
    warnings: report.warnings,
    ...(report.notes && report.notes.length > 0 ? { notes: report.notes } : {}),
  };
}

// ── Raw-ZPL input: parse a ZPL stream back into the editable model, so the
//    agent can bring/write ZPL and get it validated + turned into a draft.

/** Label size a raw ZPL stream that omits ^PW/^LL falls back to. */
const DEFAULT_WIDTH_MM = 100;
const DEFAULT_HEIGHT_MM = 50;

/** Size budget (UTF-16 code units) for a raw ZPL stream. Import retains
 *  overlay bytes and re-serializes, so an oversized stream costs several
 *  copies plus O(n²) geometry; real labels are far under this. */
const MAX_ZPL_CHARS = 256 * 1024;

function oversizeError(zpl: string): ToolError | null {
  // Code units, not UTF-8 bytes: cost scales with units, and byteLength
  // would double-count byte-per-char binary payloads.
  return zpl.length > MAX_ZPL_CHARS
    ? { ok: false, errors: [`ZPL exceeds the ${MAX_ZPL_CHARS}-character limit`] }
    : null;
}

/** Reject a parsed stream the single-label draft model can't represent:
 *  unbalanced ^XA/^XZ, divergent per-block ^PW/^LL or ^JM, too many
 *  objects/pages, or nothing at all (a bare stream would otherwise pass as an
 *  empty design and fail much later). */
function importRejection(imported: ZplImportResult): ToolError | null {
  if (imported.unbalanced) {
    return {
      ok: false,
      errors: ["The stream's ^XA/^XZ do not balance; an unterminated format never prints."],
    };
  }
  if (imported.pages.length === 0) {
    return { ok: false, errors: ["No ZPL label found; a label block runs from ^XA to ^XZ."] };
  }
  if (imported.mixedPageGeometry) {
    const geo = imported.report.findings.filter((f) => f.kind === "mixedPageGeometry");
    const hasJm = geo.some((f) => f.cause === "jm");
    const hasSize = geo.some((f) => f.cause === "size");
    const cause =
      hasJm && !hasSize
        ? "set different ^JM density modes"
        : hasSize && !hasJm
          ? "set different ^PW/^LL sizes"
          : "set different ^PW/^LL sizes or ^JM density modes";
    return {
      ok: false,
      errors: [
        `^XA blocks ${cause}, which a single-label draft cannot represent; ` +
          "split the stream into one label per block.",
      ],
    };
  }
  return pagesSizeError(imported.pages);
}

export const zplInputShape = {
  zpl: z.string(),
  dpmm: z.optional(z.literal([...DPMM_VALUES])),
  widthMm: z.optional(z.number().positive()),
  heightMm: z.optional(z.number().positive()),
};

/** The report's deduped command buckets, so the agent learns which commands
 *  were dropped, lossy, or hardware-bound. Drops the per-occurrence findings
 *  (an app-UI navigation aid). */
export type ZplFindings = Omit<ImportReport, "findings">;

const findingsOf = ({ findings: _drop, ...buckets }: ImportReport): ZplFindings => buckets;

/** Complete the parsed (partial) label: the stream's own dpmm/size wins, then
 *  the caller's hints, then the fallback size. */
function completeLabel(
  parsed: Partial<LabelConfig>,
  dpmm: Dpmm,
  widthMm?: number,
  heightMm?: number,
): LabelConfig {
  return {
    ...parsed,
    dpmm: parsed.dpmm ?? dpmm,
    widthMm: parsed.widthMm ?? widthMm ?? DEFAULT_WIDTH_MM,
    heightMm: parsed.heightMm ?? heightMm ?? DEFAULT_HEIGHT_MM,
  };
}

export type ValidateZplResult =
  | {
      ok: true;
      objectCount: number;
      pageCount: number;
      label: LabelConfig;
      findings: ZplFindings;
      warnings: PreflightWarning[];
      notes?: string[];
      bounds: ObjectBounds[];
      overlaps: ObjectOverlap[];
      geometryTruncated?: boolean;
    }
  | ToolError;

/** Parse raw ZPL and report it: how many objects/pages came back, the detected
 *  label, the parser's findings, and preflight warnings. A lint pass, not a
 *  draft. Shares the app's import path, so multi-^XA streams report per page. */
export function validateZpl(
  zpl: string,
  dpmm: Dpmm = 8,
  widthMm?: number,
  heightMm?: number,
): ValidateZplResult {
  const oversize = oversizeError(zpl);
  if (oversize) return oversize;
  const imported = importZplText(zpl, dpmm);
  const rejected = importRejection(imported);
  if (rejected) return rejected;
  const label = completeLabel(imported.labelConfig, dpmm, widthMm, heightMm);
  return {
    ok: true,
    objectCount: imported.pages.reduce((n, p) => n + p.objects.length, 0),
    pageCount: imported.pages.length,
    label,
    findings: findingsOf(imported.report),
    ...boundReport(label, imported.variables, imported.pages),
  };
}

export type ImportZplResult =
  | {
      ok: true;
      designFile: DesignFileJson;
      findings: ZplFindings;
      /** What the stream itself declared, after the caller's hints and the
       *  fallback size: ^PW/^LL win, so the result is worth reading back. */
      label: LabelConfig;
      warnings: PreflightWarning[];
      notes?: string[];
      bounds: ObjectBounds[];
      overlaps: ObjectOverlap[];
      geometryTruncated?: boolean;
    }
  | ToolError;

/** Parse raw ZPL into an editable design file (ready for export_zpl/open_in_app)
 *  plus the parser's findings. Shares the app's import path: one page per ^XA
 *  block, captured overlays so re-export replays unmodeled commands verbatim. */
export function importZpl(
  zpl: string,
  dpmm: Dpmm = 8,
  widthMm?: number,
  heightMm?: number,
): ImportZplResult {
  const oversize = oversizeError(zpl);
  if (oversize) return oversize;
  const imported = importZplText(zpl, dpmm);
  const rejected = importRejection(imported);
  if (rejected) return rejected;
  const label = completeLabel(imported.labelConfig, dpmm, widthMm, heightMm);
  const serialized = serializeDesign(label, imported.pages, imported.variables);
  return {
    ok: true,
    designFile: JSON.parse(serialized) as DesignFileJson,
    findings: findingsOf(imported.report),
    label,
    ...boundReport(label, imported.variables, imported.pages),
  };
}


export interface SchemaObjectType {
  type: string;
  label: string;
  defaultProps: Record<string, unknown>;
  props?: Record<string, string>;
}

export interface SchemaResult {
  note: string;
  objectShape: Record<string, string>;
  types: SchemaObjectType[];
}

const SCHEMA: SchemaResult = {
  note:
    "Each object needs { type, x, y, props }. x/y are dots from the label origin; " +
    "id is optional. Props merge over the type's defaultProps, so only supply " +
    "overrides. Leaf orientation is props.rotation (N | R | I | B for 0/90/180/270), " +
    "not a top-level field. Documented prop summaries cover the common types; the " +
    "rest are described by their defaultProps. Anything that changes per printed " +
    "label belongs in create_draft's `variables` and is referenced from content " +
    "as «name», which emits a ^FN slot the user fills from a data source. " +
    "Reported bounds are the printed ink box, so they can sit a few dots off the " +
    "^FO the object emits (baseline and quiet-zone compensation). On a " +
    "right-justified (fieldJustify 'R') text, symbol or 2D field the object's " +
    "own x is the printed RIGHT edge, a full box width from the reported " +
    "bounds.x: patch that x, not the reported one. `notes` in a " +
    "report are remarks about the call itself: props that go nowhere, markers " +
    "that bind nothing.",
  objectShape: {
    type: "one of the registered types below",
    x: "number, dots from left",
    y: "number, dots from top (text: top of the glyph box)",
    id: "optional; supply one to address the object in patch_design later",
    positionType: "optional FO (top-left origin, default) | FT (typeset baseline)",
    fieldJustify: "optional L (default) | R | C (centre; 1D barcodes only, dropped elsewhere). On non-1D fields R means x IS the ZPL right-edge anchor and re-emits as z=1; on 1D barcodes x stays the top-left and the editor re-pins on value changes",
    props: "object, merged over defaultProps",
  },
  types: (Object.keys(ObjectRegistry) as (keyof typeof ObjectRegistry)[]).map((type) => {
    const entry = ObjectRegistry[type];
    const out: SchemaObjectType = {
      type: String(type),
      label: entry.label,
      defaultProps: entry.defaultProps as Record<string, unknown>,
    };
    const summary = PROP_SUMMARIES[String(type)];
    if (summary) out.props = summary;
    return out;
  }),
};

export function getSchema(): SchemaResult {
  return SCHEMA;
}
