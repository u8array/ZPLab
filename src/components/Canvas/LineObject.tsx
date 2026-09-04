import { useEffect, useRef, useState } from "react";
import { useNodeDraggable } from "./hooks/useNodeDraggable";
import { Group, Line as KLine, Rect } from "react-konva";
import type Konva from "konva";
import type { LabelObject } from "@zplab/core/types/Group";
import { dotsToPx, pxToDots, pxToDotsExact } from "@zplab/core/lib/coordinates";
import {
  constrainLine,
  centeredEndpointCommit,
  type ConstrainMode,
} from "../../lib/lineConstrain";
import { useColorScheme } from "../../hooks/useColorScheme";
import {
  computePointSnap,
  computeResizeSnap,
  type SnapRect,
} from "../../lib/snapGuides";
import { diagonalPolygonPoints } from "@zplab/core/lib/shapeGeometry";
import { selectionHandlers, type KonvaObjectProps, MIN_HIT_STROKE_PX, lineHandlesNodeId, lineRootNodeId } from "./konvaObjectProps";
import { LINE_HANDLE_NAME } from "./altClickCycle";


const HANDLE_VISIBLE_SIZE = 7;
const HANDLE_HIT_SIZE = 14;

/** Two parallel selection strokes offset perpendicular to the body,
 *  keeping the body's difference-blend (reverse ^LRY) intact. */
