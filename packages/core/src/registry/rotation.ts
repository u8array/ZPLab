import type { StringPropSpec } from '../types/propSpec';

/**
 * ZPL field orientation. The single letter that follows a barcode/text
 * command in ZPL: N (normal, 0°), R (rotated 90° CW), I (inverted 180°),
 * B (bottom-up 270°).
 */
export type ZplRotation = 'N' | 'R' | 'I' | 'B';

export const ZPL_ROTATIONS: readonly ZplRotation[] = ['N', 'R', 'I', 'B'] as const;

export const ROTATION_SPEC: StringPropSpec<ZplRotation> = { type: 'string', values: ZPL_ROTATIONS };

/** Canvas view rotation in degrees CW. Distinct from a field's ZplRotation:
 *  this turns the whole viewport, not one object. */
export type ViewRotation = 0 | 90 | 180 | 270;

export function isZplRotation(value: string): value is ZplRotation {
  return value === 'N' || value === 'R' || value === 'I' || value === 'B';
}

/**
 * Extract `rotation` from an object's props, falling back to `'N'`. Centralises
 * the default so consumers in different layers (bwip-js opts, canvas overlay
 * gating) cannot drift apart.
 */
export function objectRotation(props: object): ZplRotation {
  const r = (props as { rotation?: string }).rotation;
  return r !== undefined && isZplRotation(r) ? r : 'N';
}

/** R/B turn the field a quarter, so the upright width axis maps to the screen
 *  height axis (and vice versa). Single source for that swap, shared by the
 *  resize scale mapping, the moduleWidth snap, and the anchor inverse. */
export function isAxisSwapped(r: ZplRotation): boolean {
  return r === 'R' || r === 'B';
}

/** ZPL rotation that reads upright under a rotated canvas view: the view
 *  rotates the label +θ CW on screen, so the field pre-rotates −θ. */
export function zplRotationForView(view: ViewRotation): ZplRotation {
  switch (view) {
    case 90: return 'B';
    case 180: return 'I';
    case 270: return 'R';
    default: return 'N';
  }
}

/** Next 90° step in the N → R → I → B → N cycle. */
export function nextZplRotation(r: ZplRotation): ZplRotation {
  const i = ZPL_ROTATIONS.indexOf(r);
  const next = ZPL_ROTATIONS[(i + 1) % ZPL_ROTATIONS.length];
  return next ?? 'N';
}

/**
 * Returns the object's step-rotation if it has one, else `null`. Step-rotation
 * objects (text, symbol, all barcodes, image) declare a `rotation:
 * 'N'|'R'|'I'|'B'` prop; box/ellipse/line do not, and groups carry no `props`
 * at all (so the type-string check filters them out first). Lets callers
 * gate UI affordances (e.g. the canvas quick-rotate button) without
 * inspecting `props` shapes themselves.
 */
export function getStepRotation(obj: { type?: string; props?: object }): ZplRotation | null {
  if (obj.type === 'group' || !obj.props) return null;
  const r = (obj.props as { rotation?: unknown }).rotation;
  return typeof r === 'string' && isZplRotation(r) ? r : null;
}
