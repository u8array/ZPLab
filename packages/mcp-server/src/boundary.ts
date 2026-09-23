// Input validation at the tool boundary: schemas, prop/type checks, and the
// envelope every design-shaped tool parses first.

import { z } from "zod";
import {
  parseDesignFile,
  designFileErrors,
  type DesignFile,
  type DesignFilePage,
} from "@zplab/core/lib/designFile";
import {
  buildVariables,
  completeVariables,
  duplicateVariableIssue,
  normalizeLeaves,
  propIssues,
  RAW_GRAPHIC_PROPS,
  toLabelObject,
  typeIssues,
  type ObjectInput,
} from "@zplab/core/lib/designInput";
import { getEntry } from "@zplab/core/registry";
import type { PropSpec } from "@zplab/core/types/propSpec";
import { designSizeIssue } from "@zplab/core/lib/designLimits";
import { getAllLeaves, walkObjects, type LabelObject } from "@zplab/core/types/Group";
import { errorMessage } from "@zplab/core/lib/errorMessage";
import { DPMM_VALUES, isDpmm, type DeviceFontLabel, type Dpmm, type LabelConfig } from "@zplab/core/types/LabelConfig";
import { storedFormatPathSchema } from "@zplab/core/lib/storagePath";
import { variableSchema, type Variable, type VariableInput } from "@zplab/core/types/Variable";

// Re-exported so the tools keep their names.
export { buildVariables, propIssues, typeIssues };

/** A key at the wrong level is refused by name, since a plain object would strip it and the
 *  model would chase the symptoms elsewhere. `props` stays open because the notes report it. */
function strictShape<T extends z.ZodRawShape>(shape: T, noun: string, of: string, belongs: string): z.ZodObject<T, z.core.$strict> {
  const takes = Object.keys(shape);
  return z.strictObject(shape, {
    error: (issue) => {
      if (issue.code !== "unrecognized_keys") return undefined;
      const keys = issue.keys.map((k) => `"${k}"`).join(", ");
      const list = takes.length > 0 ? `${of} takes ${takes.join(", ")}.` : `${of} takes no arguments.`;
      return `unknown ${noun}${issue.keys.length > 1 ? "s" : ""} ${keys}. ${list}${belongs ? ` ${belongs}` : ""}`;
    },
  });
}
/** A tool's top-level arguments. */
export const strictInput = <T extends z.ZodRawShape>(shape: T, belongs = "") => strictShape(shape, "argument", "This tool", belongs);
/** An entry inside an argument, named by what it is. */
export const strictEntry = <T extends z.ZodRawShape>(shape: T, of: string, belongs = "") => strictShape(shape, "key", of, belongs);

/** Where a misplaced field belongs, so the refusal points the model there. */
export const INSIDE_DESIGN_FILE = "A design's own fields (schemaVersion, label, pages, variables) go inside designFile.";
export const INSIDE_OBJECT_ENTRY = "An object's fields go inside its entry in objects.";
export const INSIDE_PROPS = "Its printable settings go inside props.";

export const objectInputSchema: z.ZodType<ObjectInput> = strictEntry({
  type: z.string(),
  x: z.number(),
  y: z.number(),
  id: z.string().optional(),
  // Anchor semantics: FO = top-left origin, FT = typeset baseline; fieldJustify
  // right-aligns. Omitted keeps the model default (FO / left).
  positionType: z.enum(["FO", "FT"]).optional(),
  fieldJustify: z.enum(["L", "C", "R"]).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
}, "An object entry", INSIDE_PROPS);

const dpmmSchema = z.literal([...DPMM_VALUES]);

/** A reusable slot: content referencing it as `«name»` emits ^FN, so the
 *  same design prints many rows. Slot numbers are assigned when omitted. */
export const variableInputSchema: z.ZodType<VariableInput> = strictEntry({
  name: z.string().min(1),
  defaultValue: z.string().optional(),
  fnNumber: z.number().int().optional(),
  comment: z.string().optional(),
}, "A variable");
export type VariableInputJson = Omit<VariableInput, "id">;