function LineSelectionOutline({
  x1, y1, x2, y2,
  bodyStrokeWidth,
  color,
}: {
  x1: number; y1: number; x2: number; y2: number;
  bodyStrokeWidth: number;
  color: string;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const off = bodyStrokeWidth / 2 + 1.5;
  const px = (-dy / len) * off;
  const py = (dx / len) * off;
  return (
    <>
      <KLine
        points={[x1 + px, y1 + py, x2 + px, y2 + py]}
        stroke={color}
        strokeWidth={1}
        lineCap="butt"
        listening={false}
      />
      <KLine
        points={[x1 - px, y1 - py, x2 - px, y2 - py]}
        stroke={color}
        strokeWidth={1}
        lineCap="butt"
        listening={false}
      />
    </>
  );
}

type LineLabelObject = Extract<LabelObject, { type: "line" }>;
type Props = Omit<KonvaObjectProps, "obj"> & { obj: LineLabelObject };

export function LineObject({
  obj,
  scale,
  dpmm,
  offsetX,
  offsetY,
  isSelected,
  onSelect,
  onChange,
  snap,
  dragHandlers,
  registerMover,
  getOthersSnapshot,
  labelRect,
  setGuides,
  snapBypassRef,
}: Props) {
  const p = obj.props;
  const colors = useColorScheme();
  const draggable = useNodeDraggable(obj);
  // Absolute stage coords; Group has no offset (avoids draggable conflict).
  const x1 = offsetX + dotsToPx(obj.x, scale, dpmm);
  const y1 = offsetY + dotsToPx(obj.y, scale, dpmm);
  const rad = (p.angle * Math.PI) / 180;
  const lenPx = dotsToPx(p.length, scale, dpmm);
  const x2 = x1 + lenPx * Math.cos(rad);
  const y2 = y1 + lenPx * Math.sin(rad);

  // Reverse (^LRY): difference-blend body kept even while selected so the
  // inversion stays visible; selection halo is a separate overlay.
  const isReverse = !!p.reverse;
  const strokeColor = isReverse
    ? "#ffffff"
    : p.color === "B"
      ? "#000000"
      : "#cccccc";
  const [liveThicknessDots, setLiveThicknessDots] = useState<number | null>(null);
  const effectiveThicknessDots = liveThicknessDots ?? p.thickness;
  const rawStrokePx = Math.max(dotsToPx(effectiveThicknessDots, scale, dpmm), 1);

  // Geometry mirrors shapeRender.ts (axis-aligned -> ^GB band, diagonal
  // -> ^GD parallelogram). Axis-aligned check uses live endpoints, not
  // p.angle (which only updates on dragEnd) to avoid release-jump.

  const [livePt1, setLivePt1] = useState<{ x: number; y: number } | null>(null);
  const [livePt2, setLivePt2] = useState<{ x: number; y: number } | null>(null);
  // Alt of the last drag-move: a keyup fires no drag event, so the commit reads
  // this (not e.evt.altKey at mouse-up) to match the last centered preview.
  const lastEndpointAlt = useRef(false);

  const [dragDelta, setDragDelta] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const dx = dragDelta.x;
  const dy = dragDelta.y;

  // Whole-line body drag is driven by the central drag controller; it can't
  // move our node directly (the visible line is state-driven), so we register a
  // mover that shifts dragDelta. Endpoint/thickness handles stay local.
  useEffect(() => {
    if (!registerMover) return;
    registerMover(obj.id, (lx, ly) => setDragDelta({ x: lx, y: ly }));
    return () => registerMover(obj.id, null);
  }, [obj.id, registerMover]);

  // Visual endpoints: handle-drag overrides whole-line delta
  const dispX1 = livePt1?.x ?? x1 + dx;
  const dispY1 = livePt1?.y ?? y1 + dy;
  const dispX2 = livePt2?.x ?? x2 + dx;
  const dispY2 = livePt2?.y ?? y2 + dy;

  // Cap visual stroke at live length so the band stays within the
  // t <= length invariant we commit to on dragEnd.
  const visualLenPx = Math.hypot(dispX2 - dispX1, dispY2 - dispY1);
  const lineStrokeWidth = Math.min(rawStrokePx, visualLenPx);
  const halfStrokePx = lineStrokeWidth / 2;

  // <0.5 px epsilon for float residue on constrainLine's 45-step snap.
  const ddxDisp = dispX2 - dispX1;
  const ddyDisp = dispY2 - dispY1;
  const isHorizontal = Math.abs(ddyDisp) < 0.5;
  const isVertical = Math.abs(ddxDisp) < 0.5;
  const isAxisAligned = isHorizontal || isVertical;
  const visualShiftX = isVertical ? halfStrokePx : 0;
  const visualShiftY = isHorizontal ? halfStrokePx : 0;

  // Shift = explicit 45-step lock; else Figma-style auto-snap (+-5deg).
  const resolveMode = (shift: boolean): ConstrainMode =>
    shift ? "shift" : "autoSnap";

  // Cached per-drag to avoid re-querying every Konva clientRect per frame.
  const othersSnapshotRef = useRef<SnapRect[] | null>(null);

  /** Object-snap for an endpoint; uses parent transform so it stays
   *  correct in rotated views. Skipped while Shift constrains the angle
   *  (snap would fight the 45-degree lock) or Ctrl/Cmd bypasses snapping. */
  function snapEndpoint(
    localPx: { x: number; y: number },
    shift: boolean,
    parent: Konva.Node | null,
  ): { x: number; y: number } {
    if (shift || snapBypassRef?.current || !getOthersSnapshot || !labelRect || !setGuides || !parent) {
      setGuides?.([]);
      return localPx;
    }
    if (othersSnapshotRef.current === null) {
      othersSnapshotRef.current = getOthersSnapshot(obj.id);
    }
    const transform = parent.getAbsoluteTransform();
    const stagePx = transform.point(localPx);
    const result = computePointSnap(
      stagePx,
      othersSnapshotRef.current,
      undefined,
      labelRect,
    );
    setGuides(result.guides);
    const back = transform.copy().invert().point({ x: result.x, y: result.y });
    return { x: back.x, y: back.y };
  }

  function clearSnap() {
    othersSnapshotRef.current = null;
    setGuides?.([]);
  }

  /** Resize-snap for thickness side-handle; no-op on diagonals, rotated
   *  views, Shift, or the Ctrl/Cmd bypass. */
  function snapThickness(
    rawT: number,
    shift: boolean,
    parent: Konva.Node | null,
  ): number {
    const absRot = parent ? Math.abs(parent.getAbsoluteRotation() % 360) : 0;
    const rotated = absRot > 0.1 && absRot < 359.9;
    if (
      !isAxisAligned ||
      shift ||
      snapBypassRef?.current ||
      rotated ||
      !getOthersSnapshot ||
      !labelRect ||
      !setGuides ||
      !parent
    ) {
      setGuides?.([]);
      return rawT;
    }
    if (othersSnapshotRef.current === null) {
      othersSnapshotRef.current = getOthersSnapshot(obj.id);
    }
    const transform = parent.getAbsoluteTransform();
    const thicknessPx = Math.max(dotsToPx(rawT, scale, dpmm), 1);
    // Map band bbox local -> stage to match others snapshot frame.
    const localBand = isHorizontal
      ? {
          x: Math.min(dispX1, dispX2),
          y: lineCenterY,
          width: visualLenPx,
          height: thicknessPx,
        }
      : {
          x: lineCenterX,
          y: Math.min(dispY1, dispY2),
          width: thicknessPx,
          height: visualLenPx,
        };
    const tl = transform.point({ x: localBand.x, y: localBand.y });
    const br = transform.point({
      x: localBand.x + localBand.width,
      y: localBand.y + localBand.height,
    });
    const stageBand: SnapRect = {
      id: obj.id,
      x: Math.min(tl.x, br.x),
      y: Math.min(tl.y, br.y),
      width: Math.abs(br.x - tl.x),
      height: Math.abs(br.y - tl.y),
    };
    const activeEdges = isHorizontal
      ? { top: false, bottom: true, left: false, right: false }
      : { top: false, bottom: false, left: false, right: true };
    const result = computeResizeSnap(
      stageBand,
      othersSnapshotRef.current,
      activeEdges,
      undefined,
      labelRect,
      labelRect,
    );
    const snappedExtPx = isHorizontal ? result.height : result.width;
    const cappedT = Math.min(
      p.length,
      Math.max(1, Math.round(pxToDots(snappedExtPx, scale, dpmm))),
    );
    // Clear guide when the t<=length cap shortened the band past the snap target.
    const cappedExtPx = dotsToPx(cappedT, scale, dpmm);
    setGuides(Math.abs(cappedExtPx - snappedExtPx) < 0.5 ? result.guides : []);
    return cappedT;
  }

  /** axis-constraint -> object-snap -> derived geometry. */
  function endpointDrag(
    cursorXPx: number,
    cursorYPx: number,
    anchorXDots: number,
    anchorYDots: number,
    forStart: boolean,
    shift: boolean,
    parent: Konva.Node | null,
  ) {
    const projected = project(cursorXPx, cursorYPx, anchorXDots, anchorYDots, forStart, shift);
    const snappedPx = snapEndpoint(projected.movingPx, shift, parent);
    const snappedDotX = pxToDots(snappedPx.x - offsetX, scale, dpmm);
    const snappedDotY = pxToDots(snappedPx.y - offsetY, scale, dpmm);
    const dxDots = forStart ? anchorXDots - snappedDotX : snappedDotX - anchorXDots;
    const dyDots = forStart ? anchorYDots - snappedDotY : snappedDotY - anchorYDots;
    const g = constrainLine(dxDots, dyDots, "free");
    return {
      length: g.length,
      angle: g.angle,
      movingDotX: snappedDotX,
      movingDotY: snappedDotY,
      movingPx: snappedPx,
    };
  }

  // forStart=true: dragging START handle; geometry is new-start -> fixed-end.
  function project(
    cursorXPx: number,
    cursorYPx: number,
    anchorXDots: number,
    anchorYDots: number,
    forStart: boolean,
    shift: boolean,
  ) {
    const cursorXDots = snap(pxToDots(cursorXPx - offsetX, scale, dpmm));
    const cursorYDots = snap(pxToDots(cursorYPx - offsetY, scale, dpmm));
    // dx/dy is always start->end; flip for start-handle drag.
    const inputDx = forStart
      ? anchorXDots - cursorXDots
      : cursorXDots - anchorXDots;
    const inputDy = forStart
      ? anchorYDots - cursorYDots
      : cursorYDots - anchorYDots;
    const g = constrainLine(inputDx, inputDy, resolveMode(shift));
    const movingDotX = forStart ? anchorXDots - g.dx : anchorXDots + g.dx;
    const movingDotY = forStart ? anchorYDots - g.dy : anchorYDots + g.dy;
    return {
      length: g.length,
      angle: g.angle,
      movingDotX,
      movingDotY,
      movingPx: {
        x: offsetX + dotsToPx(movingDotX, scale, dpmm),
        y: offsetY + dotsToPx(movingDotY, scale, dpmm),
      },
    };
  }

  // Garbage for axis-aligned input; only consumed in the !isAxisAligned branch.
  const diagPoints = diagonalPolygonPoints(
    dispX1, dispY1, dispX2, dispY2, lineStrokeWidth,
  );

  // Anchored to band's far long edge; perpendicular drag axis matches
  // ^GB / ^GD extrusion.
  const lineCenterX = (dispX1 + dispX2) / 2;
  const lineCenterY = (dispY1 + dispY2) / 2;
  const thickHandleX =
    lineCenterX + (isHorizontal ? 0 : lineStrokeWidth);
  const thickHandleY =
    lineCenterY + (isHorizontal ? lineStrokeWidth : 0);

  // Alt-centered endpoint drag: the dragged point is snapped normally (its real
  // opposite endpoint as anchor, no drift), then both endpoints mirror around
  // the fixed midpoint. endpointSumDot = start+end = 2*centre.
  const endpointSumDot = {
    x: obj.x + pxToDotsExact(x2 - offsetX, scale, dpmm),
    y: obj.y + pxToDotsExact(y2 - offsetY, scale, dpmm),
  };
  const mirrorPx = (pt: { x: number; y: number }) => ({
    x: x1 + x2 - pt.x,
    y: y1 + y2 - pt.y,
  });

  return (
    <Group id={lineRootNodeId(obj.id)}>
      {isAxisAligned ? (
        <>
          <KLine
            points={[
              dispX1 + visualShiftX,
              dispY1 + visualShiftY,
              dispX2 + visualShiftX,
              dispY2 + visualShiftY,
            ]}
            stroke={strokeColor}
            strokeWidth={lineStrokeWidth}
            strokeScaleEnabled={false}
            lineCap="butt"
            listening={false}
            globalCompositeOperation={isReverse ? "difference" : "source-over"}
          />
          {isSelected && (
            <LineSelectionOutline
              x1={dispX1 + visualShiftX}
              y1={dispY1 + visualShiftY}
              x2={dispX2 + visualShiftX}
              y2={dispY2 + visualShiftY}
              bodyStrokeWidth={lineStrokeWidth}
              color={colors.selection}
            />
          )}
        </>
      ) : (
        <>
          {/* ^GD: filled parallelogram (not stroke) matches Labelary geometry. */}
          <KLine
            points={diagPoints}
            closed
            fill={strokeColor}
            listening={false}
            globalCompositeOperation={isReverse ? "difference" : "source-over"}
          />
          {isSelected && (
            <KLine
              points={diagPoints}
              closed
              stroke={colors.selection}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              fill="transparent"
              listening={false}
            />
          )}
        </>
      )}
      {/* Hit area carries the id so Stage snap can find this node. */}
      <KLine
        id={obj.id}
        points={[
          x1 + visualShiftX,
          y1 + visualShiftY,
          x2 + visualShiftX,
          y2 + visualShiftY,
        ]}
        stroke="transparent"
        strokeWidth={Math.max(lineStrokeWidth, MIN_HIT_STROKE_PX)}
        strokeScaleEnabled={false}
        draggable={draggable}
        {...selectionHandlers(onSelect)}
        {...dragHandlers}
      />
      {isSelected && (
        <Group id={lineHandlesNodeId(obj.id)}>
          {/* Start point: dragging moves origin; end stays fixed. */}
          <Rect
            x={(livePt1?.x ?? x1 + dx) - HANDLE_HIT_SIZE / 2}
            y={(livePt1?.y ?? y1 + dy) - HANDLE_HIT_SIZE / 2}
            width={HANDLE_HIT_SIZE}
            height={HANDLE_HIT_SIZE}
            fill="transparent"
            name={LINE_HANDLE_NAME}
            draggable={draggable}
            onDragMove={(e) => {
              const alt = e.evt.altKey;
              const endDotX = pxToDots(x2 - offsetX, scale, dpmm);
              const endDotY = pxToDots(y2 - offsetY, scale, dpmm);
              const r = endpointDrag(
                e.target.x() + HANDLE_HIT_SIZE / 2,
                e.target.y() + HANDLE_HIT_SIZE / 2,
                endDotX,
                endDotY,
                true,
                e.evt.shiftKey,
                e.target.getParent(),
              );
              e.target.position({
                x: r.movingPx.x - HANDLE_HIT_SIZE / 2,
                y: r.movingPx.y - HANDLE_HIT_SIZE / 2,
              });
              setLivePt1(r.movingPx);
              setLivePt2(alt ? mirrorPx(r.movingPx) : null);
              lastEndpointAlt.current = alt;
            }}
            onDragEnd={(e) => {
              const alt = lastEndpointAlt.current;
              const cursor = livePt1 ?? {
                x: e.target.x() + HANDLE_HIT_SIZE / 2,
                y: e.target.y() + HANDLE_HIT_SIZE / 2,
              };
              e.target.position({
                x: x1 + dx - HANDLE_HIT_SIZE / 2,
                y: y1 + dy - HANDLE_HIT_SIZE / 2,
              });
              setLivePt1(null);
              setLivePt2(null);
              const endDotX = pxToDots(x2 - offsetX, scale, dpmm);
              const endDotY = pxToDots(y2 - offsetY, scale, dpmm);
              const r = endpointDrag(
                cursor.x,
                cursor.y,
                endDotX,
                endDotY,
                true,
                e.evt.shiftKey,
                e.target.getParent(),
              );
              clearSnap();
              // Cap thickness to length; t > length triggers ^GB promotion (t x t).
              if (alt) {
                const c = centeredEndpointCommit(
                  {
                    x: pxToDotsExact(r.movingPx.x - offsetX, scale, dpmm),
                    y: pxToDotsExact(r.movingPx.y - offsetY, scale, dpmm),
                  },
                  endpointSumDot,
                  true,
                );
                onChange({
                  x: c.x,
                  y: c.y,
                  props: { length: c.length, angle: c.angle, thickness: Math.min(p.thickness, c.length) },
                });
              } else {
                onChange({
                  x: r.movingDotX,
                  y: r.movingDotY,
                  props: { length: r.length, angle: r.angle, thickness: Math.min(p.thickness, r.length) },
                });
              }
            }}
          />
          <Rect
            x={(livePt1?.x ?? x1 + dx) - HANDLE_VISIBLE_SIZE / 2}
            y={(livePt1?.y ?? y1 + dy) - HANDLE_VISIBLE_SIZE / 2}
            width={HANDLE_VISIBLE_SIZE}
            height={HANDLE_VISIBLE_SIZE}
            fill="white"
            stroke={colors.selection}
            strokeWidth={1}
            listening={false}
          />
          {/* End point: dragging changes length & angle */}
          <Rect
            x={(livePt2?.x ?? x2 + dx) - HANDLE_HIT_SIZE / 2}
            y={(livePt2?.y ?? y2 + dy) - HANDLE_HIT_SIZE / 2}
            width={HANDLE_HIT_SIZE}
            height={HANDLE_HIT_SIZE}
            fill="transparent"
            name={LINE_HANDLE_NAME}
            draggable={draggable}
            onDragMove={(e) => {
              const alt = e.evt.altKey;
              const r = endpointDrag(
                e.target.x() + HANDLE_HIT_SIZE / 2,
                e.target.y() + HANDLE_HIT_SIZE / 2,
                obj.x,
                obj.y,
                false,
                e.evt.shiftKey,
                e.target.getParent(),
              );
              e.target.position({
                x: r.movingPx.x - HANDLE_HIT_SIZE / 2,
                y: r.movingPx.y - HANDLE_HIT_SIZE / 2,
              });
              setLivePt2(r.movingPx);
              setLivePt1(alt ? mirrorPx(r.movingPx) : null);
              lastEndpointAlt.current = alt;
            }}
            onDragEnd={(e) => {
              const alt = lastEndpointAlt.current;
              const cursor = livePt2 ?? {
                x: e.target.x() + HANDLE_HIT_SIZE / 2,
                y: e.target.y() + HANDLE_HIT_SIZE / 2,
              };
              e.target.position({
                x: x2 + dx - HANDLE_HIT_SIZE / 2,
                y: y2 + dy - HANDLE_HIT_SIZE / 2,
              });
              setLivePt2(null);
              setLivePt1(null);
              const r = endpointDrag(
                cursor.x,
                cursor.y,
                obj.x,
                obj.y,
                false,
                e.evt.shiftKey,
                e.target.getParent(),
              );
              clearSnap();
              if (alt) {
                const c = centeredEndpointCommit(
                  {
                    x: pxToDotsExact(r.movingPx.x - offsetX, scale, dpmm),
                    y: pxToDotsExact(r.movingPx.y - offsetY, scale, dpmm),
                  },
                  endpointSumDot,
                  false,
                );
                onChange({
                  x: c.x,
                  y: c.y,
                  props: { length: c.length, angle: c.angle, thickness: Math.min(p.thickness, c.length) },
                });
              } else {
                onChange({
                  props: { length: r.length, angle: r.angle, thickness: Math.min(p.thickness, r.length) },
                });
              }
            }}
          />
          <Rect
            x={(livePt2?.x ?? x2 + dx) - HANDLE_VISIBLE_SIZE / 2}
            y={(livePt2?.y ?? y2 + dy) - HANDLE_VISIBLE_SIZE / 2}
            width={HANDLE_VISIBLE_SIZE}
            height={HANDLE_VISIBLE_SIZE}
            fill="white"
            stroke={colors.selection}
            strokeWidth={1}
            listening={false}
          />
          {/* Thickness handle, perpendicular drag; flip-on-overshoot deferred.
              No line-handle name: Alt has no centering role here, so an Alt+click
              should keep cycling rather than dead-click on the handle. */}
          <Rect
            x={thickHandleX - HANDLE_HIT_SIZE / 2}
            y={thickHandleY - HANDLE_HIT_SIZE / 2}
            width={HANDLE_HIT_SIZE}
            height={HANDLE_HIT_SIZE}
            fill="transparent"
            draggable={draggable}
            onDragMove={(e) => {
              const cursorX = e.target.x() + HANDLE_HIT_SIZE / 2;
              const cursorY = e.target.y() + HANDLE_HIT_SIZE / 2;
              const extPx = isHorizontal
                ? cursorY - lineCenterY
                : cursorX - lineCenterX;
              // Cap at p.length to avoid ^GB t > length promotion.
              const rawT = Math.min(
                p.length,
                Math.max(1, Math.round(pxToDots(extPx, scale, dpmm))),
              );
              const newT = snapThickness(
                rawT,
                e.evt.shiftKey,
                e.target.getParent(),
              );
              setLiveThicknessDots(newT);
              // Pin Rect to the clamped/snapped anchor so the handle stays on the band edge.
              const newStroke = Math.max(dotsToPx(newT, scale, dpmm), 1);
              e.target.position({
                x:
                  lineCenterX +
                  (isHorizontal ? 0 : newStroke) -
                  HANDLE_HIT_SIZE / 2,
                y:
                  lineCenterY +
                  (isHorizontal ? newStroke : 0) -
                  HANDLE_HIT_SIZE / 2,
              });
            }}
            onDragEnd={() => {
              const committed = liveThicknessDots;
              setLiveThicknessDots(null);
              clearSnap();
              if (committed !== null && committed !== p.thickness) {
                onChange({ props: { thickness: committed } });
              }
            }}
          />
          <Rect
            x={thickHandleX - HANDLE_VISIBLE_SIZE / 2}
            y={thickHandleY - HANDLE_VISIBLE_SIZE / 2}
            width={HANDLE_VISIBLE_SIZE}
            height={HANDLE_VISIBLE_SIZE}
            fill="white"
            stroke={colors.selection}
            strokeWidth={1}
            listening={false}
          />
        </Group>
      )}
    </Group>
  );
}
