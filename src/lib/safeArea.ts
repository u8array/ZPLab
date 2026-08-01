// Pure geometry for the configurable safe-area (margin) inset. A uniform
// margin in mm, converted to dots, that align/pin and the canvas guide use
// so elements keep a consistent distance to the label edge.
import { effectiveDpmm } from "@zplab/core/types/LabelConfig";

import { printableRectDots, type BoundingBoxDots } from "@zplab/core/lib/objectBounds";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import { mmToDots } from "@zplab/core/lib/coordinates";

/** Inset rectangle (dots) for the label's safe area, or null when no safe
 *  area applies: unset/zero margin, or an inset so large the rect collapses.
 *  Inset from the printable rect so it stays consistent under ^LS. */
export function safeAreaRectDots(label: PageLabel): BoundingBoxDots | null {
  const mm = label.safeAreaMm ?? 0;
  if (mm <= 0) return null;
  const inset = mmToDots(mm, effectiveDpmm(label));
  if (inset <= 0) return null;
  const r = printableRectDots(label);
  const width = r.width - 2 * inset;
  const height = r.height - 2 * inset;
  if (width <= 0 || height <= 0) return null;
  return { x: r.x + inset, y: r.y + inset, width, height };
}
