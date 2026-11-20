import { describePropDomain, type PropSpec } from "@zplab/core/types/propSpec";
import { z } from "zod";
import {
  serializeDesign,
} from "@zplab/core/lib/designFile";
import { generateBatchZpl, generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { contestedFormatKeys, recallOnlyPath } from "@zplab/core/lib/storedFormat";
import { pageLabelConfig } from "@zplab/core/types/Group";
import { boundColumnIndex } from "@zplab/core/lib/variableBinding";
import { isRecallableFormatPath, parseStoragePath, recallKeys, storageKey } from "@zplab/core/lib/storagePath";
import { zplForExport } from "@zplab/core/lib/zplLabelMeta";
import { importZplText, type ZplImportResult } from "@zplab/core/lib/zplImportService";
import { withFootprintBinding, withHeadlessMeasurer } from "./footprint.js";
import type { ImportReport } from "@zplab/core/lib/zplParser";
import { ObjectRegistry } from "@zplab/core/registry";
import type { Dpmm, LabelConfig } from "@zplab/core/types/LabelConfig";

import { buildObjects, buildVariables, dpmmSchema, pagesSizeError, parseEnvelope, typeIssues, unknownPropNotes, propIssues, type DesignFileJson, type ToolError, type CreateDraftInput, PROP_SUMMARIES } from "./boundary.js";
import { boundReport, warningReport } from "./report.js";
import type {
  designReportSchema,
  exportZplReportSchema,
  importZplReportSchema,
  schemaResultSchema,
  validateDraftReportSchema,
  validateZplReportSchema,
  ZplFindings,
} from "./results.js";

export type CreateDraftResult = z.infer<typeof designReportSchema> | ToolError;


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
  const page = input.storedFormatPath === undefined ? { objects: built.objects } : { objects: built.objects, storedFormatPath: input.storedFormatPath };
  const serialized = serializeDesign(label, [page], variables.value);
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

export type ValidateDraftResult = z.infer<typeof validateDraftReportSchema> | ToolError;

export function validateDraft(designFile: unknown): ValidateDraftResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const { label, pages, variables } = parsed.value;
  return { ok: true, ...boundReport(label, variables, pages, undefined, parsed.value.columnMapping !== null) };
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

export type ExportZplResult = z.infer<typeof exportZplReportSchema> | ToolError;

/** The ZPL plus the warnings that apply to it: an agent that exports straight
 *  from a design it did not build itself would otherwise never see them. */
export function exportZpl(
  designFile: unknown,
  opts: { metadata?: boolean; batch?: { headers: string[]; rows: string[][]; formatPath?: string } } = {},
): ExportZplResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const { label, pages, variables, columnMapping } = parsed.value;
  // A batch recalls one page: the one its formatPath names, else the one stored as a format, else the only page.
  const named = opts.batch?.formatPath;
  const namedRef = named === undefined ? undefined : isRecallableFormatPath(named) ? parseStoragePath(named) : null;
  if (named !== undefined && !namedRef) return { ok: false, errors: ["batch.formatPath is not a name ^XF could recall"] };
  const namedKeys = named === undefined ? undefined : recallKeys(named);
  const stored = pages.filter((p) => p.storedFormatPath !== undefined && (namedKeys === undefined || namedKeys.includes(storageKey(p.storedFormatPath))));
  const page = stored.length === 1 ? stored[0] : stored.length === 0 && named === undefined && pages.length === 1 ? pages[0] : undefined;
  if (opts.batch && !page) return { ok: false, errors: ["batch needs the page its formatPath names, exactly one page with storedFormatPath, or a single-page design"] };
  if (opts.batch && opts.batch.rows.length === 0) return { ok: false, errors: ["batch has no rows, so nothing would print"] };
  if (opts.batch && opts.batch.rows.some((row) => row.length !== opts.batch?.headers.length)) {
    return { ok: false, errors: ["batch rows must have one value per header"] };
  }
  if (opts.batch && !variables.some((v) => boundColumnIndex(v, opts.batch ?? null, columnMapping) !== -1)) {
    return { ok: false, errors: ["batch binds no variable: the design file's csvMapping must map variables to the batch headers"] };
  }
  const printed = opts.batch && page ? [page] : pages;
  // Same report the draft tools give, dataset caveat included: an empty warning
  // list read as a clean bill of health is worst right before printing.
  const report = warningReport(label, variables, printed, columnMapping !== null);
  // Same paths as the app's exports: per-page emit replays captured overlays.
  const zpl = withFootprintBinding(label, variables, () =>
    opts.batch && columnMapping && page
      ? generateBatchZpl(pageLabelConfig(label, page), page.objects, variables, opts.batch, columnMapping)
      : generateMultiPageZPL(label, pages, variables),
  );
  const notes = [
    ...(report.notes ?? []),
    ...(opts.batch && page && pages.length > 1 ? [`batch printed page ${pages.indexOf(page) + 1} of ${pages.length}; the other pages are not in the ZPL`] : []),
    ...printed.flatMap((p) => {
      const path = recallOnlyPath(p);
      return path === undefined
        ? []
        : [
            `page ${pages.indexOf(p) + 1} recalls ${path} with data only; ${p.storedFormatDelivery === "setup" ? "the setup script stores the format" : "the format must already be on the printer"}`,
            ...(contestedFormatKeys(pages).has(storageKey(path)) ? [`other pages also store a format under ${path}; the printer keeps one format per name, so the recall may print another page`] : []),
          ];
    }),
  ];
  return {
    ok: true,
    zpl: zplForExport(zpl, opts.metadata),
    warnings: report.warnings,
    ...(notes.length > 0 ? { notes } : {}),
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
  dpmm: z.optional(dpmmSchema),
  widthMm: z.optional(z.number().positive()),
  heightMm: z.optional(z.number().positive()),
};

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

function importForTool(
  zpl: string,
  dpmm: Dpmm,
  widthMm?: number,
  heightMm?: number,
): { ok: true; imported: ZplImportResult; label: LabelConfig } | ToolError {
  const oversize = oversizeError(zpl);
  if (oversize) return oversize;
  const imported = withHeadlessMeasurer(() => importZplText(zpl, dpmm));
  const rejected = importRejection(imported);
  if (rejected) return rejected;
  return { ok: true, imported, label: completeLabel(imported.labelConfig, dpmm, widthMm, heightMm) };
}

export type ValidateZplResult = z.infer<typeof validateZplReportSchema> | ToolError;

/** Parse raw ZPL and report it: how many objects/pages came back, the detected
 *  label, the parser's findings, and preflight warnings. A lint pass, not a
 *  draft. Shares the app's import path, so multi-^XA streams report per page. */
export function validateZpl(
  zpl: string,
  dpmm: Dpmm = 8,
  widthMm?: number,
  heightMm?: number,
): ValidateZplResult {
  const parsed = importForTool(zpl, dpmm, widthMm, heightMm);
  if (!parsed.ok) return parsed;
  const { imported, label } = parsed;
  return {
    ok: true,
    objectCount: imported.pages.reduce((n, p) => n + p.objects.length, 0),
    pageCount: imported.pages.length,
    label,
    ...(imported.batch ? { batch: { headers: imported.batch.dataset.headers, rowCount: imported.batch.dataset.rows.length } } : {}),
    findings: findingsOf(imported.report),
    ...boundReport(label, imported.variables, imported.pages),
  };
}

export type ImportZplResult = z.infer<typeof importZplReportSchema> | ToolError;

/** Parse raw ZPL into an editable design file (ready for export_zpl/open_in_app)
 *  plus the parser's findings. Shares the app's import path: one page per ^XA
 *  block, captured overlays so re-export replays unmodeled commands verbatim. */
export function importZpl(
  zpl: string,
  dpmm: Dpmm = 8,
  widthMm?: number,
  heightMm?: number,
): ImportZplResult {
  const parsed = importForTool(zpl, dpmm, widthMm, heightMm);
  if (!parsed.ok) return parsed;
  const { imported, label } = parsed;
  const serialized = serializeDesign(label, imported.pages, imported.variables, imported.batch?.columnMapping ?? null);
  return {
    ok: true,
    designFile: JSON.parse(serialized) as DesignFileJson,
    ...(imported.batch ? { batch: { headers: imported.batch.dataset.headers, rows: imported.batch.dataset.rows, ...(imported.batch.dataset.source.kind === "zpl" ? { formatPath: imported.batch.dataset.source.formatPath } : {}) } } : {}),
    findings: findingsOf(imported.report),
    label,
    ...boundReport(label, imported.variables, imported.pages),
  };
}


export type SchemaResult = z.infer<typeof schemaResultSchema>;

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
    const out: SchemaResult["types"][number] = {
      type: String(type),
      label: entry.label,
      defaultProps: entry.defaultProps as Record<string, unknown>,
    };
    const summary = PROP_SUMMARIES[String(type)];
    if (summary) out.props = summary;
    const domains = Object.entries(entry.propSpecs as Record<string, PropSpec>).flatMap(([key, spec]) => {
      const text = describePropDomain(spec);
      return text ? [[key, text] as const] : [];
    });
    if (domains.length > 0) out.domains = Object.fromEntries(domains);
    return out;
  }),
};

export function getSchema(): SchemaResult {
  return SCHEMA;
}
