import { effectiveDpmm, type PageLabel } from "@zplab/core/types/LabelConfig";
import { acrossLayoutDots } from "@zplab/core/lib/labelsAcross";
import { dotsToPx, mmToDots } from "@zplab/core/lib/coordinates";
import type { RulerGuides } from "../../lib/rulerGuides";

/** Node name of a gap between two labels. */
export const ACROSS_GAP = "across-gap";

interface Strip {
  x: number;
  width: number;
}

export interface AcrossLayoutPx {
  labels: readonly Strip[];
  gaps: readonly Strip[];
}

/** The labels of the row and the gaps between them as x and width in px from the liner edge. Null for a single label. */
export function acrossLayoutPx(label: PageLabel, scale: number): AcrossLayoutPx | null {
  const across = acrossLayoutDots(label);
  if (!across) return null;
  const dpmm = effectiveDpmm(label);
  const px = (strip: Strip) => ({ x: dotsToPx(strip.x, scale, dpmm), width: dotsToPx(strip.width, scale, dpmm) });
  return { labels: across.labelsDots.map(px), gaps: across.gapsDots.map(px) };
}

/** The guides plus the edges and centre of every label of the row, in label mm. The liner's own
 *  edges and centre stay out, the label rect snaps to those. Like a guide, each sits on a whole dot. */
export function withAcrossGuides(guides: RulerGuides, label: PageLabel): RulerGuides {
  const across = acrossLayoutDots(label);
  if (!across) return guides;
  const dpmm = effectiveDpmm(label);
  const shift = label.labelShift ?? 0;
  const anchors = (start: number, width: number) => [start, Math.round(start + width / 2), start + width];
  const liner = new Set(anchors(0, mmToDots(label.widthMm, dpmm)));
  const row = new Set(across.labelsDots.flatMap((l) => anchors(l.x, l.width)).filter((dots) => !liner.has(dots)));
  return { x: [...guides.x, ...[...row].map((dots) => (shift + dots) / dpmm)], y: guides.y };
}