export const createDraftShape = {
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  dpmm: dpmmSchema,
  storedFormatPath: storedFormatPathSchema("storedFormatPath must be drive:NAME.ZPL, drive R, E, B or A, name of 1-16 letters, digits or _")
    .describe("^DF: the printer stores the format under this path instead of printing it. A batch recall (^XF) reads names of 8 chars at most.")
    .optional(),
  objects: z.array(objectInputSchema),
  variables: z.array(variableInputSchema).optional(),
};
export interface CreateDraftInput {
  widthMm: number;
  heightMm: number;
  dpmm: Dpmm;
  storedFormatPath?: string;
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

/** Smaller models tend to hand nested JSON over as a string, so both forms are the same design. */
export const designFileInputSchema = z
  .union([z.record(z.string(), z.unknown()), z.string()], { error: "designFile must be the design object or its JSON as a string" })
  .describe("The design file as an object, or the same JSON as a string.");

export const designFileEnvelopeSchema = z.object({ designFile: designFileInputSchema });

/** export_zpl: `metadata` keeps ZPLab's ^FX comments for a lossless re-import. */
export const exportZplInputSchema = designFileEnvelopeSchema.extend({ metadata: z.boolean().optional() });


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

export function pagesSizeError(pages: readonly { objects: readonly unknown[] }[]): ToolError | null {
  const issue = designSizeIssue(pages);
  return issue === null ? null : { ok: false, errors: [issue] };
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

export function duplicateVariableError(variables: readonly Variable[]): ToolError | null {
  const issue = duplicateVariableIssue(variables);
  return issue === null ? null : { ok: false, errors: [issue] };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isComplete = (v: unknown): v is Variable => variableSchema.safeParse(v).success;
const isPartial = (v: unknown): v is Record<string, unknown> & { name: string } =>
  isRecord(v) && typeof v.name === "string" && !isComplete(v);
const typed = <T>(v: unknown, type: "string" | "number"): T | undefined => (typeof v === type ? (v as T) : undefined);

/** A partial variable is completed like create_draft's. A mistyped field comes back as sent, so the
 *  schema names it alone. Duplicates go to the loader's repair. */
function withCompleteVariables(designFile: unknown): { ok: true; value: unknown } | ToolError {
  if (!isRecord(designFile) || !Array.isArray(designFile.variables)) return { ok: true, value: designFile };
  const { variables } = designFile;
  const partial = variables.filter(isPartial);
  if (partial.length === 0) return { ok: true, value: designFile };
  const inputs = partial.map((v) => ({
    name: v.name,
    id: typed<string>(v.id, "string"),
    fnNumber: typed<number>(v.fnNumber, "number"),
    defaultValue: typed<string>(v.defaultValue, "string"),
    comment: typed<string>(v.comment, "string"),
  }));
  const built = completeVariables(inputs, variables.filter(isComplete));
  if ("error" in built) return { ok: false, errors: [built.error] };
  let next = 0;
  const completed = variables.map((v) => {
    if (!isPartial(v)) return v;
    const full = built.value[next++] as unknown as Record<string, unknown>;
    const mistyped = Object.entries(v).filter(([k, x]) => x !== undefined && typeof x !== typeof full[k]);
    return { ...full, ...Object.fromEntries(mistyped) };
  });
  return { ok: true, value: { ...designFile, variables: completed } };
}

function decodeDesignFile(designFile: unknown): { ok: true; value: unknown } | ToolError {
  if (typeof designFile !== "string") return { ok: true, value: designFile };
  try {
    const value: unknown = JSON.parse(designFile);
    if (typeof value === "string") return { ok: false, errors: ["designFile: the JSON decodes to another string, send the design once"] };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, errors: [`designFile: not valid JSON, ${errorMessage(e)}`] };
  }
}

export function parseEnvelope(designFile: unknown): { ok: true; value: DesignFile } | ToolError {
  const input = decodeDesignFile(designFile);
  if (!input.ok) return input;
  const completed = withCompleteVariables(input.value);
  if (!completed.ok) return completed;
  try {
    const parsed = parseDesignFile(JSON.stringify(completed.value));
    if (!parsed.ok) return { ok: false, errors: [designFileErrors[parsed.error], ...(parsed.issues ?? [])] };
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
    threshold: "1-255 luminance cut for the 1-bit conversion",
    rotation: "N | R | I | B",
    _gfaCache: "the encoded ^GFA graphic; raster_image fills this",
  },
  qrcode: {
    content: "string payload",
    magnification: "module size in dots",
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
 *  nothing and explains nothing. */
export function unknownPropNotes(type: string, id: string, props: Record<string, unknown> | undefined): string[] {
  const specs = getEntry(type)?.propSpecs as Record<string, PropSpec> | undefined;
  if (!props || !specs) return [];
  const documented = PROP_SUMMARIES[type] ?? {};
  return Object.keys(props)
    // hasOwn, not `in`: a prop literally named __proto__ is on every object's
    // prototype chain and would slip past unremarked.
    .filter((key) => !Object.hasOwn(specs, key) && !Object.hasOwn(documented, key) && !RAW_GRAPHIC_PROPS.has(key))
    .map((key) => `${id}: ${key} is not a known ${type} prop (see get_schema)`);
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
