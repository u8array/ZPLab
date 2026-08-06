import { DARKNESS_INSTANT_RANGE, DARKNESS_PERMANENT_RANGE, MAX_LABEL_LENGTH_RANGE, RFID_EPC_BITS_RANGE, RFID_EPC_MAX_PARTITIONS, RFID_EPC_PARTITION_RANGE, RFID_POSITION_RE, RFID_RETRIES_RANGE, SLEW_DOT_ROWS_RANGE, SPEED_RANGE, isBackfeedPercent, isBackfeedSequence, isMediaFeedMode, isMediaMode, isMediaTracking, isMediaType, isPrintOrientation, isRfidErrorHandling, parseRfidPower, type RfidPower } from "../../../types/LabelConfig";
import { parseIntOrUndef } from "../../inputParse";
import { isYesNo } from "../../../types/typeHelpers";
import { dotsToMm } from "../../coordinates";
import { deriveUnitScale, type ParserState } from "../context";
import { dotsFor, firstChar, inRange, int, intDotsOrUndef, strParam } from "../helpers";
import type { Handler } from "../types";

/** ^PQ extended params (pauseCount, replicates); Zebra spec caps at
 *  8 digits / 99,999,999 per slot. */
const PQ_EXT_MAX = 99_999_999;

/** Per-label media + print-quality handlers; mutate only `labelConfig`. */
export function createLabelConfigHandlers(
  s: ParserState,
  dpmm: number,
): Record<string, Handler> {
  const labelConfig = s.result.labelConfig;
  const { dotsOrUndef } = dotsFor(s);
  // ^PW/^LL/^ML are physical head dots, ^JM-independent (ZD230-verified): omit
  // jmDensity from the scale so the un-halved ^MU multiplier applies.
  const physDots = (raw: string | undefined): number | undefined =>
    intDotsOrUndef(raw, deriveUnitScale({ muMode: s.format.muMode }, dpmm));
  return {
    PW(_, rest) {
      const w = physDots(rest);
      if (w !== undefined && w > 0) labelConfig.widthMm = dotsToMm(w, dpmm);
    },
    LL(_, rest) {
      const h = physDots(rest);
      if (h !== undefined && h > 0) labelConfig.heightMm = dotsToMm(h, dpmm);
    },
    PQ(p) {
      const qty = int(p[0], 0);
      if (qty > 0) labelConfig.printQuantity = qty;
      // ^PQ q,p,r,o: preserve extended params when present.
      if (p.length > 1) {
        const pause = int(p[1], 0);
        if (pause >= 0 && pause <= PQ_EXT_MAX) labelConfig.pauseCount = pause;
      }
      if (p.length > 2) {
        const reps = int(p[2], 0);
        if (reps >= 0 && reps <= PQ_EXT_MAX) labelConfig.replicates = reps;
      }
      if (p.length > 3) {
        const o = (p[3] ?? "").toUpperCase();
        if (isYesNo(o)) labelConfig.overridePauseCount = o;
      }
    },
    // ^RSt,p,v,n,e,a,c,s (spec p.434-437). Every slot the design carried but
    // we could not adopt is reported: dropping it silently would hide a real
    // setting (legacy tag types, the unmodelled a/c slots, out-of-domain values).
    RS(p) {
      const adopt = (slot: number, take: (raw: string | undefined) => boolean) => {
        if (take(p[slot])) return;
        if (strParam(p[slot]) !== "") s.result.partialCmds.add("^RS");
      };
      adopt(0, (raw) => {
        if (int(raw, 0) !== 8) return false;
        labelConfig.rfidTagType = 8;
        return true;
      });
      adopt(1, (raw) => {
        const pos = strParam(raw);
        if (!RFID_POSITION_RE.test(pos)) return false;
        labelConfig.rfidPosition = pos;
        return true;
      });
      adopt(2, (raw) => {
        const v = inRange(physDots(raw), SLEW_DOT_ROWS_RANGE);
        if (v === undefined) return false;
        labelConfig.rfidVoidLength = v;
        return true;
      });
      adopt(3, (raw) => {
        const n = inRange(parseIntOrUndef(raw), RFID_RETRIES_RANGE);
        if (n === undefined) return false;
        labelConfig.rfidRetries = n;
        return true;
      });
      adopt(4, (raw) => {
        const e = strParam(raw);
        if (!isRfidErrorHandling(e)) return false;
        labelConfig.rfidErrorHandling = e;
        return true;
      });
      adopt(5, () => false);
      adopt(6, () => false);
      adopt(7, (raw) => {
        const vs = inRange(parseIntOrUndef(raw), SPEED_RANGE);
        if (vs === undefined) return false;
        labelConfig.rfidVoidSpeed = vs;
        return true;
      });
    },
    // ^RBn,p0..p15: partitions must sum to n (spec p.424), else the whole
    // command drops (a half-adopted structure would encode wrong fields).
    RB(p) {
      const bits = inRange(parseIntOrUndef(p[0]), RFID_EPC_BITS_RANGE);
      if (bits === undefined) {
        s.result.partialCmds.add("^RB");
        return;
      }
      // Only a trailing delimiter is noise; an empty slot inside the list is
      // a value we cannot read, so it must not be normalised away.
      const slots = p.slice(1);
      while (slots.length > 0 && (slots[slots.length - 1] ?? "").trim() === "") slots.pop();
      if (slots.length === 0) {
        labelConfig.rfidEpcBits = bits;
        delete labelConfig.rfidEpcPartitions;
        return;
      }
      const parts = slots.map((x) => inRange(parseIntOrUndef(x), RFID_EPC_PARTITION_RANGE));
      if (
        slots.length > RFID_EPC_MAX_PARTITIONS ||
        slots.some((x) => (x ?? "").trim() === "") ||
        parts.some((x) => x === undefined) ||
        parts.reduce((a, b) => (a ?? 0) + (b ?? 0), 0) !== bits
      ) {
        s.result.partialCmds.add("^RB");
        return;
      }
      labelConfig.rfidEpcBits = bits;
      labelConfig.rfidEpcPartitions = parts as number[];
    },
    // ^RWr,w,a: power as 0-30 or H/M/L (firmware union).
    RW(p) {
      const take = (slot: number, set: (v: RfidPower) => void) => {
        const value = parseRfidPower(p[slot]);
        if (value !== undefined) set(value);
        else if (strParam(p[slot]) !== "") s.result.partialCmds.add("^RW");
      };
      take(0, (v) => (labelConfig.rfidReadPower = v));
      take(1, (v) => (labelConfig.rfidWritePower = v));
      // The antenna slot is unmodelled, so any value in it is a loss.
      if (strParam(p[2]) !== "") s.result.partialCmds.add("^RW");
    },
    MM(_, rest) {
      const mode = firstChar(rest);
      if (isMediaMode(mode)) labelConfig.mediaMode = mode;
    },
    LS(_, rest) {
      const d = dotsOrUndef(rest);
      if (d !== undefined && d !== 0) labelConfig.labelShift = d;
    },
    PR(p) {
      const print = inRange(parseIntOrUndef(p[0]), SPEED_RANGE);
      if (print !== undefined) labelConfig.printSpeed = print;
      const slew = inRange(parseIntOrUndef(p[1]), SPEED_RANGE);
      if (slew !== undefined) labelConfig.slewSpeed = slew;
      const bf = inRange(parseIntOrUndef(p[2]), SPEED_RANGE);
      if (bf !== undefined) labelConfig.backfeedSpeed = bf;
    },
    MD(_, rest) {
      const v = inRange(parseIntOrUndef(rest), DARKNESS_PERMANENT_RANGE);
      if (v !== undefined) labelConfig.darkness = v;
    },
    MT(_, rest) {
      const mt = firstChar(rest);
      if (isMediaType(mt)) labelConfig.mediaType = mt;
    },
    MC(p) {
      const v = strParam(p[0]);
      if (isYesNo(v)) labelConfig.mapClear = v;
    },
    // Dot rows, so ^MU-scaled and ^JM-effective like ^LS/^LT (not physical).
    PF(p) {
      const v = inRange(dotsOrUndef(p[0]), SLEW_DOT_ROWS_RANGE);
      if (v !== undefined) labelConfig.slewDotRows = v;
    },
    // ^PH/^PP take no parameters; the tilde forms never reach these handlers
    // (dispatch routes them as device actions).
    PH() {
      labelConfig.slewToHome = true;
    },
    PP() {
      labelConfig.programmablePause = true;
    },
    MN(p) {
      // ^MNa,b: b is an optional black-mark offset for W/M modes,
      // which we don't model. Reading p[0] instead of the raw rest
      // string keeps `^MNY,10` from being mis-read as the single
      // token "Y,10" and silently dropped.
      const v = strParam(p[0]);
      if (isMediaTracking(v)) labelConfig.mediaTracking = v;
    },
    ML(p) {
      const d = physDots(p[0]);
      if (d === undefined) return;
      const v = inRange(d, MAX_LABEL_LENGTH_RANGE);
      if (v !== undefined) labelConfig.maxLabelLength = v;
    },
    MF(p) {
      const p1 = strParam(p[0]);
      const p2 = strParam(p[1]);
      if (isMediaFeedMode(p1)) labelConfig.mediaFeedPowerUp = p1;
      if (isMediaFeedMode(p2)) labelConfig.mediaFeedHeadClose = p2;
    },
    XB() {
      labelConfig.suppressBackfeed = true;
    },
    PO(_, rest) {
      const po = firstChar(rest);
      if (isPrintOrientation(po)) labelConfig.printOrientation = po;
    },
    PM(_, rest) {
      const m = firstChar(rest);
      if (isYesNo(m)) labelConfig.mirror = m;
    },
    // ~SD: instant darkness set (00..30). Tilde-prefix, so the tokenizer
    // drops the delimiter and this is the canonical SD handler.
    SD(_, rest) {
      const v = inRange(parseIntOrUndef(rest), DARKNESS_INSTANT_RANGE);
      if (v !== undefined) labelConfig.instantDarkness = v;
    },
    // ~JS: change backfeed sequence. Percent forms round to the nearest
    // ten like the printer does (~JS55 -> 60, p276).
    JS(_, rest) {
      const v = firstChar(rest);
      if (isBackfeedSequence(v)) {
        labelConfig.backfeedSequence = v;
        return;
      }
      const pct = inRange(parseIntOrUndef(rest), { min: 10, max: 90 });
      if (pct === undefined) return;
      const rounded = Math.round(pct / 10) * 10;
      if (isBackfeedPercent(rounded)) labelConfig.backfeedSequence = rounded;
    },
  };
}
