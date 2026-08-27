// Input validation at the tool boundary: schemas, prop/type checks, and the
// envelope every design-shaped tool parses first.

import { z } from "zod";
import {
  parseDesignFile,
  designFileErrors,
  type DesignFile,
  type DesignFilePage,
} from "@zplab/core/lib/designFile";
import { getEntry, ObjectRegistry } from "@zplab/core/registry";
import { gfShipsSafely, parseGfHeader } from "@zplab/core/registry/image";
import { isZplRotation } from "@zplab/core/registry/rotation";
import { isQrByHeight } from "@zplab/core/lib/qrBy";
import { ZPL_PARAM_CHARS } from "@zplab/core/lib/zplParams";
import { MAX_SOURCE_PAGES } from "@zplab/core/lib/zplSourceEdit";
import {
  getAllLeaves,
  isGroup,
  walkObjects,
  type LabelObject,
} from "@zplab/core/types/Group";
import { NON_EMITTING_PROP_KEYS } from "@zplab/core/types/LabelObject";
import { errorMessage } from "@zplab/core/lib/errorMessage";
import { DPMM_VALUES, isDpmm, type DeviceFontLabel, type Dpmm, type LabelConfig } from "@zplab/core/types/LabelConfig";
import {
  FN_NUMBER_MAX,
  FN_NUMBER_MIN,
  isValidVariableName,
  nextFreeFnNumber,
  stripMarkerDelimiters,
  type Variable,
} from "@zplab/core/types/Variable";


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

/** A reusable slot: content referencing it as `«name»` emits ^FN, so the
 *  same design prints many rows. Slot numbers are assigned when omitted. */
export const variableInputSchema = z.object({
  name: z.string().min(1),
  defaultValue: z.string().optional(),
  fnNumber: z.number().int().optional(),
  comment: z.string().optional(),
});
export type VariableInputJson = z.infer<typeof variableInputSchema>;

export const createDraftShape = {
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  dpmm: dpmmSchema,
  objects: z.array(objectInputSchema),
  variables: z.array(variableInputSchema).optional(),
};
export interface CreateDraftInput {
  widthMm: number;
  heightMm: number;
  dpmm: Dpmm;
  objects: ObjectInput[];
  variables?: VariableInputJson[];
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
 *  emit on an oversized envelope. Well beyond any real label. The page cap is
 *  the source editor's, one number for one question. */
const MAX_PAGES = MAX_SOURCE_PAGES;
const MAX_TOTAL_OBJECTS = 10000;
const MAX_GROUP_DEPTH = 64;

/** Counts NODES, descending into group children: a top-level count would let
 *  one group carry an unbounded subtree past the cap into preflight. */
export function pagesSizeError(pages: readonly { objects: readonly unknown[] }[]): ToolError | null {
  if (pages.length > MAX_PAGES) {
    return { ok: false, errors: [`design exceeds the ${MAX_PAGES}-page limit`] };
  }
  let total = 0;
  const stack: [unknown, number][] = [];
  for (const p of pages) for (const o of p.objects) stack.push([o, 1]);
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const [node, depth] = next;
    total++;
    if (total > MAX_TOTAL_OBJECTS) {
      return { ok: false, errors: [`design exceeds the ${MAX_TOTAL_OBJECTS}-object limit`] };
    }
    // This iterative walk is the gate for every recursive one after it, which
    // would otherwise answer a deep chain with a bare stack overflow.
    if (depth > MAX_GROUP_DEPTH) {
      return { ok: false, errors: [`design exceeds the ${MAX_GROUP_DEPTH}-level group nesting limit`] };
    }
    const children = (node as { children?: unknown })?.children;
    if (Array.isArray(children)) for (const c of children) stack.push([c, depth + 1]);
  }
  return null;
}

/** Every producer keeps ids design-unique (editor/parser: UUIDs; the draft
 *  tools: takenIds), and patch_design resolves by id alone: a duplicate would
 *  make one copy unreachable and silently edit the other. */
