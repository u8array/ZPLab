import { z } from "zod";
import { JM_DENSITY_VALUES, labelConfigSchema, sanitizeRfidEpc, type JmDensity, type LabelConfig } from "../types/LabelConfig";
import { labelObjectBaseSchema } from "../types/LabelObject";
import {
  variableSchema,
  columnMappingSchema,
  type Variable,
  type ColumnMapping,
} from "../types/Variable";
import { dbSourceRefSchema, type DbSourceRef } from "../types/DataSource";
import type { LabelObject } from "../types/Group";
import { blockOverlaySchema, overlayText, type BlockOverlay } from "./zplOverlay/overlay";
import { reconstructLegacyBlockHeads } from "./zplHeadScan";
import { visitLeavesInPages, foldSerialLeaf, fixTlc39SlotsLeaf, bindSingleMarkerLeaf, sanitiseVariableNames, safeUniqueNameById } from "./objectTree";
import { insertReverseBackingBoxes, pageNeedsReverseBacking } from "./reverseBacking";
import { ok, err, type Result } from "./result";

/** Current design-file schema version. Bump when the persisted shape
 *  changes in a way an older app cannot read. Add a vN schema +
 *  migrator below and dispatch on `schemaVersion` in `parseDesignFile`.
 *  The persist middleware in `labelStore` has its own independent
 *  version for localStorage state; do not conflate. */
export const CURRENT_DESIGN_SCHEMA_VERSION = 5;

export type DesignFileError = "parse_error" | "invalid_schema";
export interface DesignFilePage { objects: LabelObject[]; overlay?: BlockOverlay; jmDensity?: JmDensity }
export interface DesignFile {
  label: LabelConfig;
  pages: DesignFilePage[];
  variables: Variable[];
  /** Optional: present only when the user has loaded a dataset and set
   *  up a mapping for the current design. Round-trips with the design;
   *  rows themselves are session-only and not part of the save. On disk
   *  the key stays `csvMapping` (pre-rename files keep loading). */
  columnMapping: ColumnMapping | null;
  /** Optional pointer to the database the rows came from, so a reopened
   *  design can offer a one-click re-fetch. */
  dataSource: DbSourceRef | null;
}

// Two distinct shapes share the base fields:
//   * leaves carry `props` and have no `children`,
//   * groups carry `children` and have no `props` (their `type` is 'group').
// Split into separate schemas so a leaf missing its `props` or a group
// missing its `children` fails validation. `groupSchema` is wrapped in
// z.lazy so the recursion through `labelObjectSchema` resolves.
const leafSchema = labelObjectBaseSchema.extend({
  type: z.string().refine((t) => t !== 'group', {
    message: "Leaf objects cannot have type 'group'",
  }),
  props: z.record(z.string(), z.unknown()),
});

const groupSchema: z.ZodType<unknown> = z.lazy(() =>
  labelObjectBaseSchema.extend({
    type: z.literal('group'),
    children: z.array(labelObjectSchema),
  }),
);

const labelObjectSchema: z.ZodType<unknown> = z.union([groupSchema, leafSchema]);

// A persisted overlay that fails its invariant drops to undefined (the page
// regenerates) rather than failing the whole design load.
const pageSchema = z.object({
  objects: z.array(labelObjectSchema),
  overlay: blockOverlaySchema.optional().catch(undefined),
  jmDensity: z.enum(JM_DENSITY_VALUES).optional(),
});

const designFileSchema = z.object({
  // v3 predates ^JM: it loads through the legacy JM reconstruction. v4 carries
  // the persisted density fields; both are read, anything else is rejected.
  // v5: tlc39 props remapped to the real ^BT slots (microPdfModuleWidth /
  // microPdfRowHeight semantics, wideRatio; microPdfRows gone).
  schemaVersion: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  label: labelConfigSchema,
  pages: z.array(pageSchema),
  variables: z.array(variableSchema).optional(),
  csvMapping: columnMappingSchema.optional(),
  // Comfort metadata only: a malformed pointer drops instead of rejecting
  // the whole design (same policy as a broken overlay).
  dataSource: dbSourceRefSchema.optional().catch(undefined),
});

export function parseDesignFile(text: string): Result<DesignFile, DesignFileError> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err("parse_error");
  }
  // Valid JSON that is not an object (null, true, "x") must reject, not throw.
  if (!json || typeof json !== "object") return err("invalid_schema");

  migrateGs1databarModuleWidth(json);
  visitLeavesInPages((json as { pages?: unknown }).pages, fixTlc39SlotsLeaf);
  migrateReverseTextBackground(json);
  migrateSerialToTextMode(json);
  migrateSingleBindToMarker(json);

  const parsed = designFileSchema.safeParse(json);
  if (parsed.success) {
    const pages = parsed.data.pages as unknown as DesignFilePage[];
    reconstructLegacyJmDensity(parsed.data.label, pages);
    sanitizeRfidEpc(parsed.data.label);
    const variables = parsed.data.variables ?? [];
    // Enforce the marker-safe name invariant: an old/foreign name like `clock:Y`
    // can't be a single-bind marker, so rename offenders + rewrite their markers.
    sanitiseVariableNames(variables, pages);
    return ok({
      label: parsed.data.label,
      pages,
      variables,
      columnMapping: parsed.data.csvMapping ?? null,
      dataSource: parsed.data.dataSource ?? null,
    });
  }

  return err("invalid_schema");
}

/** v1→v2: reverse text dropped its synthesized self-background ^GB for a
 *  spec-true ^FR knockout, so give every legacy reverse text a real black box
 *  behind it. Gated on the file version so a v2 file (box already present)
 *  isn't double-boxed. Stamps schemaVersion to 2. */
