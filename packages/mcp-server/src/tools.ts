import { z } from "zod";
import {
  parseDesignFile,
  serializeDesign,
  designFileErrors,
  type DesignFile,
  type DesignFilePage,
} from "@zplab/core/lib/designFile";
import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { importZplText, type ZplImportResult } from "@zplab/core/lib/zplImportService";
import { measureBoundsEntry, withFootprintBinding } from "./footprint.js";
import { isBarcode } from "@zplab/core/lib/objectBounds";
import type { ImportReport } from "@zplab/core/lib/zplParser";
import { computePreflight } from "@zplab/core/lib/preflight";
import type { BoundingBoxDots, ObjectBoundsCtx } from "@zplab/core/lib/objectBounds";
import type { DesignResponse } from "./appBridge.js";
import { computeOverlaps, leafBoxesDots, MAX_OVERLAPS, type OverlapDots } from "@zplab/core/lib/objectOverlap";
import { getEntry, ObjectRegistry } from "@zplab/core/registry";
import { exportableLeaves, pageLabelConfig, type LabelObject, type Page } from "@zplab/core/types/Group";
import { effectiveDpmm, DPMM_VALUES, isDpmm, type Dpmm, type JmDensity, type LabelConfig } from "@zplab/core/types/LabelConfig";
import type { PreflightKind, PreflightSeverity } from "@zplab/core/lib/preflight";
import type { Variable } from "@zplab/core/types/Variable";

export const objectInputSchema = z.object({
  type: z.string(),
  x: z.number(),
  y: z.number(),
  id: z.string().optional(),
  // Anchor semantics: FO = top-left origin, FT = typeset baseline; fieldJustify
  // right-aligns. Omitted keeps the model default (FO / left).
  positionType: z.enum(["FO", "FT"]).optional(),
  fieldJustify: z.enum(["L", "C", "R"]).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});
export type ObjectInput = z.infer<typeof objectInputSchema>;

const dpmmSchema = z.literal([...DPMM_VALUES]);

export const createDraftShape = {
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  dpmm: dpmmSchema,
  objects: z.array(objectInputSchema),
};
export interface CreateDraftInput {
  widthMm: number;
  heightMm: number;
  dpmm: Dpmm;
  objects: ObjectInput[];
}

/** Serialised design as the tools exchange it, identical in shape to
 *  serializeDesign's output so create → validate → export round-trip.
 *  serializeDesign stamps the current schemaVersion, so it is not hardcoded. */
export interface DesignFileJson {
  schemaVersion: number;
  label: LabelConfig;
  pages: DesignFilePage[];
  // serializeDesign omits variables when empty, so this stays optional.
  variables?: Variable[];
}

export const designFileEnvelopeSchema = z.object({ designFile: z.record(z.string(), z.unknown()) });

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface ToolError {
  ok: false;
  errors: string[];
}

/** Re-checks the dpmm/dimension bounds on a parsed label: the core design-file
 *  schema is deliberately lenient (app forward-compat), so without this the
 *  envelope tools would emit broken ZPL from garbage create_draft rejects. */
function labelConfigIssues(label: LabelConfig): string[] {
  const issues: string[] = [];
  if (!isDpmm(label.dpmm)) {
    issues.push(`dpmm must be one of ${DPMM_VALUES.join(", ")} (got ${label.dpmm})`);
  }
  if (!(label.widthMm > 0)) issues.push(`widthMm must be positive (got ${label.widthMm})`);
  if (!(label.heightMm > 0)) issues.push(`heightMm must be positive (got ${label.heightMm})`);
  return issues;
}

/** Envelope size limits: the raw-ZPL tools cap the input string, so the
 *  design-file tools cap the parsed shape symmetrically to bound preflight and
 *  emit on a hostile envelope. Well beyond any real label. */
const MAX_PAGES = 1000;
const MAX_TOTAL_OBJECTS = 10000;

