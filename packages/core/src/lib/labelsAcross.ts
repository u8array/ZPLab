import { effectiveDpmm, type LabelConfig } from "../types/LabelConfig";
import { mmToDots } from "./coordinates";

type LabelsAcross = NonNullable<LabelConfig["labelsAcross"]>;

type AcrossLabel = Pick<LabelConfig, "widthMm" | "dpmm" | "jmDensity" | "labelsAcross">;

const ACROSS_DEFAULT_GAP_MM = 2;

/** The setting at a new count. A count of 1 keeps the gap, so typing through it loses nothing. */
export function labelsAcrossWithCount(across: LabelsAcross | undefined, count: number): LabelsAcross {
  return { gapMm: ACROSS_DEFAULT_GAP_MM, ...across, count: Math.round(count) };
}

/** Width in mm of one label of the liner's row, null for a single label or a label under one dot. */
export function acrossWidthMm(label: AcrossLabel): number | null {
  const across = label.labelsAcross;
  if (!across || across.count < 2) return null;
  const width = (label.widthMm - (across.count - 1) * across.gapMm) / across.count;
  return mmToDots(width, effectiveDpmm(label)) >= 1 ? width : null;
}

/** The gap in mm that yields labels of this width, 0 when the liner cannot hold them. */
export function acrossGapForWidthMm(label: AcrossLabel, widthMm: number): number {
  const count = label.labelsAcross?.count ?? 1;
  return count < 2 ? 0 : Math.max(0, (label.widthMm - count * widthMm) / (count - 1));
}

export interface AcrossLayout {
  /** Left edge and width of each label, from the liner edge. */
  labelsDots: readonly { x: number; width: number }[];
  /** The gaps between the labels, empty when they meet. */
  gapsDots: readonly { x: number; width: number }[];
}

/** Where the labels of the liner's row sit, in dots. */
export function acrossLayoutDots(label: AcrossLabel): AcrossLayout | null {
  const widthMm = acrossWidthMm(label);
  if (widthMm === null || !label.labelsAcross) return null;
  const { count, gapMm } = label.labelsAcross;
  const dpmm = effectiveDpmm(label);
  // Each edge rounds on its own, so no rounding carries across the row and labels without a gap meet on one dot.
  const labelsDots = Array.from({ length: count }, (_, k) => {
    const startMm = k * (widthMm + gapMm);
    const x = mmToDots(startMm, dpmm);
    return { x, width: mmToDots(startMm + widthMm, dpmm) - x };
  });
  const gapsDots = labelsDots.slice(1).flatMap((next, k) => {
    const prev = labelsDots[k];
    const x = prev ? prev.x + prev.width : next.x;
    return next.x > x ? [{ x, width: next.x - x }] : [];
  });
  return { labelsDots, gapsDots };
}
