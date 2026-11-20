import { useEffect, useEffectEvent, useRef, useState } from "react";
import type Konva from "konva";
import { useLabelStore } from "../../../store/labelStore";
import { RULER_SIZE } from "../Ruler";
import { RULER_STRIP_LEFT, RULER_STRIP_TOP } from "../rulerGuideLayout";
import {
  guideNear,
  guidesAfterDrop,
  guidesAfterEdit,
  guideToStage,
  type RulerGuide,
  type RulerGuides,
  type RulerGuideView,
  type StageRulerGuide,
} from "../../../lib/rulerGuides";

/** How far from a guide's line a press still grabs it. */
const GRAB_PX = 4;
/** How far a grabbed guide travels before the press counts as a drag. */
const DRAG_PX = 3;

interface Draft extends StageRulerGuide {
  /** The guide being moved, absent while a new guide comes out of the ruler. */
  moving?: RulerGuide;
}

interface Dragging extends Draft {
  kind: "dragging";
  /** False while the press may still be a click, which leaves a guide where it is. */
  moved: boolean;
  /** Pointer offset from the line at the press, so a grabbed guide does not jump. */
  grabOffset: number;
}

type Gesture = { kind: "idle"; hovered?: RulerGuide } | Dragging | { kind: "editing"; guide: RulerGuide };

const IDLE: Gesture = { kind: "idle" };

interface Options {
  containerRef: React.RefObject<HTMLDivElement | null>;
  guides: RulerGuides;
  view: RulerGuideView;
  dpmm: number;
  canvasWidth: number;
  canvasHeight: number;
  /** True for the stage and the label paper. */
  isBare: (target: Konva.Node) => boolean;
  spaceDown: boolean;
  editorFrozen: boolean;
}

type StageMouseEvent = Konva.KonvaEventObject<MouseEvent>;

function rulerCrossing(target: Konva.Node, pos: { x: number; y: number }): StageRulerGuide | undefined {
  if (target.name() === RULER_STRIP_TOP) return { vertical: true, px: pos.x };
  if (target.name() === RULER_STRIP_LEFT) return { vertical: false, px: pos.y };
  return undefined;
}

export interface RulerGuideGestures {
  draft: Draft | null;
  hovered: RulerGuide | null;
  editing: RulerGuide | null;
  cursor: string | undefined;
  /** True when the press started a guide drag, so no other gesture takes it. */
  onStageMouseDown: (e: StageMouseEvent) => boolean;
  onStageMouseMove: (e: StageMouseEvent) => void;
  onStageMouseLeave: () => void;
  onStageDblClick: (e: StageMouseEvent) => void;
  /** Null leaves the edited guide where it is. */
  endEdit: (at: StageRulerGuide | null) => void;
  /** True once for the stage click that ends a guide drag. */
  consumeDidDrag: () => boolean;
}

