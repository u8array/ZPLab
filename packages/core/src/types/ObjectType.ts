import type { LabelObjectBase, ObjectChanges, ObjectGroup } from './LabelObject';
import type { ContentSpec } from './contentSpec';
import type { HriBehavior, TransformContext, ZplEmitContext } from './ZplEmit';
import type { PreflightCtx, PreflightProducerResult } from './preflight';
import type { DeviceFontLabel } from './LabelConfig';


/** Same label slice preflight gets; lets normalizeChanges resolve the
 *  effective device font (^CF default) where it needs one. */
export interface NormalizeChangesCtx {
  label?: DeviceFontLabel;
}

/** Domain half of a registry entry: emits ZPL, no React deps. */
export interface ObjectTypeCore<P extends object = object> {
  label: string;
  icon: string;
  /** Primary ZPL command this type emits (e.g. `^BC`, `^GB`, `^A`). Single
   *  source for the palette's power-user command icon. */
  zplCmd?: string;
  /** Per-object override of `zplCmd` for types whose command depends on props
   *  (e.g. a line emits `^GB` axis-aligned but `^GD` diagonal). Falls back to
   *  `zplCmd` when absent. */
  zplCmdFor?: (obj: LabelObjectBase & { props: P }) => string;
  group: ObjectGroup;
  defaultProps: P;
  /** Sample the canvas and the preview overlay render while the field is
   *  blank, so an unconfigured barcode keeps its true symbology footprint.
   *  Never reaches emit or print; the blank field's ^FD stays empty. */
  placeholderContent?: string;
  /** Prop overrides for sample rendering, so the sample stays encodable where
   *  the object's own props wouldn't (a forced ^BX size reverts to auto). The
   *  sample is the fallback for uncodable content, so it must never fail
   *  itself. Canvas/overlay only; never emitted. */
  sampleProps?: Partial<P>;
  /** Drop footprint: dots (editor default) or mm (spec-fixed types
   *  like Maxicode). Palette resolves against current label dpmm. */
  defaultSize:
    | { width: number; height: number }
    | { widthMm: number; heightMm: number };
  /** Dimensional truth for emit/rotation/bounds consumers: '1d' = linear bars
   *  (HRI overlay, width-from-modules transformer), 'stacked2d' = row-stacked
   *  matrix (PDF417 family). Distinct from the palette-only `group` (code49 is
   *  displayed under 2D but IS dimensionally 1d). The registry derives its
   *  BARCODE_1D_TYPES / STACKED_2D_TYPES sets from this field, so a new
   *  symbology cannot silently miss them. */
  barcodeClass?: '1d' | 'stacked2d';
  /** Height fixed by symbology spec; disables transformer height anchors. */
  heightLocked?: boolean;
  /** Symbology has no HRI in ZPL output; hides checkbox + suppresses overlay. */
  interpretationLocked?: boolean;
  /** Emits ^FD via fdFieldFor; enables bind-to-variable control. */
  bindable?: boolean;
  /** Carrier offers the typed-content builder (URL/WiFi/vCard/...). Single
   *  source for cross-cutting consumers (marker-value preflight); the panels
   *  keep their own builder buttons. DataMatrix in GS1 mode carries GS1 data
   *  instead, which consumers exclude via the registry's isGs1Active. */
  typedContent?: boolean;
  /** Emitter honours `props.serial` (^SN/^SF). Only text and the free-data 1D
   *  family do; 2D/stacked emitters and fixed-check EAN/UPC do not, so the
   *  Variable-Builder hides the serial option there. */
  serialisable?: boolean;
  /** Per-symbology content charset/length rule; a function when it depends on
   *  props (GS1 mode). Drives editor input filtering and symbology-switch fit. */
  contentSpec?: ContentSpec | ((props: object) => ContentSpec | undefined);
  /** Symbology offers a GS1 mode. Lets a symbology switch carry GS1 content
   *  only to targets that can honour it. */
  gs1Capable?: boolean;
  /** Whether this object currently carries GS1 content. Default:
   *  `gs1Capable && props.gs1`; types that model GS1 differently (GS1 DataBar's
   *  expanded symbologies) override. */
  gs1Active?: (props: object) => boolean;
  /** Props patch that puts THIS type into its GS1 mode when a symbology switch
   *  carries GS1 content in. Default for `gs1Capable`: `{ gs1: true }`. */
  gs1EnterProps?: Partial<P>;
  /** Symbology can encode raw control bytes (TAB/CR/...): gates the content
   *  editor's control-key chips and the import's byte-to-chip tokenising.
   *  False/absent for fixed-charset symbologies (EAN/UPC, Code 39) and text. */
  controlChars?: boolean;
  /** Control bytes reach this symbology's symbol only through its own escape
   *  form (Code 128 invocations), never through ^FH hex, which the firmware
   *  drops. Set by the emitters that carry such an encoder. */
  ctrlNeedsOwnEscape?: boolean;
  /** 1:1 aspect-locked free resize (ellipse with lockAspect). For
   *  integer-module 2D symbologies use uniformScaleProp instead. */
  uniformScale?: boolean | ((props: P) => boolean);
  /** Integer-module 2D symbology (QR/Aztec/DataMatrix): drives drag-time
   *  module snap and release-time commit from one prop spec; implies
   *  uniformScale (the canvas is square by construction). */
  uniformScaleProp?: { name: keyof P & string; min: number; max: number };
  /** ^BY moduleWidth lower bound for stacked-2D resize (default 1); CODABLOCK A
   *  requires 2. Drives both the drag-time snap and the release commit. */
  moduleWidthMin?: number;
  /** Further 1-10 module-width props (TLC39's ^BT w2) so the density rescale
   *  scales them like moduleWidth without a per-type special case. */
  extraModuleWidthProps?: readonly (keyof P & string)[];
  toZPL: (obj: LabelObjectBase & { props: P }, ctx?: ZplEmitContext) => string;
  /** Optional ^FD payload transform (QR `{ec}A,` prefix, UPC-E compaction, GS1
   *  FNC1 escaping). Returned per object so the single emit AND the CSV batch
   *  ^FN override apply the same transform; undefined when none applies. */
  fdTransform?: (
    obj: LabelObjectBase & { props: P },
  ) => ((payload: string) => string) | undefined;
  /** Pure hook for type-specific clamp/invariant on incoming changes. */
  normalizeChanges?: (
    obj: LabelObjectBase & { props: P },
    changes: ObjectChanges,
    ctx?: NormalizeChangesCtx,
  ) => ObjectChanges;
  /** Pure hook: maps Konva Transformer scale to prop changes on transform end. */
  commitTransform?: (
    obj: LabelObjectBase & { props: P },
    ctx: TransformContext,
  ) => Partial<P>;
  /** Only for 1D barcodes with an HRI overlay; see {@link HriBehavior}. */
  hri?: HriBehavior;
  /** Pure per-type preflight checks the geometry pass can't see (e.g. block
   *  text too narrow to print, barcode module too small to scan). Returns
   *  findings without objectId/severity; computePreflight stamps both. */
  preflight?: (
    obj: LabelObjectBase & { props: P },
    ctx: PreflightCtx,
  ) => PreflightProducerResult[];
}

// The UI half (ObjectTypeUi, ObjectPanelsMap) lives in registry/panelTypes.ts:
// this file anchors the React-free domain type graph (registry-isolation.test
// tripwires the boundary).
