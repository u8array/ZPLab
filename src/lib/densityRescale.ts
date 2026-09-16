import { editBounds, type PropSpec } from "@zplab/core/types/propSpec";
import { isGroup, type LabelObject, type LeafObject, type Page } from "@zplab/core/types/Group";
import { getEntry } from "@zplab/core/registry";
import { gfaCacheIsOnlyCopy, type ImageProps } from "@zplab/core/registry/image";
import { effectiveDpmm, labelConfigSpec, scaledLabelConfigFields, type JmDensity, type LabelConfig } from "@zplab/core/types/LabelConfig";
import { qrByHeight } from "@zplab/core/registry/qrcode";

/** Pending density change: a new head dpmm or a new ^JM mode, both reinterpreting
 *  stored dots under one rescale prompt. `configPatch` carries extra fields (e.g. a
 *  preset's physical size) so keep/scale commits the whole change together. */
export type PendingDensity =
  | { kind: "dpmm"; toDpmm: number; configPatch?: Partial<LabelConfig> }
  | { kind: "jm"; toJm: JmDensity | undefined };

export interface RescaleParams {
  fromEff: number;
  toEff: number;
  patch: Partial<LabelConfig>;
  includeCalibrationFields: boolean;
}

/** Single mapping from a pending density change to rescaleDesign arguments, shared
 *  by the preview and the committing action so they cannot diverge. ^JM keeps the
 *  same head, so only it rescales printer-persistent calibration fields. */
export function rescaleParamsFor(pending: PendingDensity, label: LabelConfig): RescaleParams {
  const fromEff = effectiveDpmm(label);
  return pending.kind === "dpmm"
    ? {
        fromEff,
        toEff: effectiveDpmm({ dpmm: pending.toDpmm, jmDensity: label.jmDensity }),
        patch: { dpmm: pending.toDpmm, ...pending.configPatch },
        includeCalibrationFields: false,
      }
    : {
        fromEff,
        toEff: effectiveDpmm({ dpmm: label.dpmm, jmDensity: pending.toJm }),
        patch: { jmDensity: pending.toJm },
        includeCalibrationFields: true,
      };
}

/** A field whose scaled value had to be clamped or snapped, so the rescale is
 *  not perfectly proportional and the user should know. */
export interface RescaleWarning {
  id: string;
  name: string;
  type: string;
  prop: string;
  reason: "moduleClamped" | "magnificationClamped" | "dimensionClamped" | "imageFloor" | "imageFixed" | "deviceFontSnap" | "calibrationClamped" | "pinnedPageLabelFields";
}

export interface RescaleResult {
  pages: Page[];
  label: LabelConfig;
  warnings: RescaleWarning[];
}

const IMAGE_MIN_DOTS = 8;

// Effective-space printer-persistent dot fields (^LS/^LT/^PF), scaled only on a
// ^JM reinterpretation (same head). An unbounded field keeps its scaled value.
export const CALIBRATION_CLAMP = scaledLabelConfigFields("jmOnly").map((prop) => ({
  prop,
  min: labelConfigSpec(prop).clamp?.min ?? -Infinity,
  max: labelConfigSpec(prop).clamp?.max ?? Infinity,
}));

// Layout-affecting label dot fields (home origin, ^CF default font), always rescaled and bounded post-scale.
export const LAYOUT_LABEL_FIELDS = scaledLabelConfigFields("always").map((prop) => {
  const spec = labelConfigSpec(prop);
  return { prop, min: spec.clamp?.min ?? 0, max: spec.clamp?.max ?? Infinity };
});

const CALIBRATION_FIELDS: readonly (keyof LabelConfig)[] = CALIBRATION_CLAMP.map((c) => c.prop);

const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));
// Math.round(-12.5) = -12 biases negatives toward zero, so round the magnitude
// and restore the sign. Used wherever a signed dot value is scaled.
const roundSymmetric = (v: number) => Math.sign(v) * Math.round(Math.abs(v));
const labelOf = (leaf: LeafObject): string => (leaf.name && leaf.name.trim() ? leaf.name : leaf.type);

/** Scale an integer prop and clamp to its spec bounds, reporting whether the
 *  rounded value actually had to be pulled into range (a mere round is not a
 *  clamp, so it is not flagged). */
function scaleClamped(raw: number, factor: number, min: number, max: number) {
  const rounded = roundSymmetric(raw * factor);
  const value = clamp(min, max, rounded);
  return { value, clamped: value !== rounded };
}

