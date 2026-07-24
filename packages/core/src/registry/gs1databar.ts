import type { LabelObjectBase } from '../types/LabelObject';
import type { ObjectTypeCore } from '../types/ObjectType';
import { fieldPos1d, fdFieldFor } from './zplHelpers';
import { moduleTooSmallPreflight } from '../lib/barcodeScannability';
import { type ZplRotation } from './rotation';
import {
  GS1_DATABAR_DEFAULT_SEGMENTS,
  GS1_DATABAR_EXPANDED_SYMBOLOGIES,
  GS1_EXPANDED_CHARSET,
  elementStringToContent,
} from '../lib/gs1';
import type { ContentSpec } from './contentSpec';

export interface Gs1DatabarProps {
  content: string;
  /** ^BR p[2] magnification multiplier (1-10). Generator emits the
   *  same value to ^BY moduleWidth by Zebra convention. */
  magnification: number;
  symbology: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  segments?: number;
  rotation: ZplRotation;
}

// ZPL ^BR height parameter. Zebra firmware overrides this with each variant's
// intrinsic bar height for sym 1–5; only Expanded Stacked (sym 7) uses it as
// per-row height. Hardcoded because heightLocked: true forbids resizing.
const ZPL_HEIGHT_PLACEHOLDER = 100;

// Stable specs so the sanitiser/regex WeakMap caches hit across keystrokes.
// Expanded carries multi-AI GS1 data: restrict to the GS1 charset and keep the
// "(01)…(10)…" element-string paste shortcut. Non-expanded (sym 1-5) is a bare
// numeric GTIN.
const EXPANDED_SPEC: ContentSpec = { charset: GS1_EXPANDED_CHARSET, normalize: elementStringToContent };
const GTIN_SPEC: ContentSpec = { charset: '0-9' };

// GS1 standard variant names. Kept in source rather than i18n because the spec
// defines them as proper nouns (matches the convention used for barcode-type
// labels like "GS1 Databar", "PDF417" in src/locales).
export const SYMBOLOGY_LABELS: Record<Gs1DatabarProps['symbology'], string> = {
  1: 'Omnidirectional',
  2: 'Truncated',
  3: 'Stacked',
  4: 'Stacked Omni',
  5: 'Limited',
  6: 'Expanded',
  7: 'Expanded Stacked',
};

export const gs1databar: ObjectTypeCore<Gs1DatabarProps> = {
  label: 'GS1 Databar',
  icon: 'GS1',
  zplCmd: '^BR',
  group: 'code-1d',
  barcodeClass: '1d',
  bindable: true,
  preflight: moduleTooSmallPreflight<Gs1DatabarProps>('magnification'),
  defaultProps: {
    content: '',
    magnification: 2,
    symbology: 1,
    rotation: 'N',
  },
  placeholderContent: '0112345678901',
  defaultSize: { width: 300, height: 120 },
  heightLocked: true,

  contentSpec: (props) =>
    GS1_DATABAR_EXPANDED_SYMBOLOGIES.has((props as Gs1DatabarProps).symbology)
      ? EXPANDED_SPEC
      : GTIN_SPEC,

  // GS1-ness is the symbology variant, not a props.gs1 flag: expanded (6/7)
  // carries multi-AI GS1 content, sym 1-5 a bare GTIN. Carrying GS1 in lands
  // on Expanded.
  gs1Capable: true,
  gs1Active: (props) => GS1_DATABAR_EXPANDED_SYMBOLOGIES.has((props as Gs1DatabarProps).symbology),
  gs1EnterProps: { symbology: 6 },

  toZPL: (obj: LabelObjectBase & { props: Gs1DatabarProps }, ctx) => {
    const p = obj.props;
    // ^BRo,s,m,sep,h[,sg]: segments must only be present for Expanded Stacked (7).
    // Including segments on sym 1–6 makes Labelary stack the symbol (wrong rendering).
    const segs = p.symbology === 7 ? `,${p.segments ?? GS1_DATABAR_DEFAULT_SEGMENTS}` : '';
    return `^BY${p.magnification}${fieldPos1d(obj, ctx)}^BR${p.rotation},${p.symbology},${p.magnification},2,${ZPL_HEIGHT_PLACEHOLDER}${segs}${fdFieldFor(p.content, ctx)}`;
  },
};
