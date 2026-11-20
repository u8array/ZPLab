import type { ViewRotation } from "@zplab/core/registry/rotation";
import type { SnapLines } from "./snapGuides";

/** Ruler guides in label mm: `x` along the label width, `y` along its height. */
export interface RulerGuides {
  x: number[];
  y: number[];
}

type RulerGuideAxis = keyof RulerGuides;

export interface RulerGuide {
  axis: RulerGuideAxis;
  mm: number;
}

export const NO_RULER_GUIDES: RulerGuides = { x: [], y: [] };

function guideDots(mm: number, dpmm: number): number {
  return Math.round(mm * dpmm);
}

/** A guide sits on a whole dot, so a snap lands on a whole dot. */
export function guideMmOnDot(mm: number, dpmm: number): number {
  return guideDots(mm, dpmm) / dpmm;
}

export function withGuide(guides: RulerGuides, { axis, mm }: RulerGuide): RulerGuides {
  return guides[axis].includes(mm) ? guides : { ...guides, [axis]: [...guides[axis], mm] };
}

export function withoutGuide(guides: RulerGuides, { axis, mm }: RulerGuide): RulerGuides {
  return guides[axis].includes(mm) ? { ...guides, [axis]: guides[axis].filter((at) => at !== mm) } : guides;
}

function guideList(guides: RulerGuides): RulerGuide[] {
  return [...guides.x.map((mm) => ({ axis: "x" as const, mm })), ...guides.y.map((mm) => ({ axis: "y" as const, mm }))];
}

/** Where the label sits on the stage: model origin, rotation pivot and px per mm. */
export interface RulerGuideView {
  originX: number;
  originY: number;
  centerX: number;
  centerY: number;
  scale: number;
  rotation: ViewRotation;
}

/** A guide as the stage shows it: a vertical line at stage x `px` or a horizontal line at stage y `px`. */
export interface StageRulerGuide {
  vertical: boolean;
  px: number;
}

const swapsAxes = (rotation: ViewRotation) => rotation === 90 || rotation === 270;

/** The sign the model offset from the pivot takes on the stage, per axis and rotation. */
function stageSign(axis: RulerGuideAxis, rotation: ViewRotation): 1 | -1 {
  if (axis === "x") return rotation === 180 || rotation === 270 ? -1 : 1;
  return rotation === 90 || rotation === 180 ? -1 : 1;
}

export function guideToStage({ axis, mm }: RulerGuide, view: RulerGuideView): StageRulerGuide {
  const swapped = swapsAxes(view.rotation);
  const vertical = (axis === "x") !== swapped;
  const fromPivot = axis === "x" ? view.originX + mm * view.scale - view.centerX : view.originY + mm * view.scale - view.centerY;
  const pivot = vertical ? view.centerX : view.centerY;
  return { vertical, px: pivot + stageSign(axis, view.rotation) * fromPivot };
}

export function stageToGuide({ vertical, px }: StageRulerGuide, view: RulerGuideView): RulerGuide {
  const axis: RulerGuideAxis = vertical !== swapsAxes(view.rotation) ? "x" : "y";
  const fromPivot = stageSign(axis, view.rotation) * (px - (vertical ? view.centerX : view.centerY));
  const mm = axis === "x" ? (view.centerX + fromPivot - view.originX) / view.scale : (view.centerY + fromPivot - view.originY) / view.scale;
  return { axis, mm };
}

export function guideAtStage(at: StageRulerGuide, view: RulerGuideView, dpmm: number): RulerGuide {
  const guide = stageToGuide(at, view);
  return { ...guide, mm: guideMmOnDot(guide.mm, dpmm) };
}

/** The nearest guide whose stage line lies within `tolerance` px of a crossing of the same direction. */
export function guideNear(guides: RulerGuides, crossings: readonly StageRulerGuide[], view: RulerGuideView, tolerance: number): RulerGuide | undefined {
  const away = (line: StageRulerGuide) =>
    Math.min(...crossings.filter((at) => at.vertical === line.vertical).map((at) => Math.abs(at.px - line.px)));
  return guideList(guides)
    .map((guide) => ({ guide, away: away(guideToStage(guide, view)) }))
    .filter((near) => near.away <= tolerance)
    .sort((a, b) => a.away - b.away)[0]?.guide;
}

const isGuide = (a: RulerGuide | undefined, b: RulerGuide) => a?.axis === b.axis && a.mm === b.mm;

export function stageRulerGuides(guides: RulerGuides, view: RulerGuideView, moving?: RulerGuide): StageRulerGuide[] {
  return guideList(guides)
    .filter((guide) => !isGuide(moving, guide))
    .map((guide) => guideToStage(guide, view));
}

/** The guides after a drag ends at `at`. A drop on a ruler or off the canvas removes the moving guide. */
export function guidesAfterDrop(
  guides: RulerGuides,
  moving: RulerGuide | undefined,
  at: StageRulerGuide,
  view: RulerGuideView,
  dpmm: number,
  canvas: { from: number; width: number; height: number },
): RulerGuides {
  const rest = moving ? withoutGuide(guides, moving) : guides;
  // The drop lands on the dot the draft shows.
  const dropped = guideAtStage(at, view, dpmm);
  const px = guideToStage(dropped, view).px;
  return px < canvas.from || px > (at.vertical ? canvas.width : canvas.height) ? rest : withGuide(rest, dropped);
}

/** The guides after `edited` moves to the line of a typed position. */
export function guidesAfterEdit(guides: RulerGuides, edited: RulerGuide, at: StageRulerGuide, view: RulerGuideView, dpmm: number): RulerGuides {
  return withGuide(withoutGuide(guides, edited), guideAtStage(at, view, dpmm));
}

/** The guides as snap lines in model dots, the space a move snaps in. */
export function guideSnapLinesDots(guides: RulerGuides, dpmm: number): SnapLines {
  return { x: guides.x.map((mm) => guideDots(mm, dpmm)), y: guides.y.map((mm) => guideDots(mm, dpmm)) };
}

/** The guides as snap lines in stage px, the space a resize and a line endpoint snap in. */
export function guideSnapLinesStage(guides: RulerGuides, view: RulerGuideView): SnapLines {
  const stage = stageRulerGuides(guides, view);
  return { x: stage.filter((g) => g.vertical).map((g) => g.px), y: stage.filter((g) => !g.vertical).map((g) => g.px) };
}
