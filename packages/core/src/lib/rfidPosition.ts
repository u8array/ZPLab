import { RFID_POSITION_RE } from "../types/LabelConfig";

/** ^RS p wire forms (spec p.435): absolute dot rows from the label top,
 *  `F` mm forward off the leading edge, `B` mm of backfeed (before it). */
export type RfidPositionMode = "abs" | "F" | "B";

/** Spec default for Link-OS printers: leading edge at the print line. */
export const RFID_POSITION_DEFAULT = "F0";

export interface RfidPositionValue {
  mode: RfidPositionMode;
  /** Distance from the label's leading edge; negative for backfeed. */
  mm: number;
}

/** Media-motion distance the position declares, in mm off the label top.
 *  Dots are physical head dots like ^ML (^JM does not scale the feed). */
export function rfidPositionValue(
  position: string | undefined,
  dpmm: number,
): RfidPositionValue | null {
  if (position === undefined || !RFID_POSITION_RE.test(position)) return null;
  if (position.startsWith("F")) return { mode: "F", mm: Number(position.slice(1)) };
  if (position.startsWith("B")) return { mode: "B", mm: -Number(position.slice(1)) };
  return { mode: "abs", mm: Number(position) / dpmm };
}

const RFID_FORWARD_MM_MAX = 999;
const RFID_BACKFEED_MM_MAX = 30;
/** The absolute form is five digits wide on the wire (RFID_POSITION_RE). */
const RFID_ABS_DOTS_MAX = 99999;

/** Wire form for a dragged distance, keeping the mode the user set: forward
 *  and absolute are the same direction in two notations, so only crossing the
 *  leading edge switches (to `B`, the sole backfeed notation). */
export function rfidPositionOf(
  mm: number,
  mode: RfidPositionMode,
  dpmm: number,
  labelHeightMm: number,
): string {
  if (mm < 0) {
    return `B${Math.min(RFID_BACKFEED_MM_MAX, Math.round(-mm))}`;
  }
  const forward = Math.min(mm, labelHeightMm);
  if (mode === "abs") {
    return String(Math.min(RFID_ABS_DOTS_MAX, Math.round(forward * dpmm)));
  }
  return `F${Math.min(RFID_FORWARD_MM_MAX, Math.round(forward))}`;
}

/** ^RS p split into its notation and that notation's own unit (absolute in
 *  dots, F/B in mm), for typed UI controls over the wire string. */
export function rfidPositionParts(
  position: string | undefined,
): { mode: RfidPositionMode; amount: number } | null {
  if (position === undefined || !RFID_POSITION_RE.test(position)) return null;
  if (position.startsWith("F")) return { mode: "F", amount: Number(position.slice(1)) };
  if (position.startsWith("B")) return { mode: "B", amount: Number(position.slice(1)) };
  return { mode: "abs", amount: Number(position) };
}

/** Carry an amount into another notation: absolute counts dots, F/B count
 *  mm. A direction change lands on the leading edge, since no forward
 *  notation can express backfeed. */
export function rfidPositionConvert(
  from: RfidPositionMode,
  to: RfidPositionMode,
  amount: number,
  dpmm: number,
): number {
  if ((from === "B") !== (to === "B")) return 0;
  if ((from === "abs") === (to === "abs")) return amount;
  return to === "abs" ? Math.round(amount * dpmm) : Math.round(amount / dpmm);
}

export function rfidPositionFromParts(mode: RfidPositionMode, amount: number): string {
  return mode === "abs" ? String(amount) : `${mode}${amount}`;
}

/** Domain of the amount slot per notation (spec p.435); the absolute cap is
 *  the label length, so callers pass it in dots. */
export function rfidAmountRange(
  mode: RfidPositionMode,
  labelHeightDots: number,
): { min: number; max: number } {
  if (mode === "abs") {
    return { min: 0, max: Math.min(RFID_ABS_DOTS_MAX, Math.round(labelHeightDots)) };
  }
  return mode === "F"
    ? { min: 0, max: RFID_FORWARD_MM_MAX }
    : { min: 0, max: RFID_BACKFEED_MM_MAX };
}