function rescaleLeaf(leaf: LeafObject, factor: number, warnings: RescaleWarning[]): LeafObject {
  const props = leaf.props as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = { ...props };
  const warn = (prop: string, reason: RescaleWarning["reason"]) =>
    warnings.push({ id: leaf.id, name: labelOf(leaf), type: leaf.type, prop, reason });

  // Every QR materialises its ^BY height here, dormant states included (^FT,
  // rotated): the emit pins the power-up default whenever the prop is absent,
  // and a later rotate-back/anchor-toggle must land at the NEW density, not at
  // the old default. Floor only (no ceiling exists, see isQrByHeight).
  if (leaf.type === "qrcode") {
    next.byHeight = Math.max(1, Math.round(qrByHeight(props as { byHeight?: number }) * factor));
  }
  const entry = getEntry(leaf.type);
  for (const [k, spec] of Object.entries((entry?.propSpecs ?? {}) as Record<string, PropSpec>)) {
    const v = props[k];
    if (typeof v !== "number" || spec.type !== "number") continue;
    switch (spec.scale) {
      case "dots":
        if (v > 0) next[k] = Math.max(1, Math.round(v * factor));
        break;
      case "dotsMin0":
        next[k] = Math.max(0, Math.round(v * factor));
        break;
      case "dotsSigned":
        next[k] = roundSymmetric(v * factor);
        break;
      case "module":
      case "uniform": {
        const { min, max } = editBounds(spec);
        const r = scaleClamped(v, factor, min, max);
        next[k] = r.value;
        if (r.clamped) warn(k, spec.scale === "module" ? "moduleClamped" : k === "dimension" ? "dimensionClamped" : "magnificationClamped");
        break;
      }
    }
  }

  // Editable bitmaps scale their box and drop the stale GFA cache so it
  // re-encodes at the new resolution. Verbatim (^GF) and recall (^XG) graphics
  // carry fixed-resolution bytes: their footprint is locked (mirrors
  // image.commitTransform), only position scales, and we warn it cannot rescale.
  if (leaf.type === "image") {
    // A cache with no source image behind it is the graphic's only copy (what
    // raster_image hands over), so it counts as fixed bytes too: re-scaling
    // would clear it with nothing left to re-encode from.
    if (props.rawGf != null || props.storedAs != null || gfaCacheIsOnlyCopy(props as unknown as ImageProps)) {
      warn("widthDots", "imageFixed");
    } else {
      for (const k of ["widthDots", "heightDots"] as const) {
        const v = props[k];
        if (typeof v === "number") {
          const ideal = Math.round(v * factor);
          next[k] = Math.max(IMAGE_MIN_DOTS, ideal);
          if (ideal < IMAGE_MIN_DOTS) warn(k, "imageFloor");
        }
      }
      if (typeof props._gfaCache === "string") next._gfaCache = undefined;
    }
  }

  // Height and module were scaled independently above, so a type whose props
  // constrain each other re-establishes that here.
  Object.assign(next, entry?.constrainProps?.(next as never) ?? {});

  // Device fonts A-H render at discrete magnifications, so a non-integer factor
  // makes the printed size snap rather than scale exactly.
  if (leaf.type === "text" && factor !== 1) {
    const fontId = props.fontId;
    if (typeof fontId === "string" && /^[A-H]$/.test(fontId)) warn("fontHeight", "deviceFontSnap");
  }

  return { ...leaf, x: roundSymmetric(leaf.x * factor), y: roundSymmetric(leaf.y * factor), props: next } as unknown as LeafObject;
}

function rescaleObjects(objects: LabelObject[], factor: number, warnings: RescaleWarning[]): LabelObject[] {
  return objects.map((obj) =>
    isGroup(obj)
      ? { ...obj, children: rescaleObjects(obj.children, factor, warnings) }
      : rescaleLeaf(obj, factor, warnings),
  );
}

/** A single page's ratio: the design's, corrected for a page pinned by its own
 *  ^JM. Such a page keeps its density across a design-level ^JM change, so
 *  applying the design ratio to it would scale dots that never moved. */
function pageFactor(page: Page, before: LabelConfig, after: LabelConfig, designFactor: number): number {
  const jmScale = (jm: LabelConfig["jmDensity"]) => effectiveDpmm({ dpmm: 1, jmDensity: jm });
  const design = jmScale(after.jmDensity) / jmScale(before.jmDensity);
  const own =
    jmScale(page.jmDensity ?? after.jmDensity) / jmScale(page.jmDensity ?? before.jmDensity);
  return (designFactor * own) / design;
}

