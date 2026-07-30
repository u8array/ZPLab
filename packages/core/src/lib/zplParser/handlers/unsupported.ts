import { pushBrowserLimit, type ParserResult } from "../context";
import type { Handler } from "../types";

/** Intentionally-dropped commands: noops + browser-limit (needs printer hardware). */
export function createUnsupportedHandlers(
  result: ParserResult,
): Record<string, Handler> {
  const noop: Handler = () => void 0;
  const mkBrowserLimit =
    (prefix: string, delimiter = "^"): Handler =>
    (_, rest) => pushBrowserLimit(result, `${delimiter}${prefix}${rest}`);

  return {
    // Noops, present in stream, no design impact.
    FM: noop,
    JA: noop,
    JC: noop,
    JD: noop,
    JE: noop,
    JI: noop,
    JR: noop,
    // Browser-limit factories, surface as "not loaded" findings.
    HT: mkBrowserLimit("HT"),
    LF: mkBrowserLimit("LF"),
    IM: mkBrowserLimit("IM"),
    DG: mkBrowserLimit("DG", "~"),
  };
}
