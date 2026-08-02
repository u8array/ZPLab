import { hasTemplateMarkers, resolveTemplateMarkers } from "./fnTemplate";
// SINGLE_MARKER_RE direct: variableField's isLoneMarker would cycle back into
// this leaf module via variableBinding.
import { SINGLE_MARKER_RE } from "../types/Variable";
import { code128EscapeLiterals, code128PlainFd } from "./code128Subset";
import { channelDatesFrom, hasClockMarkers, resolveClockMarkers, type ChannelDates } from "./fcTemplate";
import { hasControlMarkers, resolveControlMarkers, stripControlBytes } from "../types/controlKey";
import type { ClockOffset, LabelConfig } from "../types/LabelConfig";
import type { Variable } from "../types/Variable";

// Leaf module (no registry import) so registry emitters (qrcode's ^GFA
// pre-rotation) can resolve content without a variableBinding -> registry
// -> qrcode import cycle.

export interface ClockResolveCtx {
  dates?: ChannelDates;
  now?: Date;
  secondaryOffset?: ClockOffset;
  tertiaryOffset?: ClockOffset;
}

/** Builds a ClockResolveCtx from the label's ^SO offsets. */
export function clockCtxFromLabel(
  label: Pick<LabelConfig, "secondaryClockOffset" | "tertiaryClockOffset">,
): ClockResolveCtx {
  return {
    secondaryOffset: label.secondaryClockOffset,
    tertiaryOffset: label.tertiaryClockOffset,
  };
}

/** Lazy channel dates for resolveMarkerChain: `new Date()` only runs when a
 *  clock marker actually exists. */
export function clockDatesThunk(clock?: ClockResolveCtx): () => ChannelDates {
  return () => clock?.dates ?? channelDatesFrom(
    clock?.now ?? new Date(),
    clock?.secondaryOffset,
    clock?.tertiaryOffset,
  );
}

/** How the emitter treats control bytes, so preview resolution can mirror it.
 *  `byteOutsideTemplate`: the symbology's own escape form (Code 128) cannot
 *  wrap a ^FE template payload, so the firmware drops the bytes there. */
export type CtrlParity = "literal" | "byte" | "byteOutsideTemplate";

/** Shared control -> clock -> variable order: field-own display markers first
 *  (a chip in substituted data stays literal, matching export; lone binds are
 *  the exception below). `ctrl` mirrors the emitter's capability gate. */
export function resolveMarkerChain(
  content: string,
  resolveVar: (name: string) => string | undefined,
  getDates: (() => ChannelDates) | null,
  ctrl: CtrlParity,
): string {
  let next = content;
  // Template-form plain-^BC: escape literal spans pre-substitution, escape
  // substituted values like their ^FN declarations, drop bytes like ^FH does.
  // Mirrors planCode128Fd's template/templateValue modes on the render side;
  // changes there must land here too (code128Plan.ts is the emit oracle).
  let templateFd = false;
  let loneBind = false;
  if (getDates) {
    if (ctrl !== "literal" && hasControlMarkers(next)) next = resolveControlMarkers(next);
    // Emitter gate, evaluated pre-^FC there too: clock markers keep the lossy
    // ^FH path; a lone bind is a whole ^FD and encodes its own escape form.
    // Chips-only payloads stay raw (they print via the invocation plan).
    loneBind = ctrl === "byteOutsideTemplate" && SINGLE_MARKER_RE.test(next);
    templateFd = ctrl === "byteOutsideTemplate" && hasTemplateMarkers(next) && !loneBind;
    if (templateFd) next = code128EscapeLiterals(next);
    if (hasClockMarkers(next)) next = resolveClockMarkers(next, getDates());
  }
  if (hasTemplateMarkers(next)) {
    next = resolveTemplateMarkers(next, !templateFd ? resolveVar : (name) => {
      const value = resolveVar(name);
      return value === undefined ? value : code128PlainFd(value);
    });
  }
  // The emitter resolves chips inside a lone-bind value too (fdTransformFor
  // runs resolveControlMarkers on the whole-field default/CSV cell).
  if (loneBind && hasControlMarkers(next)) next = resolveControlMarkers(next);
  // After substitution, so a control byte from the bound value drops too.
  return templateFd ? stripControlBytes(next) : next;
}

/** Resolve content to printable text as the canvas preview would (variables to
 *  their default, no CSV row), so builders can validate marker-bearing values.
 *  `resolveCtrl: false` keeps control chips literal for contexts whose emitter
 *  does too (the GS1 builder), preserving preview/export symmetry. */
export function resolveContentPreview(
  content: string,
  variables: readonly Variable[],
  clock?: ClockResolveCtx,
  opts?: { resolveCtrl?: boolean },
): string {
  const byName = new Map(variables.map((v) => [v.name, v]));
  return resolveMarkerChain(
    content,
    (name) => byName.get(name)?.defaultValue,
    clockDatesThunk(clock),
    (opts?.resolveCtrl ?? true) ? "byte" : "literal",
  );
}
