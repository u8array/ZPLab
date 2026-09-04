import type Konva from "konva";
import { Shape } from "react-konva";
import { dotsToPx, pxToDots } from "@zplab/core/lib/coordinates";
import { boxCornerRadii, traceRoundedBox, traceRoundedBoxRing } from "@zplab/core/lib/shapeGeometry";
import { HOLLOW_HIT_NAME, hollowRingAttrs, hollowRingSpec } from "./lassoGeometry";
import { MIN_HIT_STROKE_PX } from "./konvaObjectProps";
import type { reverseShapeStyle } from "./reverseShapeStyle";

interface Props {
  /** px at the current zoom; thicknessDots feeds the radius model. */
  w: number;
  h: number;
  strokeWidth: number;
  thicknessDots: number;
  rounding: number;
  scale: number;
  dpmm: number;
  fill: string;
  globalCompositeOperation?: ReturnType<typeof reverseShapeStyle>["globalCompositeOperation"];
  isSelected: boolean;
}

/** A hollow rounded ^GB as a ring path: a Konva stroke would keep its inner arc concentric. */
export function RoundedBoxRing({ w, h, strokeWidth, thicknessDots, rounding, scale, dpmm, fill, globalCompositeOperation, isSelected }: Props) {
  const hitPad = Math.max(0, (MIN_HIT_STROKE_PX - strokeWidth) / 2);
  const ringSpec = (sx: number, sy: number, pad: number) => {
    const r = boxCornerRadii(pxToDots(w * sx, scale, dpmm), pxToDots(h * sy, scale, dpmm), thicknessDots, rounding);
    return hollowRingSpec(w * sx, h * sy, strokeWidth, { outer: dotsToPx(r.outer, scale, dpmm), inner: dotsToPx(r.inner, scale, dpmm) }, pad);
  };
  const hitSpec = ringSpec(1, 1, hitPad);
  // The multi-resize projection scales the group live; draw in unscaled space
  // so the band keeps its width like a non-scaling stroke, the box follows.
  const ringPath = (ctx: Konva.Context, shape: Konva.Shape, pad: number, filled: boolean) => {
    const { x: sx, y: sy } = shape.getAbsoluteScale();
    const spec = ringSpec(sx, sy, pad);
    ctx.scale(1 / sx, 1 / sy);
    ctx.translate(-pad, -pad);
    ctx.beginPath();
    if (filled) traceRoundedBox(ctx, spec.width, spec.height, spec.outer);
    else traceRoundedBoxRing(ctx, spec.width, spec.height, spec.band, spec);
    ctx.fillStrokeShape(shape);
  };
  return (
    <Shape
      width={w}
      height={h}
      fill={fill}
      globalCompositeOperation={globalCompositeOperation}
      name={isSelected ? undefined : HOLLOW_HIT_NAME}
      {...hollowRingAttrs(hitSpec.inset, hitSpec.inner)}
      sceneFunc={(ctx, shape) => ringPath(ctx, shape, 0, false)}
      hitFunc={(ctx, shape) => ringPath(ctx, shape, hitPad, isSelected)}
    />
  );
}
