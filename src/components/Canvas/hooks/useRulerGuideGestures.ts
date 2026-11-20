import { useEffect, useEffectEvent, useRef, useState } from "react";
import type Konva from "konva";
import { useLabelStore } from "../../../store/labelStore";
import { RULER_SIZE } from "../Ruler";
import { RULER_STRIP_LEFT, RULER_STRIP_TOP } from "../rulerGuideLayout";
import { guideNear, guidesAfterDrop, guideToStage, type RulerGuide, type RulerGuideView, type StageRulerGuide } from "../../../lib/rulerGuides";

/** How far from a guide's mark a press still grabs the guide. */
const GRAB_PX = 4;

interface Draft extends StageRulerGuide {
  /** The guide being moved, absent while a new guide comes out of the ruler. */
  moving?: RulerGuide;
}

interface Drag extends Draft {
  /** Pointer offset from the line at the press, so a grabbed guide does not jump. */
  grabOffset: number;
}

interface Options {
  containerRef: React.RefObject<HTMLDivElement | null>;
  view: RulerGuideView;
  dpmm: number;
  canvasWidth: number;
  canvasHeight: number;
  spaceDown: boolean;
  editorFrozen: boolean;
}

export interface RulerGuideGestures {
  draft: Draft | null;
  /** True when the press started a guide drag, so no other gesture takes it. */
  onStageMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => boolean;
  /** True once for the stage click that ends a guide drag. */
  consumeDidDrag: () => boolean;
}

/** Guides come out of a ruler, move by their mark and go when dropped back on a ruler or off the canvas. */
export function useRulerGuideGestures({ containerRef, view, dpmm, canvasWidth, canvasHeight, spaceDown, editorFrozen }: Options): RulerGuideGestures {
  const [drag, setDrag] = useState<Drag | null>(null);
  const didDragRef = useRef(false);

  const lineUnder = (e: MouseEvent, from: Drag): StageRulerGuide | null => {
    const cr = containerRef.current?.getBoundingClientRect();
    if (!cr) return null;
    return { vertical: from.vertical, px: (from.vertical ? e.clientX - cr.left : e.clientY - cr.top) - from.grabOffset };
  };

  const onMove = useEffectEvent((e: MouseEvent) => {
    // A release the window never saw, as after a switch to another app, leaves no button down.
    if ((e.buttons & 1) === 0) {
      setDrag(null);
      return;
    }
    const line = drag && lineUnder(e, drag);
    if (drag && line) setDrag({ ...drag, px: line.px });
  });

  const onUp = useEffectEvent((e: MouseEvent) => {
    if (e.button !== 0) return;
    const line = drag && lineUnder(e, drag);
    setDrag(null);
    if (!drag || !line || editorFrozen) return;
    const { rulerGuides, setRulerGuides } = useLabelStore.getState();
    setRulerGuides(guidesAfterDrop(rulerGuides, drag.moving, line, view, dpmm, { from: RULER_SIZE, width: canvasWidth, height: canvasHeight }));
  });

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") setDrag(null);
  });

  const dragging = drag !== null;
  // On the window, so a drag that leaves the canvas still ends where the pointer is.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => onMove(e);
    const up = (e: MouseEvent) => onUp(e);
    const key = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key);
    };
  }, [dragging]);

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // A release over a shape fires no stage click, so the flag would carry into the next press.
    didDragRef.current = false;
    const strip = e.target.name();
    const pos = e.target.getStage()?.getPointerPosition();
    if (e.evt.button !== 0 || spaceDown || editorFrozen || !pos) return false;
    if (strip !== RULER_STRIP_TOP && strip !== RULER_STRIP_LEFT) return false;
    // A ruler shows the marks of the guides that cross it. A press elsewhere starts a guide along it.
    const crossing: StageRulerGuide = strip === RULER_STRIP_TOP ? { vertical: true, px: pos.x } : { vertical: false, px: pos.y };
    const moving = guideNear(useLabelStore.getState().rulerGuides, crossing, view, GRAB_PX);
    if (moving) {
      const px = guideToStage(moving, view).px;
      setDrag({ vertical: crossing.vertical, px, moving, grabOffset: crossing.px - px });
    } else {
      setDrag({ vertical: !crossing.vertical, px: crossing.vertical ? pos.y : pos.x, grabOffset: 0 });
    }
    // Keeps the drag from selecting page text once it leaves the canvas.
    e.evt.preventDefault();
    didDragRef.current = true;
    return true;
  };

  const consumeDidDrag = () => {
    const did = didDragRef.current;
    didDragRef.current = false;
    return did;
  };

  return { draft: editorFrozen ? null : drag, onStageMouseDown, consumeDidDrag };
}
