import type { PreflightCtx, PreflightProducerResult } from "../types/preflight";
import { effectiveDpmm } from "../types/LabelConfig";
import { mmToUnitExact, unitLabel, type Unit } from "./units";

/** Recommended minimum barcode module / X-dimension in mm for reliable general
 *  scanning, per GS1/AIM guidance (~0.25 mm). Below this the preflight warns.
 *  Shared floor for 1D X-dimension and 2D cell size. */
export const MIN_BARCODE_MODULE_MM = 0.25;

/** Display precision per unit for module sizes (sub-millimetre values). */
const MODULE_DECIMALS: Record<Unit, number> = { mm: 2, cm: 3, in: 3 };

function formatModule(mm: number, unit: Unit): string {
  return `${mmToUnitExact(mm, unit).toFixed(MODULE_DECIMALS[unit])} ${unitLabel(unit)}`;
}

/** A `barcodeTooSmall` finding when the module size (dots) is below the minimum
 *  scannable X-dimension at the device density. Used by every 1D and 2D type. */
export function moduleTooSmallFindings(
  moduleDots: number,
  dpmm: number,
  unit: Unit,
): PreflightProducerResult[] {
  const mm = moduleDots / dpmm;
  if (!(mm < MIN_BARCODE_MODULE_MM)) return []; // also short-circuits NaN/Infinity
  return [{
    kind: "barcodeTooSmall",
    detail: `${formatModule(mm, unit)} (min ${formatModule(MIN_BARCODE_MODULE_MM, unit)})`,
  }];
}

/** Curried registry `preflight` producer: warns when the named module-size prop
 *  (e.g. moduleWidth, magnification, dimension) is below the min X-dimension.
 *  One source for the scannability check every 1D/2D barcode type registers. */
export function moduleTooSmallPreflight<P extends object>(
  prop: keyof P & string,
): (obj: { props: P }, ctx: PreflightCtx) => PreflightProducerResult[] {
  return (obj, ctx) => moduleTooSmallFindings(obj.props[prop] as number, effectiveDpmm(ctx.label), ctx.unit);
}

/** Registry `preflight` for legacy/niche symbologies (Code 49, TLC39): the
 *  module-size check plus a standing "not supported on all printers" warning,
 *  since many printers, especially entry-level, do not implement these. */
export function limitedSupportPreflight<P extends object>(
  prop: keyof P & string,
): (obj: { props: P }, ctx: PreflightCtx) => PreflightProducerResult[] {
  return (obj, ctx) => [
    ...moduleTooSmallFindings(obj.props[prop] as number, effectiveDpmm(ctx.label), ctx.unit),
    { kind: "printerSupportLimited" },
  ];
}