/** Shared by the envelope and raw-ZPL paths so both bound object/page count.
 *  Counts NODES (descending into group children): a top-level count would let
 *  one group smuggle an unbounded subtree past the cap into preflight. */
function pagesSizeError(pages: readonly { objects: readonly unknown[] }[]): ToolError | null {
  if (pages.length > MAX_PAGES) {
    return { ok: false, errors: [`design exceeds the ${MAX_PAGES}-page limit`] };
  }
  let total = 0;
  const stack: unknown[] = [];
  for (const p of pages) for (const o of p.objects) stack.push(o);
  while (stack.length > 0) {
    const node = stack.pop();
    total++;
    if (total > MAX_TOTAL_OBJECTS) {
      return { ok: false, errors: [`design exceeds the ${MAX_TOTAL_OBJECTS}-object limit`] };
    }
    const children = (node as { children?: unknown })?.children;
    if (Array.isArray(children)) for (const c of children) stack.push(c);
  }
  return null;
}

/** Parse a caller's design file into a validated DesignFile, mapping schema
 *  errors and any throw to the shared ToolError shape. */
function parseEnvelope(designFile: unknown): { ok: true; value: DesignFile } | ToolError {
  try {
    const parsed = parseDesignFile(JSON.stringify(designFile));
    if (!parsed.ok) return { ok: false, errors: [designFileErrors[parsed.error]] };
    const issues = labelConfigIssues(parsed.value.label);
    if (issues.length > 0) return { ok: false, errors: issues };
    const oversize = pagesSizeError(parsed.value.pages);
    if (oversize) return oversize;
    return { ok: true, value: parsed.value };
  } catch (e) {
    return { ok: false, errors: [errMsg(e)] };
  }
}

/** Merge a caller's sparse object over the registry defaults so an LLM only
 *  needs to supply the props it wants to change. Unknown type keeps empty
 *  defaults; the schema is tolerant, so createDraft guards it up front. */
function toLabelObject(input: ObjectInput, id: string): LabelObject {
  const defaults = getEntry(input.type)?.defaultProps ?? {};
  // 'C' has meaning only on 1D barcodes (editor centre); anywhere else it
  // would persist as dead metadata, so canonicalize it away here.
  const justify =
    input.fieldJustify === "C" && getEntry(input.type)?.barcodeClass !== "1d"
      ? undefined
      : input.fieldJustify;
  return {
    id,
    type: input.type,
    x: input.x,
    y: input.y,
    rotation: 0,
    ...(input.positionType !== undefined ? { positionType: input.positionType } : {}),
    ...(justify !== undefined ? { fieldJustify: justify } : {}),
    props: { ...defaults, ...(input.props ?? {}) },
    // Schema is intentionally loose; createDraft rejects unknown types up front.
  } as LabelObject;
}

/** Assign every object its id: reject duplicate explicit ids, and skip
 *  auto-generated ids that collide with ids already taken in this draft. */
function buildObjects(inputs: ObjectInput[]): { objects: LabelObject[] } | { error: string } {
  const explicit = inputs.flatMap((o) => (o.id !== undefined ? [o.id] : []));
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of explicit) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  if (dupes.size > 0) return { error: `Duplicate object id(s): ${[...dupes].join(", ")}` };
  const taken = new Set(explicit);
  let counter = 0;
  const objects = inputs.map((o) => {
    let id = o.id;
    if (id === undefined) {
      do {
        id = `${o.type}-${++counter}`;
      } while (taken.has(id));
      taken.add(id);
    }
    return toLabelObject(o, id);
  });
  return { objects };
}

export interface PreflightWarning {
  pageIndex: number;
  objectId: string;
  kind: PreflightKind;
  severity: PreflightSeverity;
  detail?: string;
}

interface PageLike {
  objects: LabelObject[];
  jmDensity?: JmDensity;
}

/** Run a per-page report over every page of a design. Pages with a ^JM
 *  override get their density folded into the label they are judged against. */
