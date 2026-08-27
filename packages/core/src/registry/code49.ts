import type { ObjectTypeCore } from '../types/ObjectType';
import { fieldPos1d, fdFieldFor } from './zplHelpers';
import { commitBarcodeWidthHeightTransform, stackRowCount } from './transformHelpers';
import { limitedSupportPreflight } from '../lib/barcodeScannability';
import { type ZplRotation } from './rotation';

/** ZPL ^B4 m: 'A' = auto subset. 0-5 force a specific subset. */
export type Code49Mode = 'A' | '0' | '1' | '2' | '3' | '4' | '5';

export const CODE49_MODES: readonly Code49Mode[] = ['A', '0', '1', '2', '3', '4', '5'];

/** bwip-js rejects a code49 rowheight outside this module window. */
const ROW_MODULES = { min: 8, max: 50 };

export const code49MinHeight = (moduleWidth: number) => ROW_MODULES.min * code49Module(moduleWidth);
export const code49MaxHeight = (moduleWidth: number) => ROW_MODULES.max * code49Module(moduleWidth);

/** ^B4 divides the height by the module the bytes carry, so ^BY emits whole
 *  dots and every reader rounds the same way. */
export const code49Module = (moduleWidth: number) => Math.max(1, Math.round(moduleWidth));

/** ^B4 h is a whole row-height multiplier (spec p. 74), within bwip's window.
 *  The one derivation: a second spelling would answer differently. */
export const code49RowMultiplier = (height: number, moduleWidth: number): number => {
  const raw = Math.round(height / code49Module(moduleWidth));
  return Math.min(ROW_MODULES.max, Math.max(ROW_MODULES.min, Number.isFinite(raw) ? raw : 8));
};

/** The nearest height the bytes can actually carry. */
export const code49SnapHeight = (height: number, moduleWidth: number): number =>
  code49RowMultiplier(height, moduleWidth) * code49Module(moduleWidth);

/** Rows behind a measured stack; reads the SNAPPED start height, the one bwip
 *  actually drew. Rows hold still through a resize. */
const code49Rows = (start: { rowHeight: number; nodeHeight: number }, mw: number): number =>
  Math.max(2, Math.round(stackRowCount(start.nodeHeight, code49SnapHeight(start.rowHeight, mw), mw)));

export interface Code49Props {
  content: string;
  height: number;
  moduleWidth: number;
  printInterpretation: boolean;
  printInterpretationAbove: boolean;
  mode: Code49Mode;
  rotation: ZplRotation;
}

export const code49: ObjectTypeCore<Code49Props> = {
  label: 'Code 49',
  icon: 'C49',
  zplCmd: '^B4',
  group: 'legacy',
  barcodeClass: '1d',
  bindable: true,
  preflight: limitedSupportPreflight<Code49Props>('moduleWidth'),
  // ZD230-measured at module widths 2/3/4: 26/35/44 above, 20/27/34 below.
  hri: { zoneDots: (mw, above) => (above ? 9 : 7) * code49Module(mw) + (above ? 8 : 6) },
  defaultProps: {
    content: '',
    height: 20,
    moduleWidth: 2,
    printInterpretation: true,
    printInterpretationAbove: false,
    mode: 'A',
    rotation: 'N',
  },
  placeholderContent: 'CODE49',
  defaultSize: { width: 300, height: 120 },

  // Snap so a drag past the limit lands in props, not just in the render.
  commitTransform: (obj, ctx) => {
    const next = commitBarcodeWidthHeightTransform(obj, ctx);
    const mw = next.moduleWidth ?? obj.props.moduleWidth;
    const rawH = next.height ?? obj.props.height;
    return { ...next, height: code49SnapHeight(rawH, mw) };
  },

  // The height input's min/max guards only its own field. Non-positive
  // widths (JSON import, undo with garbage) must not anchor the clamp.
  normalizeChanges: (obj, changes) => {
    const nextProps = changes.props as Partial<Code49Props> | undefined;
    if (!nextProps) return changes;
    const mwChanged = nextProps.moduleWidth !== undefined;
    const heightChanged = nextProps.height !== undefined;
    if (!mwChanged && !heightChanged) return changes;
    const mw = nextProps.moduleWidth ?? obj.props.moduleWidth;
    if (!Number.isFinite(mw) || mw < 1) return changes;
    const curH = nextProps.height ?? obj.props.height;
    // Only a height edit snaps here; a width-only sweep would otherwise
    // ratchet the height up pass by pass. (Release still snaps, via commit.)
    const nextH = heightChanged
      ? code49SnapHeight(curH, mw)
      : Math.min(code49MaxHeight(mw), Math.max(code49MinHeight(mw), curH));
    return nextH === curH
      ? changes
      : { ...changes, props: { ...nextProps, height: nextH } };
  },

  // A one-module separator sits above, below and between the rows.
  barStack: (start, props) => {
    const gapDots = code49Module(props.moduleWidth);
    return { rows: code49Rows(start, gapDots), gapDots };
  },

  constrainProps: (props) => ({ height: code49SnapHeight(props.height, props.moduleWidth) }),

  toZPL: (obj, ctx) => {
    const p = obj.props;
    const mw = code49Module(p.moduleWidth);
    const h = code49RowMultiplier(p.height, mw);
    const interp = p.printInterpretation ? (p.printInterpretationAbove ? 'A' : 'B') : 'N';
    return [
      `^BY${mw}`,
      fieldPos1d(obj, ctx),
      `^B4${p.rotation},${h},${interp},${p.mode}`,
      fdFieldFor(p.content, ctx),
    ]
      .filter(Boolean)
      .join('');
  },
};
