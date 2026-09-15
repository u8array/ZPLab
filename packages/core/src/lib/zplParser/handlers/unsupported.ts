import { deleteStoredObjects, pushBrowserLimit, type ParserState } from "../context";
import type { Handler } from "../types";

/** Commands with no model: noops, storage actions, and the ones needing printer hardware. */
export function createUnsupportedHandlers(s: ParserState): Record<string, Handler> {
  const noop: Handler = () => void 0;
  const browserLimit: Handler = (_, rest) => pushBrowserLimit(s.result, `${s.result.tokenCommand}${rest}`);

  return {
    FM: noop,
    JA: noop,
    JC: noop,
    JD: noop,
    JE: noop,
    JI: noop,
    JR: noop,
    "~PH": noop,
    "~PP": noop,
    "~PM": noop,
    "~PR": noop,
    "^JS": noop,
    // A delete decides what a later recall resolves.
    ID: (p) => deleteStoredObjects(s, p[0] ?? ""),
    IS: noop,
    // Spec p.185 only refers ~EG to ^ID, so its reach is taken from ^ID's defaults: R: and .GRF (p.245).
    EG: () => deleteStoredObjects(s, "R:*.GRF"),
    HT: browserLimit,
    LF: browserLimit,
  };
}