function perPage<T>(
  pages: PageLike[],
  label: LabelConfig,
  fn: (objects: LabelObject[], label: LabelConfig, pageIndex: number) => T[],
): T[] {
  return pages.flatMap((page, i) => fn(page.objects, pageLabelConfig(label, page), i));
}

function preflightOf(
  objects: LabelObject[],
  label: LabelConfig,
  pageIndex: number,
  measured?: ObjectBoundsCtx["measured"],
): PreflightWarning[] {
  return computePreflight(exportableLeaves(objects), { label, measured }, "mm").map((f) => ({
    pageIndex,
    objectId: f.objectId,
    kind: f.kind,
    severity: f.severity,
    ...(f.detail !== undefined ? { detail: f.detail } : {}),
  }));
}

/** Per-object geometry so the agent can reason about size/placement without
 *  recomputing it. Dots, visual top-left. `approx` marks headless estimates
 *  (single-line text, unprobed leaves); probed barcode footprints share the
 *  app's measurement kernel and report exact. */
export interface ObjectBounds extends BoundingBoxDots {
  pageIndex: number;
  objectId: string;
  approx: boolean;
}

/** Axis-aligned bbox intersections. Neutral facts, not errors: a frame/reverse
 *  box overlaps its contents by design, so the agent judges relevance. */
export interface ObjectOverlap extends OverlapDots {
  pageIndex: number;
}

interface Geometry {
  bounds: ObjectBounds[];
  overlaps: ObjectOverlap[];
  /** Set when a page was too dense to report fully (see the caps below), so the
   *  agent knows the geometry is partial rather than assuming a clean label. */
  geometryTruncated?: boolean;
}

/** Per-page object cap for geometry. The overlap scan is O(n²); past this a
 *  per-object report is noise anyway, so skip the page's geometry. Well beyond
 *  any real label. */
const MAX_GEOMETRY_OBJECTS = 2000;

/** 0.1-dot precision: parser coordinates carry float tails ("613.37336627…")
 *  that are sub-dot noise in the agent-facing payload. */
const dot1 = (n: number): number => Math.round(n * 10) / 10;
const roundRect = (r: BoundingBoxDots): BoundingBoxDots => ({
  x: dot1(r.x),
  y: dot1(r.y),
  width: dot1(r.width),
  height: dot1(r.height),
});

/** One box pass per page feeds both reports, so they cannot diverge. Bounded:
 *  dense pages skip geometry, and overlaps are capped, to keep the payload and
 *  the O(n²) scan finite on adversarial input. `measured` (app read-back)
 *  upgrades the affected boxes from estimate to render-exact. */
function geometryFor(
  pages: PageLike[],
  label: LabelConfig,
  measured?: ObjectBoundsCtx["measured"],
): Geometry {
  const bounds: ObjectBounds[] = [];
  const overlaps: ObjectOverlap[] = [];
  let truncated = false;
  pages.forEach((page, pageIndex) => {
    const leaves = exportableLeaves(page.objects);
    if (leaves.length > MAX_GEOMETRY_OBJECTS) {
      truncated = true;
      return;
    }
    const boxes = leafBoxesDots(leaves, { label: pageLabelConfig(label, page), measured });
    for (const b of boxes) {
      bounds.push({ pageIndex, objectId: b.id, ...roundRect(b.box), approx: b.approx });
    }
    // Over-scan by one so a complete set of exactly MAX_OVERLAPS is not
    // mistaken for a capped one; keep only MAX_OVERLAPS.
    const scanned = computeOverlaps(boxes, MAX_OVERLAPS + 1);
    if (scanned.length > MAX_OVERLAPS) truncated = true;
    for (const o of scanned.slice(0, MAX_OVERLAPS)) {
      overlaps.push({ ...o, pageIndex, ...roundRect(o) });
    }
  });
  return truncated ? { bounds, overlaps, geometryTruncated: true } : { bounds, overlaps };
}

export type CreateDraftResult =
  | {
      ok: true;
      designFile: DesignFileJson;
      warnings: PreflightWarning[];
      bounds: ObjectBounds[];
      overlaps: ObjectOverlap[];
      geometryTruncated?: boolean;
    }
  | ToolError;

