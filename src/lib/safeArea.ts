// Pure geometry for the configurable safe-area (margin) inset. A uniform
// margin in mm, converted to dots, that align/pin and the canvas guide use
// so elements keep a consistent distance to the label edge.
import { effectiveDpmm } from "@zplab/core/types/LabelConfig";

import { labelRectsDots, printableRectDots, type BoundingBoxDots } from "@zplab/core/lib/objectBounds";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import { mmToDots } from "@zplab/core/lib/coordinates";

/** Inset rectangle (dots) of the safe area in `rect`, the printable rect unless
 *  given, or null when no safe area applies: unset/zero margin, or an inset so
 *  large the rect collapses. Inset from the printable rect so it stays
 *  consistent under ^LS. */
export function safeAreaRectDots(label: PageLabel, rect: BoundingBoxDots = printableRectDots(label)): BoundingBoxDots | null {
  const mm = label.safeAreaMm ?? 0;
  if (mm <= 0) return null;
  const inset = mmToDots(mm, effectiveDpmm(label));
  if (inset <= 0) return null;
  const width = rect.width - 2 * inset;
  const height = rect.height - 2 * inset;
  if (width <= 0 || height <= 0) return null;
  return { x: rect.x + inset, y: rect.y + inset, width, height };
}

/** The safe area of every label of a row, or of the one label. Empty when none applies. */
export function safeAreaRectsDots(label: PageLabel): BoundingBoxDots[] {
  return labelRectsDots(label).flatMap((rect) => safeAreaRectDots(label, rect) ?? []);
}
