import { noteFieldInk, pushBrowserLimit, type ParserState } from "../context";
import type { Handler } from "../types";

/** Intentionally-dropped commands: noops + browser-limit (needs printer hardware). */
export function createUnsupportedHandlers(s: ParserState): Record<string, Handler> {
  const noop: Handler = () => void 0;
  const mkBrowserLimit =
    (prefix: string, delimiter = "^"): Handler =>
    (_, rest) => pushBrowserLimit(s.result, `${delimiter}${prefix}${rest}`);

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
    // ^IM prints a stored image: field content the model cannot carry.
    IM: (_, rest) => {
      noteFieldInk(s);
      pushBrowserLimit(s.result, `^IM${rest}`);
    },
    DG: mkBrowserLimit("DG", "~"),
  };
}
