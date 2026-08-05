import type { LabelObjectBase } from "../types/LabelObject";
import type { TransformContext } from "../types/ZplEmit";
import { isAxisSwapped } from "./rotation";
/** Clamp a value into [min, max]. */
export function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Block resize intent: the panel toggle's mode, flipped for the drag while
 *  Alt is held. Single source so the start-gate and the commit can't drift. */
export function resolveBlockResizeMode(
  dragMode: "frame" | "glyph",
  altHeld: boolean,
): "frame" | "glyph" {
  if (!altHeld) return dragMode;
  return dragMode === "glyph" ? "frame" : "glyph";
}

/** R/B rotation swaps sx/sy so commits stay in pre-rotation x/y props. */
export function effectiveScale(
  rotation: "N" | "R" | "I" | "B" | undefined,
  ctx: TransformContext,
): { esx: number; esy: number } {
  return rotation && isAxisSwapped(rotation)
    ? { esx: ctx.sy, esy: ctx.sx }
    : { esx: ctx.sx, esy: ctx.sy };
}


interface WidthHeightProps {
  width: number;
  height: number;
}

/** Axis-aligned (box/ellipse); rotated types use commitRotatedWidthHeightTransform. */
export function commitWidthHeightTransform<P extends WidthHeightProps>(
  obj: LabelObjectBase & { props: P },
  ctx: TransformContext,
): Partial<P> {
  const { sx, sy, snap } = ctx;
  return {
    width: Math.max(1, snap(Math.round(obj.props.width * sx))),
    height: Math.max(1, snap(Math.round(obj.props.height * sy))),
  } as Partial<P>;
}

/** width/height are pre-rotation; effectiveScale handles R/B drag axis. */
export function commitRotatedWidthHeightTransform<
  P extends WidthHeightProps & { rotation: "N" | "R" | "I" | "B" },
>(
  obj: LabelObjectBase & { props: P },
  ctx: TransformContext,
): Partial<P> {
  return commitRotatedSizeTransform(obj, ctx, "width", "height");
}

function commitRotatedSizeTransform<
  P extends { rotation: "N" | "R" | "I" | "B" },
  XK extends keyof P,
  YK extends keyof P,
>(
  obj: LabelObjectBase & { props: P },
  ctx: TransformContext,
  xKey: XK,
  yKey: YK,
): Partial<P> {
  const { esx, esy } = effectiveScale(obj.props.rotation, ctx);
  const oldX = obj.props[xKey] as unknown as number;
  const oldY = obj.props[yKey] as unknown as number;
  return {
    [xKey]: Math.max(1, ctx.snap(Math.round(oldX * esx))),
    [yKey]: Math.max(1, ctx.snap(Math.round(oldY * esy))),
  } as Partial<P>;
}

/** moduleWidth clamped to ^BY [1,10]; bitmap stretches mid-drag, rounded on
 *  release. `extraModuleWidthProps` (TLC39's ^BT w2) scale with the same
 *  factor so a horizontal resize keeps the composite proportions. */
export function commitBarcodeWidthHeightTransform<
  P extends { height: number; moduleWidth: number; rotation: "N" | "R" | "I" | "B" },
>(
  obj: LabelObjectBase & { props: P },
  ctx: TransformContext,
  extraModuleWidthProps?: readonly (keyof P & string)[],
): Partial<P> {
  const { snap } = ctx;
  const { esx, esy } = effectiveScale(obj.props.rotation, ctx);
  const out = {
    height: Math.max(1, snap(Math.round(obj.props.height * esy))),
    moduleWidth: clamp(1, 10, Math.round(obj.props.moduleWidth * esx)),
  } as Record<string, number>;
  for (const name of extraModuleWidthProps ?? []) {
    const v = obj.props[name];
    if (typeof v === "number") out[name] = clamp(1, 10, Math.round(v * esx));
  }
  return out as Partial<P>;
}

interface Stacked2DProps {
  rowHeight: number;
  moduleWidth: number;
}

/** Drag-start anchor pins the rowHeight grid so commit matches the in-drag snap.
 *  `moduleWidthMin` defaults to the ^BY floor of 1; CODABLOCK A passes 2. */
export function commitStacked2DTransform<
  P extends Stacked2DProps & { rotation: "N" | "R" | "I" | "B" },
>(
  obj: LabelObjectBase & { props: P },
  ctx: TransformContext,
  moduleWidthMin = 1,
): Partial<P> {
  const { snap, anchor } = ctx;
  const { esx, esy } = effectiveScale(obj.props.rotation, ctx);
  const rowAnchor = anchor?.kind === "row" ? anchor : null;
  // Prefer the start-of-drag anchor height (set from getClientRect in
  // the hook) over ctx.nodeHeight: for Konva Groups the latter is 0,
  // collapsing the anchor-path math to newRowHeight=1.
  const newRowHeight =
    rowAnchor && rowAnchor.nodeHeight > 0 && rowAnchor.rowHeight > 0
      ? Math.max(1, Math.round(rowAnchor.rowHeight * esy))
      : Math.max(1, snap(Math.round(obj.props.rowHeight * esy)));
  return {
    rowHeight: newRowHeight,
    moduleWidth: clamp(moduleWidthMin, 10, Math.round(obj.props.moduleWidth * esx)),
  } as Partial<P>;
}
