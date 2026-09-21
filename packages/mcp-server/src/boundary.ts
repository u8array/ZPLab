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
  duplicateVariableIssue,
  freeId,
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
import type { Variable, VariableInput } from "@zplab/core/types/Variable";

// Re-exported so the tools keep their names.
export { buildVariables, propIssues, typeIssues };

export const objectInputSchema: z.ZodType<ObjectInput> = z.object({
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

const dpmmSchema = z.literal([...DPMM_VALUES]);

/** A reusable slot: content referencing it as `«name»` emits ^FN, so the
 *  same design prints many rows. Slot numbers are assigned when omitted. */
export const variableInputSchema: z.ZodType<VariableInput> = z.object({
  name: z.string().min(1),
  defaultValue: z.string().optional(),
  fnNumber: z.number().int().optional(),
  comment: z.string().optional(),
});
export type VariableInputJson = VariableInput;

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

/** The model addresses variables by name, so a missing id is filled in. Object ids stay
 *  required: patch_design addresses objects by id. */
function withVariableIds(designFile: unknown): unknown {
  if (!designFile || typeof designFile !== "object") return designFile;
  const { variables } = designFile as { variables?: unknown };
  if (!Array.isArray(variables)) return designFile;
  const taken = new Set<string>();
  for (const v of variables) {
    if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") taken.add((v as { id: string }).id);
  }
  const filled = variables.map((v) => {
    if (!v || typeof v !== "object" || (v as { id?: unknown }).id !== undefined) return v;
    const id = freeId("var", taken);
    taken.add(id);
    return { ...(v as object), id };
  });
  return { ...(designFile as object), variables: filled };
}

export function parseEnvelope(designFile: unknown): { ok: true; value: DesignFile } | ToolError {
  try {
    const parsed = parseDesignFile(JSON.stringify(withVariableIds(designFile)));
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