function duplicateIdError(pages: readonly DesignFilePage[]): ToolError | null {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const p of pages) {
    for (const o of walkObjects(p.objects as LabelObject[])) {
      if (seen.has(o.id)) dupes.add(o.id);
      seen.add(o.id);
    }
  }
  return dupes.size > 0
    ? { ok: false, errors: [`Duplicate object id(s): ${[...dupes].join(", ")}`] }
    : null;
}

/** Variables must stay individually addressable: a duplicate id or ^FN slot
 *  silently merges two fields. Names are excluded: they have a per-path policy
 *  instead (parse renames via sanitiseVariableNames, buildVariables refuses). */
export function duplicateVariableError(variables: readonly Variable[]): ToolError | null {
  const dup = (key: (v: Variable) => string | number) => {
    const all = variables.map(key);
    return all.find((k, i) => all.indexOf(k) !== i);
  };
  const id = dup((v) => v.id);
  if (id !== undefined) return { ok: false, errors: [`Duplicate variable id: ${id}`] };
  const slot = dup((v) => v.fnNumber);
  if (slot !== undefined) return { ok: false, errors: [`Duplicate ^FN slot: ${slot}`] };
  return null;
}

export function parseEnvelope(designFile: unknown): { ok: true; value: DesignFile } | ToolError {
  try {
    const parsed = parseDesignFile(JSON.stringify(designFile));
    if (!parsed.ok) return { ok: false, errors: [designFileErrors[parsed.error]] };
    const issues = labelConfigIssues(parsed.value.label);
    if (issues.length > 0) return { ok: false, errors: issues };
    const oversize = pagesSizeError(parsed.value.pages);
    if (oversize) return oversize;
    const dupes = duplicateIdError(parsed.value.pages);
    if (dupes) return dupes;
    const dupVars = duplicateVariableError(parsed.value.variables ?? []);
    if (dupVars) return dupVars;
    // Also checked here, not only where objects are built: export_zpl, validate_draft
    // and open_in_app share this shape. Every leaf, not only exportable ones: an
    // export-off object still renders on canvas and one toggle emits its props.
    //
    // Deliberately no typeIssues here, asymmetric to create_draft: an unknown
    // type may be a newer app's design (forward compat), so it warns instead
    // of refusing.
    const propErrors = parsed.value.pages.flatMap((page) =>
      getAllLeaves(page.objects).flatMap((leaf) =>
        propIssues(leaf.type, leaf.props as unknown as Record<string, unknown>, "design"),
      ),
    );
    if (propErrors.length > 0) return { ok: false, errors: propErrors };
    // Same default-merge create_draft applies to sparse objects: without it a
    // hand-built envelope missing a prop emits NaN/undefined with ok:true, while a
    // legacy design missing a later-added prop just reads the same fallback its readers use.
    const pages = parsed.value.pages.map((page) => ({
      ...page,
      objects: normalizeLeaves(page.objects),
    }));
    return { ok: true, value: { ...parsed.value, pages } };
  } catch (e) {
    return { ok: false, errors: [errorMessage(e)] };
  }
}

/** 'C' is the editor's centre control, which only 1D barcodes expose. Anywhere
 *  else it persists as metadata no UI can show or clear, so every write path
 *  canonicalizes it here rather than just the one that creates objects. */
export function canonicalFieldJustify(
  type: string,
  justify: LabelObject["fieldJustify"],
): LabelObject["fieldJustify"] {
  return justify === "C" && getEntry(type)?.barcodeClass !== "1d" ? undefined : justify;
}

/** Registry defaults under the leaf's props plus the same fieldJustify
 *  canonicalization every other write path applies. */
function normalizeLeaves(objects: LabelObject[]): LabelObject[] {
  return objects.map((o) =>
    isGroup(o)
      ? { ...o, children: normalizeLeaves(o.children) }
      : {
          ...o,
          ...(o.fieldJustify !== undefined
            ? { fieldJustify: canonicalFieldJustify(o.type, o.fieldJustify) }
            : {}),
          props: { ...(getEntry(o.type)?.defaultProps ?? {}), ...o.props },
        },
  ) as LabelObject[];
}