export function createDraft(input: CreateDraftInput): CreateDraftResult {
  const tooMany = pagesSizeError([{ objects: input.objects }]);
  if (tooMany) return tooMany;
  const unknown = input.objects.filter((o) => getEntry(o.type) === undefined).map((o) => o.type);
  if (unknown.length > 0) {
    return { ok: false, errors: [`Unknown object type(s): ${[...new Set(unknown)].join(", ")}`] };
  }
  const built = buildObjects(input.objects);
  if ("error" in built) return { ok: false, errors: [built.error] };
  const label: LabelConfig = { widthMm: input.widthMm, heightMm: input.heightMm, dpmm: input.dpmm };
  const serialized = serializeDesign(label, [{ objects: built.objects }]);
  const designFile = JSON.parse(serialized) as DesignFileJson;
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    designFile,
    ...boundReport(label, parsed.value.variables, parsed.value.pages),
  };
}

export type ValidateDraftResult =
  | {
      ok: true;
      warnings: PreflightWarning[];
      bounds: ObjectBounds[];
      overlaps: ObjectOverlap[];
      geometryTruncated?: boolean;
    }
  | ToolError;

/** Probe every barcode's real bounds (the bwip kernel the app uses) so
 *  geometry reports true sizes and anchors instead of the registry's
 *  default boxes. Skips pages past the geometry cap. */
function measuredBarcodes(
  pages: PageLike[],
  label: LabelConfig,
  measured?: ObjectBoundsCtx["measured"],
): ObjectBoundsCtx["measured"] {
  const map = new Map(measured ?? []);
  for (const page of pages) {
    const leaves = exportableLeaves(page.objects);
    if (leaves.length > MAX_GEOMETRY_OBJECTS) continue;
    const dpmm = effectiveDpmm(pageLabelConfig(label, page));
    for (const leaf of leaves) {
      if (!isBarcode(leaf) || map.has(leaf.id)) continue;
      const entry = measureBoundsEntry(leaf, dpmm);
      if (entry) map.set(leaf.id, entry);
    }
  }
  return map;
}

/** Preflight + geometry with markers resolved against the design's own
 *  bindings; the one report block every design-shaped tool returns. */
function boundReport(
  label: LabelConfig,
  variables: readonly Variable[],
  pages: Page[],
  measured?: ObjectBoundsCtx["measured"],
) {
  return withFootprintBinding(label, variables, () => {
    // One probe pass for both consumers, or the off-label check would judge
    // clipping with unprobed default boxes while bounds report real sizes.
    const probed = measuredBarcodes(pages, label, measured);
    return {
      warnings: perPage(pages, label, (objects, pageLabel, i) =>
        preflightOf(objects, pageLabel, i, probed)),
      ...geometryFor(pages, label, probed),
    };
  });
}

export function validateDraft(designFile: unknown): ValidateDraftResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const { label, pages, variables } = parsed.value;
  return { ok: true, ...boundReport(label, variables, pages) };
}

export type GetCurrentDesignResult =
  | {
      ok: true;
      designFile: DesignFileJson;
      warnings: PreflightWarning[];
      bounds: ObjectBounds[];
      overlaps: ObjectOverlap[];
      geometryTruncated?: boolean;
    }
  | ToolError;

/** Turn the app's read-back (design + render-measured footprints) into the
 *  standard tool report; measured footprints make the bounds render-exact. */
export function buildCurrentDesignResult(response: DesignResponse): GetCurrentDesignResult {
  const parsed = parseEnvelope(response.designFile);
  if (!parsed.ok) return parsed;
  const { label, pages, variables } = parsed.value;
  const measured = response.measured ? new Map(Object.entries(response.measured)) : undefined;
  return {
    ok: true,
    designFile: response.designFile as unknown as DesignFileJson,
    ...boundReport(label, variables, pages, measured),
  };
}

export type OpenInAppResult = { ok: true; line: string } | ToolError;

