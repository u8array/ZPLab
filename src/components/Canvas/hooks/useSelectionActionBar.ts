import { useLayoutEffect } from "react";
import type Konva from "konva";
import { RULER_SIZE } from "../Ruler";

export const ACTION_BAR_GAP_PX = 22;

export interface BarBounds { minX: number; minY: number; maxX: number; maxY: number }
/** Shared action-bar placement: centered over the selection, clamped to the
 *  canvas, flipped below when it would clip the ruler. */
export function actionBarPosition(
  sel: BarBounds,
  halfW: number,
  halfH: number,
  stageWidth: number,
  stageHeight: number,
): { x: number; y: number } {
  const minCx = RULER_SIZE + halfW;
  const maxCx = Math.max(minCx, stageWidth - halfW);
  const x = Math.min(Math.max((sel.minX + sel.maxX) / 2, minCx), maxCx);
  const aboveY = sel.minY - ACTION_BAR_GAP_PX - halfH;
  const belowY = sel.maxY + ACTION_BAR_GAP_PX + halfH;
  const y =
    aboveY - halfH < RULER_SIZE
      ? belowY + halfH <= stageHeight
        ? belowY
        : RULER_SIZE + halfH
      : aboveY;
  return { x, y };
}

interface Options {
  stageRef: React.RefObject<Konva.Stage | null>;
  attachableIds: string[];
  lockedLeafIds: string[];
  editorFrozen: boolean;
  /** True while a controller drag is live; the bar is translated by the drag
   *  delta instead. Re-reading client-rects here would lag, since only the
   *  grabbed node's matrices are freshly invalidated, not the siblings'. */
  dragActiveRef: React.RefObject<boolean>;
  /** Owned by LabelCanvas (so the drag onDelta can translate the bar live). */
  actionBarRef: React.RefObject<Konva.Group | null>;
  lockedFrameRef: React.RefObject<Konva.Group | null>;
  /** Selection bounds in stage px from objectBoundsDots (the optical box, incl.
   *  the ^GD diagonal overhang) so the rest position matches the drag center. */
  getBarBounds: () => BarBounds | null;
}

/**
 * Positions the floating selection action bar (centred above the selection,
 * flipped below when it would clip past the ruler, clamped horizontally) and an
 * amber outline per locked leaf (the transformer skips locked nodes). Imperative
 * via beforeDraw so the chrome tracks live node positions during drags, the same
 * timing useKonvaTransformer relies on.
 */
export function useSelectionActionBar({
  stageRef,
  attachableIds,
  lockedLeafIds,
  editorFrozen,
  dragActiveRef,
  actionBarRef,
  lockedFrameRef,
  getBarBounds,
}: Options) {
  useLayoutEffect(() => {
    if (editorFrozen || attachableIds.length === 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    // Object layer (shared by the bar and the selected nodes); grabbing the
    // layer, not a node, survives node mount timing.
    const layer = stage.getLayers()[0];
    // beforeDraw runs after Konva invalidates the cached transform matrices, so
    // getClientRect sees actual positions; dragmove/xChange read stale data and
    // trail one tick behind on snap-jumps.
    const update = () => {
      // During a controller drag the bar is translated by onDelta instead.
      if (dragActiveRef.current) return;
      // Optical bounds (objectBoundsDots), so the rest position matches the drag
      // center; the store is updated live during resize, so this also tracks it.
      const sel = getBarBounds();
      if (!sel) return;

      const bar = actionBarRef.current;
      if (bar) {
        const barRect = bar.getClientRect({ relativeTo: stage, skipShadow: true });
        bar.position(
          actionBarPosition(sel, barRect.width / 2, barRect.height / 2, stage.width(), stage.height()),
        );
      }

      // Per-leaf amber frames, mapped to lockedLeafIds in render order.
      const frames = lockedFrameRef.current?.getChildren();
      if (frames) {
        lockedLeafIds.forEach((id, i) => {
          const node = stage.findOne(`#${id}`);
          const rect = frames[i] as Konva.Rect | undefined;
          if (!node || !rect) return;
          const r = node.getClientRect({ relativeTo: stage, skipStroke: true });
          rect.position({ x: r.x, y: r.y });
          rect.size({ width: r.width, height: r.height });
        });
      }
    };
    update();
    layer?.on("beforeDraw.actionbar", update);
    return () => {
      layer?.off(".actionbar");
    };
  }, [stageRef, attachableIds, lockedLeafIds, editorFrozen, dragActiveRef, actionBarRef, lockedFrameRef, getBarBounds]);
}
