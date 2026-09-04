// The agent-facing report: preflight producers, geometry, and the shared
// probe pass behind boundReport/warningReport.

import {
  barcodeEncodeIssueResolved,
  measureBoundsEntry,
  resolveForReport,
  withFootprintBinding,
} from "./footprint.js";
import { isBarcode, isRightAnchoredField } from "@zplab/core/lib/objectBounds";
import { boxCornerRadii } from "@zplab/core/lib/shapeGeometry";
import {
  computePreflight,
  gs1NormalizationFindings,
  markerValueFindings,
  templateFieldFindings,
  type PreflightFinding,
} from "@zplab/core/lib/preflight";
import { barcodeEncodeFindingsCore } from "@zplab/core/lib/barcodeEncodePreflight";
import { clockCtxFromLabel } from "@zplab/core/lib/variableBinding";
import { objectBoundsDots, type BoundingBoxDots, type ObjectBoundsCtx } from "@zplab/core/lib/objectBounds";
import { computeOverlaps, leafBoxesDots, MAX_OVERLAPS, type OverlapDots } from "@zplab/core/lib/objectOverlap";
import { type LeafObject } from "@zplab/core/registry";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { hasTemplateMarkers } from "@zplab/core/lib/fnTemplate";
import { isControlBody } from "@zplab/core/types/controlKey";
import { markerRe } from "@zplab/core/types/Variable";
import { CLOCK_BODY_RE } from "@zplab/core/types/clockMarker";
import { clockBodyLength } from "@zplab/core/lib/fcTemplate";
import {
  exportableLeaves,
  getAllLeaves,
  pageLabelConfig,
  type LabelObject,
  type Page,
} from "@zplab/core/types/Group";
import { effectiveDpmm, type JmDensity, type LabelConfig, type PageLabel } from "@zplab/core/types/LabelConfig";
import type { PreflightKind, PreflightSeverity } from "@zplab/core/lib/preflight";
import {
  type Variable,
} from "@zplab/core/types/Variable";


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
  fn: (objects: LabelObject[], label: PageLabel, pageIndex: number) => T[],
): T[] {
  return pages.flatMap((page, i) => fn(page.objects, pageLabelConfig(label, page), i));
}

/** One wire shape for every finding producer, page index attached. */
const toWarning =
  (pageIndex: number) =>
  (f: PreflightFinding): PreflightWarning => ({
    pageIndex,
    objectId: f.objectId,
    kind: f.kind,
    severity: f.severity,
    ...(f.detail !== undefined ? { detail: f.detail } : {}),
  });

function preflightOf(
  objects: LabelObject[],
  label: PageLabel,
  pageIndex: number,
  variables: readonly Variable[],
  measured?: ObjectBoundsCtx["measured"],
): PreflightWarning[] {
  const leaves = exportableLeaves(objects);
  const warn = toWarning(pageIndex);
  return [
    ...computePreflight(leaves, { label, measured, variables }, "mm").map(warn),
    // The app's twin check (LabelCanvas): a failed ^FE arming would otherwise
    // print wrong under a clean report. No rows headless, so values are judged
    // at the variables' defaults.
    ...markerValueFindings(leaves, { variables, dataset: null, columnMapping: null }).map(warn),
    // Same decision tree as the editor (barcodeEncodeFindingsCore). Not keyed
    // on the probe: a bad EAN measures fine geometrically yet fails to encode.
    // The core resolves the clone once and hands it back; reuse it.
    ...barcodeEncodeFindingsCore(
      leaves,
      { variables, active: null, clock: clockCtxFromLabel(label) },
      (_leaf, resolved) => ({ error: barcodeEncodeIssueResolved(resolved, effectiveDpmm(label)), approximated: false }),
    ).map(warn),
    ...gs1NormalizationFindings(leaves).map(warn),
    ...templateFieldFindings(leaves, variables).map(warn),
  ];
}

/** Per-object geometry so the agent can reason about size/placement without
 *  recomputing it. Dots, visual top-left. `approx` marks headless estimates
 *  (single-line text, unprobed leaves); probed barcodes share the app's kernel and report exact. */
export interface ObjectBounds extends BoundingBoxDots {
  pageIndex: number;
  objectId: string;
  /** Registry type and a content excerpt, so an edit can be aimed straight
   *  from this report; imported ids are opaque uuids on their own. */
  type: string;
  content?: string;
  approx: boolean;
}

