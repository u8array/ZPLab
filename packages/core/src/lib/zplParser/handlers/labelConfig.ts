import { DARKNESS_INSTANT_RANGE, DARKNESS_PERMANENT_RANGE, MAX_LABEL_LENGTH_RANGE, SLEW_DOT_ROWS_RANGE, SPEED_RANGE, isBackfeedPercent, isBackfeedSequence, isMediaFeedMode, isMediaMode, isMediaTracking, isMediaType, isPrintOrientation } from "../../../types/LabelConfig";
import { parseIntOrUndef } from "../../inputParse";
import { isYesNo } from "../../../types/typeHelpers";
import type { ParserState } from "../context";
import { dotsFor, firstChar, inRange, int, strParam } from "../helpers";
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
  const { dots, dotsOrUndef } = dotsFor(s);
  return {
    PW(_, rest) {
      const w = dots(rest);
      if (w > 0) labelConfig.widthMm = Math.round((w / dpmm) * 10) / 10;
    },
    LL(_, rest) {
      const h = dots(rest);
      if (h > 0) labelConfig.heightMm = Math.round((h / dpmm) * 10) / 10;
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
    MM(_, rest) {
      const mode = firstChar(rest);
      if (isMediaMode(mode)) labelConfig.mediaMode = mode;
    },
    LS(_, rest) {
      const shift = dots(rest);
      if (shift !== 0) labelConfig.labelShift = shift;
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
    PF(p) {
      const v = inRange(parseIntOrUndef(p[0]), SLEW_DOT_ROWS_RANGE);
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
      const v = inRange(dotsOrUndef(p[0]), MAX_LABEL_LENGTH_RANGE);
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
