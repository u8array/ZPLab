import type { ObjectTypeCore } from '../types/ObjectType';
import { fieldPos1d, fdFieldFor } from './zplHelpers';
import { commitBarcodeWidthHeightTransform } from './transformHelpers';
import { limitedSupportPreflight } from '../lib/barcodeScannability';
import { type ZplRotation } from './rotation';

/** ZPL ^B4 m: 'A' = auto subset. 0-5 force a specific subset. */
export type Code49Mode = 'A' | '0' | '1' | '2' | '3' | '4' | '5';

export const CODE49_MODES: readonly Code49Mode[] = ['A', '0', '1', '2', '3', '4', '5'];

// bwip-js rejects code49 rowheight outside 8..50 modules.
export const code49MinHeight = (moduleWidth: number) => 8 * Math.max(moduleWidth, 1);
export const code49MaxHeight = (moduleWidth: number) => 50 * Math.max(moduleWidth, 1);

export interface Code49Props {
  content: string;
  height: number;
  moduleWidth: number;
  printInterpretation: boolean;
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
  defaultProps: {
    content: '',
    height: 20,
    moduleWidth: 2,
    printInterpretation: true,
    mode: 'A',
    rotation: 'N',
  },
  placeholderContent: 'CODE49',
  defaultSize: { width: 300, height: 120 },

  // Clamp height into bwip's range so drag past the limit lands in
  // props (not just in the render); otherwise ZPL h drifts from
  // the visible bars.
  commitTransform: (obj, ctx) => {
    const next = commitBarcodeWidthHeightTransform(obj, ctx);
    const mw = next.moduleWidth ?? obj.props.moduleWidth;
    const rawH = next.height ?? obj.props.height;
    return {
      ...next,
      height: Math.min(code49MaxHeight(mw), Math.max(code49MinHeight(mw), rawH)),
    };
  },

  // Re-clamp height when moduleWidth shifts the valid range (the
  // height input's own min/max only guards its own field). Skip on
  // non-positive moduleWidth so JSON-import / undo with garbage
  // doesn't anchor the clamp.
  normalizeChanges: (obj, changes) => {
    const nextProps = changes.props as Partial<Code49Props> | undefined;
    if (!nextProps || nextProps.moduleWidth === undefined) return changes;
    const newMw = nextProps.moduleWidth;
    if (!Number.isFinite(newMw) || newMw < 1) return changes;
    const curH = nextProps.height ?? obj.props.height;
    const clampedH = Math.min(
      code49MaxHeight(newMw),
      Math.max(code49MinHeight(newMw), curH),
    );
    return clampedH === curH
      ? changes
      : { ...changes, props: { ...nextProps, height: clampedH } };
  },

  toZPL: (obj, ctx) => {
    const p = obj.props;
    const interp = p.printInterpretation ? 'Y' : 'N';
    return [
      `^BY${p.moduleWidth}`,
      fieldPos1d(obj, ctx),
      `^B4${p.rotation},${p.height},${interp},${p.mode}`,
      fdFieldFor(p.content, ctx),
    ]
      .filter(Boolean)
      .join('');
  },
};
