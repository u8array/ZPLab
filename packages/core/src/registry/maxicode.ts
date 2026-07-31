import type { ObjectTypeCore } from "../types/ObjectType";
import type { PreflightProducerResult } from "../types/preflight";
import { fieldPosZ, fdFieldFor } from "./zplHelpers";
import { hasTemplateMarkers } from "../lib/fnTemplate";

// ISO/IEC 16023 fixed physical symbol; no magnification.
// 2=US SCM, 3=intl SCM, 4=standard, 5=full EEC, 6=reader programming.
// 2/3 require SCM payload; bwip surfaces errors. 6 produces a config symbol.
export const ALL_MODES = [2, 3, 4, 5, 6] as const;

// Printed ink extent (Labelary-measured: 200x193 dots @ 8dpmm, 300x289 @ 12);
// the symbol size tracks dpmm, not bwip's dpmm-independent pixel canvas.
export const MAXICODE_WIDTH_MM = 25.0;
export const MAXICODE_HEIGHT_MM = 24.1;

/** Mode 4 = standard symbol, only mode without UPS-domain SCM requirement. */
const MAXICODE_DEFAULT_MODE = 4 as const;

// No rotation prop: ^BD has no orientation slot (spec p106).
export interface MaxicodeProps {
  content: string;
  mode: 2 | 3 | 4 | 5 | 6;
}

// bwip's mode 2/3 SCM parser splits the postcode/country/service fields on GS
// (0x1D); content without any GS separator can never form a carrier message.
const SCM_FIELD_SEPARATOR = "\x1d";

/** True when a mode 2/3 payload clearly lacks a structured carrier message.
 *  Loose on purpose: only the no-separator case is flagged, subtler SCM errors
 *  (wrong field widths) fall through to the encoder's own renderFailed. */
export function maxicodeMissingScm(props: MaxicodeProps): boolean {
  return (props.mode === 2 || props.mode === 3) && !props.content.includes(SCM_FIELD_SEPARATOR);
}

/** True when the missing-SCM report is owned by the preflight producer, so
 *  renderFailed/red-box surfaces must stand down. Only literal content: the
 *  producer never sees a bound value, so marker fields keep the alarm. */
export function maxicodeScmOwnedByPreflight(rawContent: string, resolved: MaxicodeProps): boolean {
  return !hasTemplateMarkers(rawContent) && maxicodeMissingScm(resolved);
}

export const maxicode: ObjectTypeCore<MaxicodeProps> = {
  label: "Maxicode",
  icon: "⬡",
  zplCmd: "^BD",
  group: "code-2d",
  bindable: true,
  defaultProps: {
    content: '',
    mode: MAXICODE_DEFAULT_MODE,
  },
  placeholderContent: '1234567890',
  // mm so palette resolves at active dpmm; heightLocked disables resize.
  defaultSize: { widthMm: MAXICODE_WIDTH_MM, heightMm: MAXICODE_HEIGHT_MM },
  heightLocked: true,

  // Blank content -> emptyContent; marker content -> resolved-value check
  // (canvas/panel). Only a literal mode 2/3 payload missing its carrier
  // message flags here; the canvas suppresses its red box for this case.
  preflight: (obj): PreflightProducerResult[] =>
    obj.props.content.trim() !== "" &&
    !hasTemplateMarkers(obj.props.content) &&
    maxicodeMissingScm(obj.props)
      ? [{ kind: "maxicodeModeMissingScm" }]
      : [],

  toZPL: (obj, ctx) => {
    const p = obj.props;
    // Structured-append slots fixed at (1,1) since unexposed.
    return [
      fieldPosZ(obj),
      `^BD${p.mode},1,1`,
      fdFieldFor(p.content, ctx),
    ].join("");
  },
};