/** Axis-aligned bbox intersections. Neutral facts, not errors: a frame/reverse
 *  box overlaps its contents by design, so the agent judges relevance. */
export interface ObjectOverlap extends OverlapDots {
  pageIndex: number;
}

export interface Geometry {
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

/** The one gate for "this page is too big to probe": every prober skips on it
 *  and the partiality note fires on it, so the two can never disagree. */
function pastGeometryCap(leaves: readonly unknown[]): boolean {
  return leaves.length > MAX_GEOMETRY_OBJECTS;
}

/** A frame drawn around content intersects every box inside it, which is what
 *  the user asked for, not a collision. Only the ring is ink, so a box clear of
 *  it is dropped; one that reaches into the stroke still collides and stays. */
function frameNoise(
  a: BoundingBoxDots,
  b: BoundingBoxDots,
  aLeaf: LeafObject | undefined,
  bLeaf: LeafObject | undefined,
): boolean {
  const insideRing = (outer: BoundingBoxDots, inner: BoundingBoxDots, leaf: LeafObject | undefined): boolean => {
    // Rectangles only: an ellipse's ink follows its curve, so a box well inside
    // the bounding rectangle can still cross the stroke.
    if (leaf?.type !== "box") return false;
    const props = leaf.props as { filled?: boolean; thickness?: number; rounding?: number };
    if (props.filled === true) return false;
    const ring = Math.max(1, props.thickness ?? 1);
    const x0 = outer.x + ring;
    const y0 = outer.y + ring;
    const x1 = outer.x + outer.width - ring;
    const y1 = outer.y + outer.height - ring;
    if (!(inner.x >= x0 && inner.y >= y0 && inner.x + inner.width <= x1 && inner.y + inner.height <= y1)) {
      return false;
    }
    // A box clear of every straight edge can still cross the frame's inner arc.
    const radius = boxCornerRadii(outer.width, outer.height, ring, props.rounding ?? 0).inner;
    if (radius <= 0) return true;
    const corners: [number, number][] = [
      [inner.x, inner.y],
      [inner.x + inner.width, inner.y],
      [inner.x, inner.y + inner.height],
      [inner.x + inner.width, inner.y + inner.height],
    ];
    // Distance to the nearest corner circle's centre, the point-in-rounded-rect
    // test the lasso hit-test already uses.
    return corners.every(([px, py]) => {
      const dx = Math.max(x0 + radius - px, px - (x1 - radius), 0);
      const dy = Math.max(y0 + radius - py, py - (y1 - radius), 0);
      return dx * dx + dy * dy <= radius * radius;
    });
  };
  return insideRing(a, b, aLeaf) || insideRing(b, a, bLeaf);
}

/** Enough to recognise a field, short enough to keep the report scannable. */
const CONTENT_EXCERPT_CHARS = 40;
const excerpt = (c: string): string =>
  c.length > CONTENT_EXCERPT_CHARS ? `${c.slice(0, CONTENT_EXCERPT_CHARS - 1)}…` : c;

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
 *  dense pages skip geometry and overlaps are capped, keeping the payload and the
 *  O(n²) scan finite on oversized input. `measured` upgrades boxes from estimate to render-exact. */
function geometryFor(
  pages: PageLike[],
  label: LabelConfig,
  measured?: ObjectBoundsCtx["measured"],
  /** Ids whose payload does not encode: their box is the sample content's, so
   *  it must not claim to be the real one. */
  unencodable?: ReadonlySet<string>,
  /** Ids measured from a marker's default rather than rendered: exact enough to
   *  judge placement, not exact enough to call itself measured. */
  estimated?: ReadonlySet<string>,
): Geometry {
  const bounds: ObjectBounds[] = [];
  const overlaps: ObjectOverlap[] = [];
  let truncated = false;
  pages.forEach((page, pageIndex) => {
    const leaves = exportableLeaves(page.objects);
    if (pastGeometryCap(leaves)) {
      truncated = true;
      return;
    }
    // On the box, not the bounds row: the overlap rects derive their own approx
    // from these.
    const boxes = leafBoxesDots(leaves, { label: pageLabelConfig(label, page), measured }).map(
      (b) => ({
        ...b,
        approx: b.approx || unencodable?.has(b.id) === true || estimated?.has(b.id) === true,
      }),
    );
    const byId = new Map(leaves.map((leaf) => [leaf.id, leaf]));
    for (const b of boxes) {
      const leaf = byId.get(b.id);
      const content = leaf ? getObjectStringContent(leaf) : undefined;
      bounds.push({
        pageIndex,
        objectId: b.id,
        type: leaf?.type ?? "unknown",
        ...(content ? { content: excerpt(content) } : {}),
        ...roundRect(b.box),
        approx: b.approx,
      });
    }
    // Over-scan by one so a complete set of exactly MAX_OVERLAPS isn't mistaken
    // for a capped one. Rejected inside the scan, not after: a frame's own
    // contents are not collisions, and letting them count would hide the ones that are.
    const scanned = computeOverlaps(boxes, MAX_OVERLAPS + 1, (a, b) =>
      !frameNoise(a.box, b.box, byId.get(a.id), byId.get(b.id)),
    );
    if (scanned.length > MAX_OVERLAPS) truncated = true;
    for (const o of scanned.slice(0, MAX_OVERLAPS)) {
      overlaps.push({ ...o, pageIndex, ...roundRect(o) });
    }
  });
  return truncated ? { bounds, overlaps, geometryTruncated: true } : { bounds, overlaps };
}

/** Probes every barcode's real bounds (bwip kernel) so geometry reports true
 *  sizes, not registry defaults. Overrides app-measured entries for barcodes:
 *  canvas size is screen zoom (module px collapse below 1), not print; non-barcode entries keep the canvas as authority (fonts, image bytes). */
function measuredBarcodes(
  pages: PageLike[],
  label: LabelConfig,
  measured?: ObjectBoundsCtx["measured"],
): NonNullable<ObjectBoundsCtx["measured"]> {
  const map = new Map(measured ?? []);
  for (const page of pages) {
    const leaves = exportableLeaves(page.objects);
    if (pastGeometryCap(leaves)) continue;
    const dpmm = effectiveDpmm(pageLabelConfig(label, page));
    for (const leaf of leaves) {
      if (!isBarcode(leaf)) continue;
      const entry = measureBoundsEntry(leaf, dpmm);
      if (entry) map.set(leaf.id, entry);
    }
  }
  return map;
}

/** These objects' own x is the printed RIGHT edge while the bounds row shows
 *  the ink left edge, so a patch aimed at the reported x moves them a full
 *  width. Named only when such an object exists, to keep clean reports quiet. */
function rightAnchorNotes(pages: Page[]): string[] {
  const ids = pages.flatMap((page) =>
    exportableLeaves(page.objects).filter(isRightAnchoredField).map((l) => l.id),
  );
  return ids.length === 0
    ? []
    : [
        `${ids.join(", ")}: right-justified, so the object's x is its printed RIGHT edge, not the bounds x shown here; patch_design x expects that anchor`,
      ];
}

/** Markers that bind nothing print as literal «name», and a variable nothing
 *  references never becomes a slot. Both are silent in the ZPL, so they are
 *  reported as remarks rather than left for the user to find on the media. */
function markerNotes(pages: Page[], variables: readonly Variable[]): string[] {
  const declared = new Set(variables.map((v) => v.name));
  const used = new Set<string>();
  const notes: string[] = [];
  for (const page of pages) {
    // ALL leaves for the reference census: removeVariable rewrites hidden objects
    // too, so a hidden-only reference must not read as "never referenced" (that
    // note invites a destructive remove). Print-facing notes below stay scoped.
    const exported = new Set(exportableLeaves(page.objects).map((l) => l.id));
    for (const leaf of getAllLeaves(page.objects)) {
      const printFacing = exported.has(leaf.id);
      const content = getObjectStringContent(leaf);
      if (content === undefined) continue;
      for (const [, body] of content.matchAll(markerRe())) {
        // Control and clock bodies bind to ^FH/^FC, not to a variable.
        if (body === undefined || isControlBody(body)) continue;
        if (CLOCK_BODY_RE.test(body)) {
          // Shaped like a clock marker but not a token the firmware resolves,
          // so it prints its own guillemets.
          if (clockBodyLength(body) === null && printFacing) {
            notes.push(`${leaf.id}: «${body}» is not a clock token and prints as text`);
          }
          continue;
        }
        used.add(body);
        if (!declared.has(body) && printFacing) {
          notes.push(`${leaf.id}: «${body}» matches no variable and prints as text`);
        }
      }
    }
  }
  for (const v of variables) {
    if (!used.has(v.name)) notes.push(`variable ${v.name} is never referenced by any content`);
    else if (v.defaultValue === "") {
      notes.push(`variable ${v.name} has no default, so its fields measure as empty`);
    }
  }
  return notes;
}

/** Footprints for marker-bearing non-barcode leaves, measured on the
 *  substituted value. Mutates `measured`; the returned ids stay estimates. */
function seedResolvedTextSizes(
  pages: PageLike[],
  label: LabelConfig,
  measured: NonNullable<ObjectBoundsCtx["measured"]>,
): ReadonlySet<string> {
  const estimated = new Set<string>();
  for (const page of pages) {
    const leaves = exportableLeaves(page.objects);
    if (pastGeometryCap(leaves)) continue;
    const pageLabel = pageLabelConfig(label, page);
    for (const leaf of leaves) {
      if (isBarcode(leaf) || measured.has(leaf.id)) continue;
      const content = getObjectStringContent(leaf);
      if (content === undefined || !hasTemplateMarkers(content)) continue;
      const box = objectBoundsDots(resolveForReport(leaf), { label: pageLabel, measured });
      if (box.width <= 0 || box.height <= 0) continue;
      (measured as Map<string, { width: number; height: number }>).set(leaf.id, {
        width: box.width,
        height: box.height,
      });
      estimated.add(leaf.id);
    }
  }
  return estimated;
}

/** The probe-and-preflight pass both report shapes share. */
function reportCore(
  label: LabelConfig,
  variables: readonly Variable[],
  pages: Page[],
  measured: ObjectBoundsCtx["measured"] | undefined,
  datasetBound: boolean,
) {
  // One probe pass for every consumer, or the off-label check would judge
  // clipping with unprobed default boxes while bounds report real sizes.
  const probed = measuredBarcodes(pages, label, measured);
  const notes = [...markerNotes(pages, variables), ...rightAnchorNotes(pages)];
  // Past the geometry cap the probes above SKIPPED the page, so the off-label
  // warnings below judged registry-default boxes: a clean warnings array on
  // such a page is partiality, not health, and every consumer has to hear it.
  for (const [i, page] of pages.entries()) {
    if (pastGeometryCap(exportableLeaves(page.objects))) {
      notes.push(
        `page ${i + 1}: more than ${MAX_GEOMETRY_OBJECTS} objects, so barcode sizes were not probed and off-label warnings may be missing`,
      );
    }
  }
  // The rows live in the session, never in the design file, so the per-row
  // GS1 checks the editor runs cannot run here. Saying so beats a clean
  // report that only ever saw the defaults.
  if (datasetBound) {
    notes.push(
      "this design is bound to a dataset; its rows are not in the file, so only the variable defaults were checked",
    );
  }
  // Preflight judges placement from `measured`; without an entry a marker
  // field is judged at the marker's own width, so a field that overflows once
  // its value is substituted would pass unremarked (bounds already show it).
  const estimated = seedResolvedTextSizes(pages, label, probed);
  const warnings = perPage(pages, label, (objects, pageLabel, i) =>
    preflightOf(objects, pageLabel, i, variables, probed));
  const unencodable = new Set(
    warnings.filter((w) => w.kind === "renderFailed").map((w) => w.objectId),
  );
  return { probed, notes, estimated, warnings, unencodable };
}

/** Preflight + geometry with markers resolved against the design's own
 *  bindings; the report block every design-returning tool carries. */
export function boundReport(
  label: LabelConfig,
  variables: readonly Variable[],
  pages: Page[],
  measured?: ObjectBoundsCtx["measured"],
  datasetBound = false,
) {
  return withFootprintBinding(label, variables, () => {
    const core = reportCore(label, variables, pages, measured, datasetBound);
    return {
      warnings: core.warnings,
      ...(core.notes.length > 0 ? { notes: core.notes } : {}),
      ...geometryFor(pages, label, core.probed, core.unencodable, core.estimated),
    };
  });
}

/** The same pass without geometry: export_zpl returns none, so it skips the
 *  O(n^2) overlap scan. */
export function warningReport(
  label: LabelConfig,
  variables: readonly Variable[],
  pages: Page[],
  datasetBound: boolean,
) {
  return withFootprintBinding(label, variables, () => {
    const core = reportCore(label, variables, pages, undefined, datasetBound);
    return {
      warnings: core.warnings,
      ...(core.notes.length > 0 ? { notes: core.notes } : {}),
    };
  });
}
