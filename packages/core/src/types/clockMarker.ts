/** Reserved clock-marker body grammar: `clock`, optional channel `2`/`3`, colon,
 *  then exactly one token letter (e.g. `clock:Y`, `clock2:m`). Single source for
 *  the parser, the editor's marker classifier and the variable-name guard, so the
 *  three can't drift (they did once). Lives in the types base layer so
 *  `types/Variable` can consume it without a layer inversion into `lib/`.
 *
 *  Capture groups: 1 = channel suffix (`""`|`"2"`|`"3"`), 2 = token letter. */
export const CLOCK_BODY_SRC = "clock([23]?):([A-Za-z])";

export const CLOCK_BODY_RE = new RegExp(`^${CLOCK_BODY_SRC}$`);

/** A `«clock…»` marker embedded in content. Caller adds the `g` flag via
 *  `clockMarkerReGlobal` when scanning/replacing. */
export const CLOCK_MARKER_RE = new RegExp(`«${CLOCK_BODY_SRC}»`);

/** Fresh global regex per call (stateful `lastIndex`, so never share one). */
export const clockMarkerReGlobal = (): RegExp => new RegExp(`«${CLOCK_BODY_SRC}»`, "g");
