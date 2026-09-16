import type { PropSpecs } from '../types/propSpec';
import type { ObjectTypeCore } from '../types/ObjectType';
import { wrapReverse, graphicAnchor, ZPL_COLORS, type ZplColor } from './zplHelpers';

export interface LineProps {
  /** Angle in degrees, 0 = rightward horizontal, clockwise positive (screen coords). */
  angle: number;
  length: number;
  thickness: number;
  color: ZplColor;
  reverse?: boolean;
}

/** Smallest angular distance between two angles in degrees, accounting
 *  for the ±180° wrap. Returns a value in [0, 180]. */
function angleDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Pick a target stored-angle for the clicked orientation.
 *
 * The two `screenAngles` are converted to label-space by subtracting the
 * current view rotation. If the line's current angle already matches one
 * of those candidates exactly, we flip to the other (lets the user click
 * the same orientation button twice to reverse the line's direction).
 * Otherwise, the candidate closer to the current angle wins so the line
 * keeps its rough direction.
 */
export function pickAngle(
  currentAngle: number,
  screenAngles: readonly [number, number],
  viewRotation: number,
): number {
  const a = screenAngles[0] - viewRotation;
  const b = screenAngles[1] - viewRotation;
  // angleDistance (not strict ===) so equivalent-but-differently-normalised
  // values like 90° and -270° still trigger the flip-on-second-click path.
  const distA = angleDistance(currentAngle, a);
  const distB = angleDistance(currentAngle, b);
  if (distA < 0.5) return b;
  if (distB < 0.5) return a;
  return distA <= distB ? a : b;
}

/** Axis-aligned lines emit a thin `^GB` box; diagonals emit `^GD`. Single
 *  source for the panel field badges and the properties header command badge. */
export function lineZplCmd(angle: number): '^GB' | '^GD' {
  const norm = ((angle % 180) + 180) % 180;
  return norm === 0 || norm === 90 ? '^GB' : '^GD';
}

export const LINE_PROP_SPECS: PropSpecs<LineProps> = {
  angle: { type: 'number', min: -359, max: 359, scale: 'never' },
  length: { type: 'number', scale: 'dots' },
  thickness: { type: 'number', scale: 'dots' },
  color: { type: 'string', values: ZPL_COLORS },
  reverse: { type: 'boolean' },
};

export const line: ObjectTypeCore<LineProps> = {
  label: 'Line',
  icon: '—',
  zplCmd: '^GB',
  zplCmdFor: (obj) => lineZplCmd(obj.props.angle),
  group: 'shape',
  propSpecs: LINE_PROP_SPECS,
  defaultProps: {
    angle: 0,
    length: 200,
    thickness: 3,
    color: 'B',
  },
  defaultSize: { width: 200, height: 3 },

  toZPL: (obj) => {
    const p = obj.props;
    const t = p.thickness;
    const l = p.length;
    const a = ((p.angle % 360) + 360) % 360; // normalise to [0, 360)

    // Pure horizontal: angle 180 means the line extends LEFT from (obj.x, obj.y),
    // so the ^GB box must start at (obj.x - l) to overlap the same pixels.
    // ^FT graphic origin is a bottom corner (spec p.205): lower by the ^GB box
    // height (band t horizontal, length l vertical) and, when right-justified
    // (z=1), shift to the right edge (band width l horizontal, t vertical).
    const right = obj.fieldJustify === 'R';
    if (a === 0 || a === 180) {
      const bx = a === 180 ? obj.x - l : obj.x;
      const anchor =
        obj.positionType === 'FT'
          ? right ? `^FT${bx + l},${obj.y + t},1` : `^FT${bx},${obj.y + t}`
          : `^FO${bx},${obj.y}`;
      return wrapReverse(
        p.reverse,
        `${anchor}^GB${l},${t},${t},${p.color},0^FS`,
      );
    }
    // Pure vertical: angle 270 means the line extends UP from (obj.x, obj.y),
    // so the ^GB box must start at (obj.x, obj.y - l).
    if (a === 90 || a === 270) {
      const by = a === 270 ? obj.y - l : obj.y;
      const anchor =
        obj.positionType === 'FT'
          ? right ? `^FT${obj.x + t},${by + l},1` : `^FT${obj.x},${by + l}`
          : `^FO${obj.x},${by}`;
      return wrapReverse(
        p.reverse,
        `${anchor}^GB${t},${l},${t},${p.color},0^FS`,
      );
    }

    // Diagonal: use ^GD (bounding-box diagonal command)
    const rad = (a * Math.PI) / 180;
    const dx = l * Math.cos(rad);
    const dy = l * Math.sin(rad);
    const w = Math.max(1, Math.abs(Math.round(dx)));
    const h = Math.max(1, Math.abs(Math.round(dy)));
    const orientation = dx * dy >= 0 ? 'L' : 'R';
    const boxX = obj.x + (dx < 0 ? Math.round(dx) : 0);
    const boxY = obj.y + (dy < 0 ? Math.round(dy) : 0);
    // ^FT anchors the ^GD bounding box at a bottom corner (spec p.205); ^FO
    // emits the box top-left verbatim.
    const anchor = graphicAnchor(boxX, boxY, w, h, obj.positionType, obj.fieldJustify);
    return wrapReverse(
      p.reverse,
      `${anchor}^GD${w},${h},${t},${p.color},${orientation}^FS`,
    );
  },
};