/** Validate the design file and, on success, build the newline-delimited event
 *  line the desktop app reads off this child's stdout to open the draft. */
export function openInApp(designFile: unknown): OpenInAppResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  return { ok: true, line: JSON.stringify({ zplabEvent: "openDraft", designFile }) };
}

export type ExportZplResult = { ok: true; zpl: string } | ToolError;

export function exportZpl(designFile: unknown): ExportZplResult {
  const parsed = parseEnvelope(designFile);
  if (!parsed.ok) return parsed;
  const { label, pages, variables } = parsed.value;
  // Same path as the app's export: per-page emit replays captured overlays.
  return {
    ok: true,
    zpl: withFootprintBinding(label, variables, () => generateMultiPageZPL(label, pages, variables)),
  };
}

// ── Raw-ZPL input: parse a ZPL stream back into the editable model, so the
//    agent can bring/write ZPL and get it validated + turned into a draft.

/** Label size a raw ZPL stream that omits ^PW/^LL falls back to. */
const DEFAULT_WIDTH_MM = 100;
const DEFAULT_HEIGHT_MM = 50;

/** Byte budget for a raw ZPL stream. Import retains overlay bytes and
 *  re-serializes, so an oversized stream costs several copies plus O(n²)
 *  geometry; real labels are far under this. */
const MAX_ZPL_BYTES = 256 * 1024;

function oversizeError(zpl: string): ToolError | null {
  // Byte length, not zpl.length: multibyte ^FD content is up to ~4x the code
  // unit count, which would slip past the memory budget the cap protects.
  return Buffer.byteLength(zpl, "utf8") > MAX_ZPL_BYTES
    ? { ok: false, errors: [`ZPL exceeds the ${MAX_ZPL_BYTES}-byte limit`] }
    : null;
}

/** Reject a parsed stream the single-label draft model can't represent:
 *  divergent per-block ^PW/^LL or ^JM, or too many objects/pages. */
function importRejection(imported: ZplImportResult): ToolError | null {
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
      warnings: PreflightWarning[];
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
    ...boundReport(label, imported.variables, imported.pages),
  };
}

/** Hand-written prop summaries for the types an LLM reaches for first. Every
 *  other registered type is listed by name + defaults from the registry. */
const PROP_SUMMARIES: Record<string, Record<string, string>> = {
  text: {
    content: "string, the printed text",
    fontHeight: "dots, glyph height",
    fontWidth: "dots, 0 = auto from height",
    rotation: "N | R | I | B (0/90/180/270)",
    reverse: "boolean, white-on-black knockout (^FR; needs a dark shape behind)",
  },
  code128: {
    content: "string payload",
    height: "bar height in dots",
    moduleWidth: "narrow-bar width in dots",
    printInterpretation: "boolean, show human-readable text",
    checkDigit: "boolean",
    rotation: "N | R | I | B",
    gs1: "boolean, GS1-128 mode",
  },
  qrcode: {
    content: "string payload",
    magnification: "module size 1-10",
    errorCorrection: "L | M | Q | H",
    model: "1 | 2",
    rotation: "N | R | I | B",
  },
  box: {
    width: "dots",
    height: "dots",
    thickness: "border dots",
    filled: "boolean",
    color: "B | W",
    rounding: "corner rounding 0-8",
  },
  line: {
    angle: "degrees",
    length: "dots",
    thickness: "dots",
    color: "B | W",
  },
  ean13: {
    content: "12 digits (check digit computed)",
    height: "bar height in dots",
    printInterpretation: "boolean",
    rotation: "N | R | I | B",
  },
  datamatrix: {
    content: "string payload",
    dimension: "module size",
    quality: "ECC level (200 = ECC200)",
    rotation: "N | R | I | B",
    gs1: "boolean, GS1 mode",
  },
};

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
    "rest are described by their defaultProps.",
  objectShape: {
    type: "one of the registered types below",
    x: "number, dots from left",
    y: "number, dots from top",
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