/** Merge a caller's sparse object over the registry defaults so an LLM only
 *  needs to supply the props it wants to change. Unknown type keeps empty
 *  defaults; the schema is tolerant, so createDraft guards it up front. */
export function toLabelObject(
  input: ObjectInput,
  id: string,
  label?: DeviceFontLabel,
): LabelObject {
  const defaults = getEntry(input.type)?.defaultProps ?? {};
  const justify = canonicalFieldJustify(input.type, input.fieldJustify);
  const base = {
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
  // Same registry hook every editor edit runs (labelStore.internals): over MCP,
  // add/create is the primary way to deliver full props, so an ^BF height or
  // ^FB line count must be clamped/grown here too, not only on update.
  const normalize = getEntry(input.type)?.normalizeChanges;
  if (!normalize || input.props === undefined) return base;
  // Same device-font ctx the editor passes, or the hook resolves font 0 here.
  const normalized = normalize(base as never, { props: input.props } as never, { label: label ?? {} });
  return { ...base, ...normalized, props: { ...(base as { props: object }).props, ...normalized.props } } as LabelObject;
}

/** Caller-supplied graphic bytes, rejected up front so a bad payload fails the
 *  call instead of printing nothing silently. Delegates to gfShipsSafely (the
 *  emit-side guard); `shipsVerbatim` marks the prop whose string reaches the wire untouched. */
function graphicPropIssue(name: string, value: unknown, shipsVerbatim: boolean): string | null {
  // A non-string reaches the emitted stream through the same interpolation,
  // string-coerced: an array of header and command joins to a valid-looking
  // graphic that carries whatever the second element says.
  if (typeof value !== "string") return `${name} must be a string`;
  const head = parseGfHeader(value);
  if (!head) return `${name} must start with a ^GF header (the format letter is required)`;
  // A header carrying no data would emit `^GFB,8,8,1,` and the firmware eats the
  // following ^FS/^XZ as graphic data (spec p.215). Only fatal for the verbatim
  // prop; a cache degrades through gfaCacheUsable to an empty field + warning.
  if (shipsVerbatim && head.payload.trim() === "") return `${name} carries no graphic data`;
  return gfShipsSafely(value) ? null : `${name} carries characters that are not graphic data`;
}

/** Props whose value is user text the app lets through verbatim; every other
 *  prop reaches a ZPL parameter slot, where a control prefix starts a command
 *  instead of filling it. Non-emitting props carry the same verbatim text but reach no slot. */
const FREE_TEXT_PROPS = new Set(["content", "comment", ...NON_EMITTING_PROP_KEYS]);

/** Flags ^, ~ or comma anywhere in a string, walked into object values. Comma
 *  matters because these values land in comma-delimited ZPL slots (storedAs.name
 *  reaches ~DY/^XG); depth-bounded against a self-referential object's stack overflow. */
function hasControlString(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return ZPL_PARAM_CHARS.test(value);
  if (depth > 8 || value === null || typeof value !== "object") return false;
  return Object.values(value).some((v) => hasControlString(v, depth + 1));
}

/** Emitted props with no registry default, so type-checking has nothing to
 *  compare against; listed here instead of defaulted (a default would change
 *  what every new object persists), e.g. the parser's own printerFontName/storedAs. */
const OPTIONAL_PROP_TYPES: Record<string, string> = {
  heightDots: "number",
  blockWidth: "number",
  blockLines: "number",
  blockLineSpacing: "number",
  blockJustify: "string",
  blockHangingIndent: "number",
  blockHeight: "number",
  byHeight: "number",
  textMode: "string",
  fpDirection: "string",
  fpCharGap: "number",
  printerFontName: "string",
  fontId: "string",
  serial: "object",
  storedAs: "object",
  reverse: "boolean",
  gs1: "boolean",
  msiCheckMode: "string",
  msiHriCheck: "boolean",
  aspectRatio: "number",
  rows: "number",
  columns: "number",
  segments: "number",
  symbolNumber: "number",
  symbolTotal: "number",
  lockAspect: "boolean",
  preSerialContent: "string",
};

/** Props emitted as written, so the boundary must prove they're graphic data
 *  before the printer reads them as commands. rawGf ships the string verbatim
 *  (empty payload is fatal); _gfaCache passes gfaCacheUsable first and degrades to an empty field plus a warning. */
const RAW_GRAPHIC_PROPS = new Map<string, boolean>([
  ["rawGf", true],
  ["_gfaCache", false],
]);

/** Registry defaults are the only runtime prop contract, so a supplied prop
 *  must match its default's type; unchecked, a string reaches the emitted ZPL
 *  ("^A0N,gross,0"). Props the defaults omit are optional extras: finite check only. */
export function propIssues(
  type: string,
  props: Record<string, unknown> | undefined,
  /** `caller`: props this call supplied, checked down to the graphic payload.
   *  `design`: a whole design file (may carry an importer's preserved bytes);
   *  judged by emit instead (gfShipsSafely), so reading a design back never fails wholesale over one object. */
  origin: "caller" | "design" = "caller",
): string[] {
  if (!props) return [];
  const defaults = getEntry(type)?.defaultProps as Record<string, unknown> | undefined;
  const issues: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const shipsVerbatim = RAW_GRAPHIC_PROPS.get(key);
    if (shipsVerbatim !== undefined) {
      // Type contract holds for BOTH origins: core reads these as strings
      // (parseGfHeader coerces via RegExp.exec), so a non-string would throw a
      // TypeError out of emit/canvas render instead of a clean ToolError here.
      if (typeof value !== "string") issues.push(`${type}.${key} must be a string`);
      else if (origin === "caller") {
        const issue = graphicPropIssue(key, value, shipsVerbatim);
        if (issue) issues.push(issue);
      }
      continue;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      issues.push(`${type}.${key} must be a finite number`);
      continue;
    }
    // No prop holds null, and a null merged over a default stringifies into
    // its parameter slot ("^A0N,null,0").
    if (value === null) {
      issues.push(`${type}.${key} must not be null (drop the key to keep the current value)`);
      continue;
    }
    // Every string leaf, nested included: storedAs.name and the serial fields
    // reach parameter slots (^XG, ^SN) just like a top-level prop does. Props
    // the defaults omit carry no type either way ("^FB1,1,0,L,0^FS^XZ~JB").
    if (!FREE_TEXT_PROPS.has(key) && hasControlString(value)) {
      issues.push(`${type}.${key} must not contain ^ ~ or , (they end the ZPL parameter)`);
      continue;
    }
    // byHeight is a qrcode prop; on any other type it would silently never
    // print, and the global OPTIONAL/knownPropNames maps would swallow the
    // unknown-prop note, so it rejects here explicitly.
    if (key === "byHeight" && type !== "qrcode") {
      issues.push(`${type}.byHeight is a qrcode prop`);
      continue;
    }
    // hasOwn, not a bracket read: a prop named toString would otherwise resolve
    // Object.prototype's and be rejected for not being a function.
    const fallback = defaults && Object.hasOwn(defaults, key) ? defaults[key] : undefined;
    // Documented optional props carry no default but still reach a parameter
    // slot: heightDots as "300" made ^FT string-concatenate into ^FT100,100300.
    // hasOwn, same reason as the defaults read above (toString collision).
    const optional = Object.hasOwn(OPTIONAL_PROP_TYPES, key) ? OPTIONAL_PROP_TYPES[key] : undefined;
    if (fallback === undefined && optional !== undefined && value !== undefined && value !== null) {
      const got = Array.isArray(value) ? "array" : typeof value;
      if (got !== optional) issues.push(`${type}.${key} must be ${optional} (got ${got})`);
      else if (key === "byHeight" && !isQrByHeight(value)) {
        issues.push(`${type}.byHeight must be a positive integer (got ${value})`);
      }
      continue;
    }
    if (fallback === undefined || fallback === null || value === undefined || value === null) {
      continue;
    }
    const wanted = Array.isArray(fallback) ? "array" : typeof fallback;
    const got = Array.isArray(value) ? "array" : typeof value;
    if (wanted !== got) {
      issues.push(`${type}.${key} must be ${wanted} (got ${got})`);
      continue;
    }
    // Right type, wrong value: "90" would emit ^A090, which no firmware reads.
    if (key === "rotation" && typeof value === "string" && !isZplRotation(value)) {
      issues.push(`${type}.rotation must be N, R, I or B (got ${JSON.stringify(value)})`);
    }
  }
  return issues;
}

