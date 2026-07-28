import type { ObjectTypeCore } from "../types/ObjectType";
import { fieldPosZ, fdFieldFor } from "./zplHelpers";

// ISO/IEC 16023 fixed physical size (28.14 x 26.91 mm); no magnification.
// 2=US SCM, 3=intl SCM, 4=standard, 5=full EEC, 6=reader programming.
// 2/3 require SCM payload; bwip surfaces errors. 6 produces a config symbol.
export const ALL_MODES = [2, 3, 4, 5, 6] as const;

/** Mode 4 = standard symbol, only mode without UPS-domain SCM requirement. */
const MAXICODE_DEFAULT_MODE = 4 as const;

// No rotation prop: ^BD has no orientation slot (spec p106).
export interface MaxicodeProps {
  content: string;
  mode: 2 | 3 | 4 | 5 | 6;
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
  defaultSize: { widthMm: 28.14, heightMm: 26.91 },
  heightLocked: true,

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
