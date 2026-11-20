import { useLayoutEffect } from "react";
import Konva from "konva";
import type { SelectionGuidesHandle } from "../SelectionGuides";
import type { Bounds } from "../nodeRect";

interface Options {
  stageRef: React.RefObject<Konva.Stage | null>;
  guidesRef: React.RefObject<SelectionGuidesHandle | null>;
  /** While true, onDelta feeds the guides. */
  dragActiveRef: React.RefObject<boolean>;
  /** Visible selection frame in stage px, null without a selection. */
  getBounds: () => Bounds | null;
}

/** Keeps the selection guides on the selection frame, at rest and during a drag or resize. */
export function useSelectionGuides({ stageRef, guidesRef, dragActiveRef, getBounds }: Options) {
  // No dependency list: zoom, pan, unit and view rotation each move the readings.
  useLayoutEffect(() => {
    const guides = guidesRef.current;
    const layer = stageRef.current?.getLayers()[0];
    if (!guides || !layer) return;
    const update = (sync: boolean) => {
      if (dragActiveRef.current) return;
      // A handle drag previews in component state, so the model bounds stay stale until the drag commits.
      guides.show(Konva.DD.isDragging ? null : getBounds(), sync);
    };
    update(false);
    // The rulers draw on their own layer, which would otherwise lag one frame.
    layer.on("beforeDraw.selectionGuides", () => update(true));
    return () => {
      layer.off(".selectionGuides");
    };
  });
}
