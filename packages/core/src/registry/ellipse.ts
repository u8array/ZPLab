import type { PropSpecs } from '../types/propSpec';
import type { ObjectTypeCore } from '../types/ObjectType';
import { graphicFieldPos, wrapReverse, ZPL_COLORS, type ZplColor } from './zplHelpers';
import { commitWidthHeightTransform } from './transformHelpers';

export interface EllipseProps {
  width: number;
  height: number;
  thickness: number;
  filled: boolean;
  color: ZplColor;
  /** When true, resize keeps width === height. Set by the parser when
   *  an object round-trips through ^GC, by the "Circle" Properties-
   *  Panel toggle, or by the user. The transformer reads this to
   *  force uniform scale anchors. */
  lockAspect?: boolean;
  /** Field-level inversion via `^LRY`/`^LRN` wrap on emit. Round-trips
   *  through the parser's `^LR` state and matches the box/line/text
   *  reverse semantics. */
  reverse?: boolean;
}

export const ELLIPSE_PROP_SPECS: PropSpecs<EllipseProps> = {
  width: { type: 'number', scale: 'dots' },
  height: { type: 'number', scale: 'dots' },
  thickness: { type: 'number', scale: 'dots' },
  filled: { type: 'boolean' },
  color: { type: 'string', values: ZPL_COLORS },
  lockAspect: { type: 'boolean' },
  reverse: { type: 'boolean' },
};

export const ellipse: ObjectTypeCore<EllipseProps> = {
  label: 'Ellipse',
  icon: '○',
  zplCmd: '^GE',
  group: 'shape',
  propSpecs: ELLIPSE_PROP_SPECS,
  defaultProps: {
    width: 150,
    height: 100,
    thickness: 3,
    filled: false,
    color: 'B',
  },
  defaultSize: { width: 150, height: 100 },

  uniformScale: (p) => p.lockAspect === true,

  commitTransform: (obj, ctx) => {
    // When lockAspect is true, the transformer already constrains the
    // bbox to a square via forceAspectBox, so sx === sy here. We still
    // collapse to a single axis to keep width === height exact under
    // float rounding rather than relying on identical Math.round inputs.
    if (obj.props.lockAspect) {
      const uniform = { ...ctx, sx: Math.min(ctx.sx, ctx.sy), sy: Math.min(ctx.sx, ctx.sy) };
      return commitWidthHeightTransform(obj, uniform);
    }
    return commitWidthHeightTransform(obj, ctx);
  },

  toZPL: (obj) => {
    const p = obj.props;
    const thick = p.filled ? Math.min(p.width, p.height) : p.thickness;
    // Equal axes round-trip through Zebra's dedicated circle command
    // (one parameter shorter, pixel-equivalent). The parser maps either
    // ^GC or ^GE to an ellipse on import.
    const cmd =
      p.width === p.height
        ? `^GC${p.width},${thick},${p.color}`
        : `^GE${p.width},${p.height},${thick},${p.color}`;
    return wrapReverse(p.reverse, `${graphicFieldPos(obj, p.width, p.height)}${cmd}^FS`);
  },
};
