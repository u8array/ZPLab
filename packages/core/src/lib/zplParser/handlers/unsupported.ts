import { deleteStoredObjects, pushBrowserLimit, type ParserState } from "../context";
import type { Handler } from "../types";

/** Commands with no model: noops, storage actions, and the ones needing printer hardware. */
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
    // Storage writes are reported by the loop as device actions; a delete also decides what a later recall resolves.
    ID: (p) => deleteStoredObjects(s, p[0] ?? ""),
    IS: noop,
    // Spec p.185 only refers ~EG to ^ID, so its reach is taken from ^ID's defaults: R: and .GRF (p.245).
    EG: () => deleteStoredObjects(s, "R:*.GRF"),
    // Browser-limit factories, surface as "not loaded" findings.
    HT: mkBrowserLimit("HT"),
    LF: mkBrowserLimit("LF"),
  };
}