/** Closest registered type within one edit per three characters, so `code128`
 *  surfaces for `code127` but not for anything unrelated. */
function nearestType(type: string): string | null {
  const budget = Math.max(1, Math.floor(type.length / 3));
  let best: { name: string; distance: number } | null = null;
  for (const name of Object.keys(ObjectRegistry)) {
    const distance = editDistance(type.toLowerCase(), name.toLowerCase());
    if (distance <= budget && (best === null || distance < best.distance)) {
      best = { name, distance };
    }
  }
  return best?.name ?? null;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** Unregistered types, each with a suggestion when one is close enough. */
export function typeIssues(types: readonly string[]): string[] {
  return [...new Set(types.filter((t) => getEntry(t) === undefined))].map((type) => {
    const near = nearestType(type);
    return `Unknown object type: ${type}${near ? ` (did you mean ${near}?)` : ""}`;
  });
}

/** Hand-written prop summaries for the types an LLM reaches for first. Every
 *  other registered type is listed by name + defaults from the registry. */
export const PROP_SUMMARIES: Record<string, Record<string, string>> = {
  text: {
    content: "string, the printed text",
    fontHeight: "dots, glyph height",
    fontWidth: "dots, 0 = auto from height",
    rotation: "N | R | I | B (0/90/180/270)",
    reverse: "boolean, white-on-black knockout (^FR; needs a dark shape behind)",
    blockWidth: "dots, turns the field into a wrapped ^FB block (0 = single line)",
    blockLines: "max lines the block prints; content past them is clipped",
    blockLineSpacing: "dots added between lines",
    blockJustify: "L | C | R | J inside the block",
  },
  code49: {
    content: "string payload",
    height: "height of ONE row in dots; the symbol stacks 2-8 of them",
    moduleWidth: "narrow-bar width in dots",
    printInterpretation: "boolean, show human-readable text",
    printInterpretationAbove: "boolean, put that text above the bars",
    mode: "A (auto) or 0-5 starting mode",
    rotation: "N | R | I | B",
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
  image: {
    imageId: "string, id of an image the app holds; empty for a pure ZPL graphic",
    widthDots: "printed width in dots",
    heightDots: "printed height in dots; follows the aspect ratio when omitted",
    threshold: "0-255 luminance cut for the 1-bit conversion",
    rotation: "N | R | I | B",
    _gfaCache: "the encoded ^GFA graphic; raster_image fills this",
  },
  qrcode: {
    content: "string payload",
    magnification: "module size 1-10",
    errorCorrection: "L | M | Q | H",
    model: "1 | 2",
    rotation: "N | R | I | B",
    byHeight: "optional ^BY height the print position sinks by; omit for the default (10)",
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

/** A prop nobody knows is kept in the model but never emitted, so a typo prints
 *  nothing and explains nothing. Known means defaulted OR documented: calling an
 *  undefaulted optional (code128.gs1) unknown would condemn correct labels. */
export function unknownPropNotes(type: string, id: string, props: Record<string, unknown> | undefined): string[] {
  const defaults = getEntry(type)?.defaultProps as Record<string, unknown> | undefined;
  if (!props || !defaults) return [];
  const documented = PROP_SUMMARIES[type] ?? {};
  return Object.keys(props)
    // hasOwn, not `in`: a prop literally named __proto__ is on every object's
    // prototype chain and would slip past unremarked.
    .filter(
      (key) =>
        !Object.hasOwn(defaults, key) &&
        !Object.hasOwn(documented, key) &&
        !RAW_GRAPHIC_PROPS.has(key) &&
        !knownPropNames().has(key),
    )
    .map((key) => `${id}: ${key} is not a known ${type} prop (see get_schema)`);
}

/** Every prop name any type defaults or documents. Optional props exist that do
 *  neither, so only a name nobody owns counts as a typo: a false accusation
 *  costs more than a missed one (it once argued an agent out of correct GS1). */
function knownPropNames(): ReadonlySet<string> {
  if (KNOWN_PROPS === null) {
    KNOWN_PROPS = new Set([
      ...Object.values(ObjectRegistry).flatMap((e) =>
        Object.keys((e as { defaultProps?: object }).defaultProps ?? {}),
      ),
      ...Object.values(PROP_SUMMARIES).flatMap((p) => Object.keys(p)),
      ...Object.keys(OPTIONAL_PROP_TYPES),
    ]);
  }
  return KNOWN_PROPS;
}

let KNOWN_PROPS: Set<string> | null = null;

/** First `type-n` nobody holds. A count-derived id collides as soon as the
 *  design skips or reuses the sequence (an explicit id, a removed object). */
export function freeId(type: string, taken: ReadonlySet<string>): string {
  let n = taken.size + 1;
  while (taken.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

export function buildObjects(
  inputs: ObjectInput[],
  label?: DeviceFontLabel,
): { objects: LabelObject[] } | { error: string } {
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
    return toLabelObject(o, id, label);
  });
  return { objects };
}


/** Give each variable an id and a free ^FN slot, so the caller only has to
 *  name it. Duplicate names or slots would silently merge fields, so they are
 *  rejected instead. */
export function buildVariables(
  inputs: readonly VariableInputJson[],
  existing: readonly Variable[] = [],
): { value: Variable[] } | { error: string } {
  const names = new Set(existing.map((v) => v.name));
  const taken: number[] = [
    ...existing.map((v) => v.fnNumber),
    ...inputs.flatMap((v) => (v.fnNumber === undefined ? [] : [v.fnNumber])),
  ];
  const usedIds = new Set(existing.map((v) => v.id));
  const out: Variable[] = [];
  for (const input of inputs) {
    // Trimmed before it is stored, the way parseDesignFile and the editor's
    // addVariable both store it: keeping the caller's spacing handed back a
    // name that no later call could address, because every reader trims first.
    const name = input.name.trim();
    if (!isValidVariableName(name)) {
      return { error: `Invalid variable name: ${JSON.stringify(input.name)}` };
    }
    if (names.has(name)) return { error: `Duplicate variable name: ${name}` };
    names.add(name);
    if (input.fnNumber !== undefined && (input.fnNumber < FN_NUMBER_MIN || input.fnNumber > FN_NUMBER_MAX)) {
      return { error: `^FN slot must be ${FN_NUMBER_MIN}-${FN_NUMBER_MAX} (got ${input.fnNumber})` };
    }
    let fnNumber = input.fnNumber;
    if (fnNumber === undefined) {
      const free = nextFreeFnNumber(taken);
      if (free === null) return { error: "No free ^FN slot left (1-99)" };
      fnNumber = free;
      taken.push(free);
    }
    let idIndex = existing.length + out.length + 1;
    while (usedIds.has(`var-${idIndex}`)) idIndex++;
    usedIds.add(`var-${idIndex}`);
    out.push({
      id: `var-${idIndex}`,
      name,
      fnNumber,
      // A default carrying its own «…» would resolve in preview and emit
      // verbatim (see stripMarkerDelimiters); every mutator strips it.
      defaultValue: stripMarkerDelimiters(input.defaultValue ?? ""),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    });
  }
  const dup = duplicateVariableError([...existing, ...out]);
  return dup === null ? { value: out } : { error: dup.errors[0]! };
}