function migrateReverseTextBackground(json: unknown): void {
  if (!json || typeof json !== "object") return;
  const j = json as Record<string, unknown>;
  // Only an explicit v1 file is migrated; a missing/other version stays as-is so
  // the schema below still rejects malformed input.
  if (j.schemaVersion !== 1) return;
  const label = j.label as Pick<LabelConfig, "customFonts" | "defaultFontId"> | undefined;
  if (Array.isArray(j.pages)) {
    j.pages = j.pages.map((pg) => {
      const p = pg && typeof pg === "object" ? (pg as Record<string, unknown>) : {};
      if (!Array.isArray(p.objects)) return p;
      const objects = p.objects as LabelObject[];
      // Inserting a model object the overlay doesn't link would force a full
      // regeneration on export and lose the overlay's preserved bytes; drop the
      // overlay on a touched page so it regenerates cleanly from the new model.
      const next: Record<string, unknown> = {
        ...p,
        objects: insertReverseBackingBoxes(objects, label),
      };
      if (pageNeedsReverseBacking(objects, label)) delete next.overlay;
      return next;
    });
  }
  j.schemaVersion = 2;
}

/** Rename gs1databar `props.moduleWidth` → `props.magnification` on
 *  legacy design files. Mirrors the persist-store v5→v6 hop in
 *  `labelStore.ts`. Idempotent. */
function migrateGs1databarModuleWidth(json: unknown): void {
  if (!json || typeof json !== "object") return;
  const pages = (json as { pages?: unknown }).pages;
  visitLeavesInPages(pages, (leaf) => {
    if (
      leaf.type === "gs1databar" &&
      leaf.props &&
      typeof leaf.props === "object" &&
      "moduleWidth" in leaf.props &&
      !("magnification" in leaf.props)
    ) {
      const props = leaf.props as Record<string, unknown>;
      props.magnification = props.moduleWidth;
      delete props.moduleWidth;
    }
  });
}

/** Convert the legacy standalone `serial` object type into a `text` field with
 *  a `serial` prop (the dissolved field-mode model). Keeps content/font/rotation
 *  and folds increment/zplMode into `props.serial`. Idempotent. */
function migrateSerialToTextMode(json: unknown): void {
  if (!json || typeof json !== "object") return;
  visitLeavesInPages((json as { pages?: unknown }).pages, foldSerialLeaf);
}

/** v2→v3: single-bind `variableId` dissolved into the content model. A field
 *  bound to a variable becomes content === «name» (classifies as single-bind on
 *  emit, byte-identical); the variableId field is dropped. Gated on v2 so a v3
 *  file isn't reprocessed; stamps schemaVersion to 3. Overlays are kept: the
 *  captured bytes don't change and the overlay doesn't key on variableId. */
function migrateSingleBindToMarker(json: unknown): void {
  if (!json || typeof json !== "object") return;
  const j = json as Record<string, unknown>;
  if (j.schemaVersion !== 2) return;
  const vars = Array.isArray(j.variables)
    ? (j.variables as { id?: unknown; name?: unknown; fnNumber?: unknown }[])
    : [];
  // Resolve the unique, marker-safe name PER ID first (renames the variables),
  // so duplicate legacy names don't collapse two ids onto one marker.
  const nameById = safeUniqueNameById(vars);
  visitLeavesInPages(j.pages, (leaf) => bindSingleMarkerLeaf(leaf, nameById));
  j.schemaVersion = 3;
}

/** Payloads without ^JM modeling carried a head ^JM only in the raw overlay
 *  bytes, which a full regen would drop. Reconstructs the fold a fresh import
 *  would yield; no-op once any label/page density or recorded head is present. */
export function reconstructLegacyJmDensity(
  label: { jmDensity?: JmDensity },
  pages: DesignFilePage[],
): void {
  if (label.jmDensity !== undefined) return;
  for (const page of pages) {
    if (page.jmDensity !== undefined || page.overlay?.head) return;
  }
  const heads = reconstructLegacyBlockHeads(
    pages.map((page) => (page.overlay ? overlayText(page.overlay) : undefined)),
  );
  const anchorIndex = pages.findIndex((p) => p.objects.length > 0);
  if (anchorIndex >= 0) label.jmDensity = heads[anchorIndex]?.density;
  const designJm: JmDensity = label.jmDensity ?? "A";
  pages.forEach((page, i) => {
    const { density, head } = heads[i] ?? {};
    const blockJm: JmDensity = density ?? "A";
    if (blockJm !== designJm) page.jmDensity = blockJm;
    if (head && page.overlay) page.overlay.head = head;
  });
}

interface SerializedDesign {
  schemaVersion: number;
  label: LabelConfig;
  pages: DesignFilePage[];
  variables?: Variable[];
  csvMapping?: ColumnMapping;
  dataSource?: DbSourceRef;
}

export function serializeDesign(
  label: LabelConfig,
  pages: DesignFilePage[],
  variables: Variable[] = [],
  columnMapping: ColumnMapping | null = null,
  dataSource: DbSourceRef | null = null,
): string {
  const payload: SerializedDesign = {
    schemaVersion: CURRENT_DESIGN_SCHEMA_VERSION,
    label,
    pages,
  };
  if (variables.length > 0) payload.variables = variables;
  if (columnMapping) payload.csvMapping = columnMapping;
  if (dataSource) payload.dataSource = dataSource;
  return JSON.stringify(payload, null, 2);
}

export const designFileErrors: Record<DesignFileError, string> = {
  parse_error: "Could not read the file. Make sure it is a valid JSON design file.",
  invalid_schema: "The file does not contain a valid label design.",
};