/** Guides come out of a ruler, move by their line or mark, take a typed position and go when dropped back on a ruler or off the canvas. */
export function useRulerGuideGestures({
  containerRef,
  guides,
  view,
  dpmm,
  canvasWidth,
  canvasHeight,
  isBare,
  spaceDown,
  editorFrozen,
}: Options): RulerGuideGestures {
  const [gesture, setGesture] = useState<Gesture>(IDLE);
  const didDragRef = useRef(false);
  const setRulerGuides = useLabelStore((s) => s.setRulerGuides);

  // A frozen editor or a removed guide drops the hover and the edit of that guide.
  const standing = (guide: RulerGuide | undefined) => (guide && !editorFrozen && guides[guide.axis].includes(guide.mm) ? guide : null);
  const draft = gesture.kind === "dragging" && !editorFrozen && (!gesture.moving || standing(gesture.moving)) ? gesture : null;
  const hovered = gesture.kind === "idle" ? standing(gesture.hovered) : null;
  const editing = gesture.kind === "editing" ? standing(gesture.guide) : null;
  const grabbable = draft ?? (hovered && guideToStage(hovered, view));
  // The field goes with its guide. Without this a guide that later lands on the same position would open the field again.
  if (gesture.kind === "editing" && !editing) setGesture(IDLE);

  const lineUnder = (e: MouseEvent, from: Dragging): StageRulerGuide | null => {
    const cr = containerRef.current?.getBoundingClientRect();
    if (!cr) return null;
    return { vertical: from.vertical, px: (from.vertical ? e.clientX - cr.left : e.clientY - cr.top) - from.grabOffset };
  };

  // An object under the pointer keeps the press, so a guide is taken on a ruler or where the canvas is bare.
  const crossingsAt = (target: Konva.Node, pos: { x: number; y: number }): StageRulerGuide[] => {
    const onRuler = rulerCrossing(target, pos);
    if (onRuler) return [onRuler];
    const onCanvas = isBare(target) && pos.x >= RULER_SIZE && pos.y >= RULER_SIZE;
    return onCanvas ? [{ vertical: true, px: pos.x }, { vertical: false, px: pos.y }] : [];
  };

  const guideUnder = (e: StageMouseEvent) => {
    const pos = e.target.getStage()?.getPointerPosition();
    return pos ? guideNear(guides, crossingsAt(e.target, pos), view, GRAB_PX) : undefined;
  };

  // The double-click that opens the field arrives before the release that ends its drag.
  const endDrag = () => setGesture((now) => (now.kind === "dragging" ? IDLE : now));

  const onMove = useEffectEvent((e: MouseEvent) => {
    if (gesture.kind !== "dragging") return;
    // A release the window never saw, as after a switch to another app, leaves no button down.
    if ((e.buttons & 1) === 0) {
      endDrag();
      return;
    }
    const line = lineUnder(e, gesture);
    if (!line) return;
    const moved = gesture.moved || Math.abs(line.px - gesture.px) >= DRAG_PX;
    if (moved) setGesture((now) => (now.kind === "dragging" ? { ...now, px: line.px, moved } : now));
  });

  const onUp = useEffectEvent((e: MouseEvent) => {
    if (e.button !== 0 || gesture.kind !== "dragging") return;
    const line = lineUnder(e, gesture);
    endDrag();
    if (!line || !draft || !gesture.moved) return;
    setRulerGuides(guidesAfterDrop(guides, gesture.moving, line, view, dpmm, { from: RULER_SIZE, width: canvasWidth, height: canvasHeight }));
  });

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") endDrag();
  });

  const dragging = gesture.kind === "dragging";
  // On the window, so a drag that leaves the canvas still ends where the pointer is.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => onMove(e);
    const up = (e: MouseEvent) => onUp(e);
    const key = (e: KeyboardEvent) => onKeyDown(e);
    // Keeps the drag from selecting page text once it leaves the canvas.
    const select = (e: Event) => e.preventDefault();
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key);
    window.addEventListener("selectstart", select);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("selectstart", select);
    };
  }, [dragging]);

  const onStageMouseDown = (e: StageMouseEvent) => {
    // A release over a shape fires no stage click, so the flag would carry into the next press.
    didDragRef.current = false;
    const pos = e.target.getStage()?.getPointerPosition();
    // With the position field open a press grabs no guide. The blur it causes ends the edit.
    if (e.evt.button !== 0 || spaceDown || editorFrozen || editing || !pos) return false;
    const onRuler = rulerCrossing(e.target, pos);
    const moving = guideNear(guides, crossingsAt(e.target, pos), view, GRAB_PX);
    if (moving) {
      const line = guideToStage(moving, view);
      setGesture({ kind: "dragging", ...line, moving, moved: false, grabOffset: (line.vertical ? pos.x : pos.y) - line.px });
    } else if (onRuler) {
      // A ruler shows the marks of the guides that cross it. A press elsewhere starts a guide along it.
      const vertical = !onRuler.vertical;
      setGesture({ kind: "dragging", vertical, px: vertical ? pos.x : pos.y, moved: true, grabOffset: 0 });
    } else {
      return false;
    }
    didDragRef.current = true;
    return true;
  };

  const onStageMouseMove = (e: StageMouseEvent) => {
    if (gesture.kind !== "idle") return;
    const under = e.evt.buttons === 0 && !spaceDown ? guideUnder(e) : undefined;
    if (under?.axis !== gesture.hovered?.axis || under?.mm !== gesture.hovered?.mm) setGesture({ kind: "idle", hovered: under });
  };

  const onStageMouseLeave = () => setGesture((now) => (now.kind === "idle" ? IDLE : now));

  const onStageDblClick = (e: StageMouseEvent) => {
    // Konva's double-click has no distance check, so its second press may have dragged the guide away.
    const dragged = gesture.kind === "dragging" && gesture.moved;
    const guide = editorFrozen || dragged ? undefined : guideUnder(e);
    if (guide) setGesture({ kind: "editing", guide });
  };

  const endEdit = (at: StageRulerGuide | null) => {
    if (editing && at) setRulerGuides(guidesAfterEdit(guides, editing, at, view, dpmm));
    setGesture((now) => (now.kind === "editing" ? IDLE : now));
  };

  const consumeDidDrag = () => {
    const did = didDragRef.current;
    didDragRef.current = false;
    return did;
  };

  return {
    draft,
    hovered,
    editing,
    cursor: grabbable ? (grabbable.vertical ? "col-resize" : "row-resize") : undefined,
    onStageMouseDown,
    onStageMouseMove,
    onStageMouseLeave,
    onStageDblClick,
    endEdit,
    consumeDidDrag,
  };
}
