import { isMuDpi, jmDensityOf } from "../../../types/LabelConfig";
import { deriveUnitScale, type ParserState } from "../context";
import type { Handler } from "../types";

/** ^MU / ^JM handlers. ^MU owns the dot-scale of body values; the ^JM density
 *  is resolved by the ^XA format-head lookahead (spec p269), so this ^JM handler
 *  only validates and surfaces the values the lookahead ignores. */
export function createUnitsHandler(s: ParserState, dpmm: number): Record<string, Handler> {
  const labelConfig = s.result.labelConfig;
  const markPartial = () => s.result.partialCmds.add("^MU");

  return {
    // a-slot scales dot-quantities on read so the model stays
    // dots-canonical. b,c are a paired resampling directive persisted
    // for re-emit; printer does the actual scaling at print time.
    MU(p) {
      const a = (p[0] ?? "").trim().toUpperCase();
      if (a === "I" || a === "M" || a === "" || a === "D") {
        s.format.muMode = a === "I" || a === "M" ? a : "D";
        s.format.unitScale = deriveUnitScale(s.format, dpmm);
      } else markPartial(); // unknown a-slot: preserve prior unitScale

      const rawB = (p[1] ?? "").trim();
      const rawC = (p[2] ?? "").trim();
      // Both-or-neither: a half-set pair has no usable ratio, so a
      // lone b or c is a partial import.
      if (!rawB && !rawC) return;
      const b = Number.parseInt(rawB, 10);
      const c = Number.parseInt(rawC, 10);
      if (isMuDpi(b) && isMuDpi(c)) {
        labelConfig.muResampling = { formatDpi: b, outputDpi: c };
      } else {
        markPartial();
      }
    },
    // Density is resolved by the format-head lookahead (or, without a wrapper,
    // the stream head); this handler only reports what the lookahead ignores:
    // an invalid value, or a ^JM outside any head (post-^FS, preamble, between formats).
    JM(_p, rest) {
      const v = jmDensityOf(rest, s.format.delimiterChar);
      if (v === undefined || !s.format.inFormatHead) s.result.partialCmds.add("^JM");
    },
  };
}
