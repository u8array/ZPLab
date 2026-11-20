import { useImperativeHandle, useRef, type Ref } from "react";
import { Group, Label, Line, Rect, Tag, Text } from "react-konva";
import type Konva from "konva";
import { RULER_FONT, RULER_SIZE, type RulerProps } from "./Ruler";
import type { Bounds } from "./nodeRect";
import { axisGuides, badgeOffsets, type AxisGuides, type GuideAxis, type GuideReadout } from "./selectionGuideGeometry";

const BADGE_GAP = 3;
const AXES = ["x", "y"] as const;
const SIDES = ["near", "far"] as const;

export interface SelectionGuidesHandle {
  /** Draws the guides for stage-px bounds, null hides them. `sync` redraws inside the caller's frame. */
  show: (bounds: Bounds | null, sync?: boolean) => void;
}

interface Props extends Required<RulerProps> {
  dpmm: number;
  ref?: Ref<SelectionGuidesHandle>;
}

export function SelectionGuides({
  ref,
  labelOffsetX,
  labelOffsetY,
  labelWidthMm,
  labelHeightMm,
  scale,
  dpmm,
  canvasWidth,
  canvasHeight,
  unit,
  colors,
  horizontalReversed,
  verticalReversed,
}: Props) {
  const groupRef = useRef<Konva.Group>(null);
  const drawnRef = useRef("");

  const axes: Record<"x" | "y", GuideAxis> = {
    x: { originPx: labelOffsetX, lengthMm: labelWidthMm, reversed: horizontalReversed, fromPx: RULER_SIZE, toPx: canvasWidth },
    y: { originPx: labelOffsetY, lengthMm: labelHeightMm, reversed: verticalReversed, fromPx: RULER_SIZE, toPx: canvasHeight },
  };

  const readout: GuideReadout = { scale, dpmm, unit };

  const place = (group: Konva.Group, key: "x" | "y", guides: AxisGuides) => {
    const cross = key === "x" ? "y" : "x";
    const extent = key === "x" ? "width" : "height";
    const band = group.findOne<Konva.Rect>(`.band-${key}`);
    band?.visible(!!guides.band);
    if (guides.band) band?.setAttrs({ [key]: guides.band.from, [extent]: guides.band.to - guides.band.from });
    const badges: Record<"near" | "far", Konva.Label | null> = { near: null, far: null };
    for (const side of SIDES) {
      const edge = guides[side];
      const line = group.findOne<Konva.Line>(`.line-${key}-${side}`);
      const badge = group.findOne<Konva.Label>(`.badge-${key}-${side}`);
      line?.visible(!!edge);
      badge?.visible(!!edge);
      if (!edge || !badge) continue;
      // A 1 px stroke stays crisp on a half pixel.
      line?.setAttr(key, Math.floor(edge.px) + 0.5);
      badge.getText().text(edge.text);
      badges[side] = badge;
    }
    const span = (side: "near" | "far") => {
      const edge = guides[side];
      const badge = badges[side];
      return edge && badge ? { edgePx: edge.px, size: badge[extent]() } : null;
    };
    // The x badges sit in the row under the top ruler. The y badges start below it.
    const rowHeight = (badges.near ?? badges.far)?.height() ?? 0;
    const lead = key === "y" ? rowHeight + BADGE_GAP : 0;
    const at = badgeOffsets(span("near"), span("far"), { ...axes[key], fromPx: axes[key].fromPx + lead }, BADGE_GAP);
    for (const side of SIDES) {
      const offset = at[side];
      if (offset !== null) badges[side]?.setAttrs({ [key]: offset, [cross]: RULER_SIZE + BADGE_GAP });
    }
  };

  useImperativeHandle(ref, () => ({
    show: (bounds, sync = false) => {
      const group = groupRef.current;
      if (!group) return;
      // beforeDraw calls this on every frame. An unchanged selection skips the redraw.
      const signature = JSON.stringify([bounds, axes, readout]);
      if (signature === drawnRef.current) return;
      drawnRef.current = signature;
      group.visible(!!bounds);
      if (bounds) {
        place(group, "x", axisGuides(bounds.minX, bounds.maxX, axes.x, readout));
        place(group, "y", axisGuides(bounds.minY, bounds.maxY, axes.y, readout));
      }
      const layer = group.getLayer();
      if (sync) layer?.draw();
      else layer?.batchDraw();
    },
  }));

  return (
    <Group ref={groupRef} visible={false} listening={false}>
      <Rect name="band-x" y={0} height={RULER_SIZE} fill={colors.selection} opacity={0.3} />
      <Rect name="band-y" x={0} width={RULER_SIZE} fill={colors.selection} opacity={0.3} />
      {AXES.flatMap((key) =>
        SIDES.map((side) => (
          <Line
            key={`${key}-${side}`}
            name={`line-${key}-${side}`}
            points={key === "x" ? [0, RULER_SIZE, 0, canvasHeight] : [RULER_SIZE, 0, canvasWidth, 0]}
            stroke={colors.selection}
            strokeWidth={1}
            dash={[4, 3]}
          />
        )),
      )}
      {AXES.flatMap((key) =>
        SIDES.map((side) => (
          <Label key={`${key}-${side}`} name={`badge-${key}-${side}`}>
            <Tag fill={colors.selection} cornerRadius={3} />
            <Text fill="#ffffff" fontSize={9} fontFamily={RULER_FONT} padding={3} />
          </Label>
        )),
      )}
    </Group>
  );
}
