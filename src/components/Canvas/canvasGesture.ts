import Konva from "konva";

/** A drag or a transformer resize is running on the canvas. */
export function isCanvasGestureActive(): boolean {
  return Konva.DD.isDragging || Konva.Transformer.isTransforming();
}