/** Rescale a whole design from `fromDpmm` to `toDpmm`, keeping the physical
 *  (mm) size constant by scaling every dot-valued field by the density ratio.
 *  Pure transform. `includeCalibrationFields` scales printer-persistent dot
 *  fields too, for a same-head ^JM reinterpretation (not a head swap). */
export function rescaleDesign(
  pages: Page[],
  label: LabelConfig,
  fromDpmm: number,
  toDpmm: number,
  // Explicit, no default: the dpmm path patches { dpmm: toDpmm }, the ^JM path keeps
  // the same head and patches { jmDensity }; a default here risks stamping dpmm on
  // a ^JM reinterpretation.
  configPatch: Partial<LabelConfig>,
  includeCalibrationFields = false,
): RescaleResult {
  const warnings: RescaleWarning[] = [];
  const nextLabel: LabelConfig = { ...label, ...configPatch };
  if (fromDpmm === toDpmm || fromDpmm <= 0) {
    return { pages, label: nextLabel, warnings };
  }
  const factor = toDpmm / fromDpmm;

  const nextPages = pages.map((p) => {
    const f = pageFactor(p, label, nextLabel, factor);
    return f === 1 ? p : { ...p, objects: rescaleObjects(p.objects, f, warnings) };
  });

  for (const { prop, min, max } of LAYOUT_LABEL_FIELDS) {
    const v = label[prop];
    // 0 means unset here (no home offset, ^CF default height): scaling it to
    // the floor would invent a value the design never had.
    if (typeof v === "number" && v !== 0) nextLabel[prop] = Math.min(max, Math.max(min, Math.round(v * factor)));
  }

  if (includeCalibrationFields) {
    for (const { prop, min, max } of CALIBRATION_CLAMP) {
      const v = label[prop];
      if (typeof v !== "number") continue;
      const r = scaleClamped(v, factor, min, max);
      nextLabel[prop] = r.value;
      if (r.clamped) warnings.push({ id: "label", name: prop, type: "label", prop, reason: "calibrationClamped" });
    }
  }

  // Shared label dot fields scale by the design factor even for a page pinned to
  // its own ^JM, so that page's physical output shifts though its objects hold.
  // Per-page config is the structural fix (deferred); warn until then.
  const hasPinnedPage = pages.some((p) => pageFactor(p, label, nextLabel, factor) !== factor);
  // Explicit 0 scales to 0: nothing physically moves, so it must not warn.
  const scalesLabelField =
    LAYOUT_LABEL_FIELDS.some(({ prop }) => typeof label[prop] === "number" && label[prop] !== 0) ||
    (includeCalibrationFields && CALIBRATION_CLAMP.some(({ prop }) => typeof label[prop] === "number" && label[prop] !== 0));
  if (hasPinnedPage && scalesLabelField) {
    warnings.push({ id: "label", name: "", type: "label", prop: "", reason: "pinnedPageLabelFields" });
  }

  return { pages: nextPages, label: nextLabel, warnings };
}

/** Whether rescaleDesign would actually change any dot-valued field, so the UI can
 *  skip a dead rescale prompt. Reads the same field sets as rescaleDesign;
 *  `configPatch` is the pending change, so pages pinned by their own ^JM don't count. */
export function rescaleWouldChange(
  pages: Page[],
  label: LabelConfig,
  includeCalibrationFields: boolean,
  configPatch: Partial<LabelConfig>,
): boolean {
  const next: LabelConfig = { ...label, ...configPatch };
  const { pages: nextPages, label: nextLabel } = rescaleDesign(
    pages, label, effectiveDpmm(label), effectiveDpmm(next), configPatch, includeCalibrationFields,
  );
  // rescaleDesign hands back the same page ref when its factor is 1, so a moved
  // object page is a real change (an empty page's ref may change without one).
  if (pages.some((p, i) => p.objects.length > 0 && nextPages[i] !== p)) return true;
  const layout = LAYOUT_LABEL_FIELDS.map((f) => f.prop);
  const fields = includeCalibrationFields ? [...layout, ...CALIBRATION_FIELDS] : layout;
  return fields.some((f) => nextLabel[f] !== label[f]);
}
