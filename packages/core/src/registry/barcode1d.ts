import type { PropSpecs } from '../types/propSpec';
import type { LabelObjectBase, ObjectGroup } from '../types/LabelObject';
import type { ObjectTypeCore } from '../types/ObjectType';
import type { HriBehavior } from '../types/ZplEmit';
import { fieldPos1d, fdFieldFor } from './zplHelpers';
import { serialFieldData, type SerialMode } from './serialField';
import { commitBarcodeWidthHeightTransform, moduleWidthSpec } from './transformHelpers';
import { hasTemplateMarkers } from '../lib/fnTemplate';
import { moduleTooSmallPreflight } from '../lib/barcodeScannability';
import { classifyField } from '../lib/variableField';
import { isLoneMarker } from '../types/Variable';
import { code128Mode, planCode128Fd } from '../lib/code128Plan';
import { resolveControlMarkers } from '../types/controlKey';
import { parseGs1ToSegments, segmentsToZplFd } from '../lib/gs1';
import { planGs1Fd } from '../lib/gs1Plan';
import { GS1_CONTENT_SPEC } from './gs1FieldSpec';
import type { ContentSpec } from '../types/contentSpec';
import { ROTATION_SPEC, type ZplRotation } from './rotation';

export const MSI_CHECK_MODES = ['C', 'D'] as const;
/** Absent is N, and D comes from `gs1`. */
export const CODE128_STORED_MODES = ['A'] as const;

export interface Barcode1DProps {
  content: string;
  height: number;
  moduleWidth: number;
  printInterpretation: boolean;
  /** HRI above the bars (ZPL g-param) instead of below; default false. */
  printInterpretationAbove?: boolean;
  checkDigit: boolean;
  rotation: ZplRotation;
  serial?: SerialMode;
  /** Template snapshot from before serial mode replaced `content` with the
   *  seed; consumed by the serial-off restore. Never emitted. */
  preSerialContent?: string;
  /** GS1-128 mode (`^BC…,D`). Only honoured by a `gs1Capable` symbology. */
  gs1?: boolean;
  /** ^BC m=A, the firmware's automatic subsets. Code 128 only, and `gs1` wins. */
  mode?: (typeof CODE128_STORED_MODES)[number];
  /** MSI multi-check ^BM e beyond the boolean (C = 2x Mod 10, D = Mod 11 +
   *  Mod 10); set by import, not the panel. */
  msiCheckMode?: (typeof MSI_CHECK_MODES)[number];
  /** ^BM e2: HRI includes the check digits. Set by import, not the panel. */
  msiHriCheck?: boolean;
}

export interface Barcode1DCoreConfig {
  label: string;
  icon: string;
  /** See {@link ObjectTypeCore.placeholderContent}. New objects start blank. */
  placeholderContent: string;
  /** Build the ZPL barcode command (e.g. `^BUN,100,Y,N,N`). */
  zplCommand: (p: Barcode1DProps) => string;
  group: ObjectGroup;
  /**
   * Explicit wide-to-narrow ratio for the ^BY command.
   * ZPL defaults to 3.0, but some barcode standards (MSI, Plessey) define a
   * fixed 2:1 ratio, which bwip-js also hardcodes internally. Setting byRatio
   * here ensures Labelary uses the same ratio as the canvas rendering.
   */
  byRatio?: number;
  /** See {@link ObjectTypeCore.heightLocked}. */
  heightLocked?: boolean;
  /** See {@link ObjectTypeCore.interpretationLocked}. */
  interpretationLocked?: boolean;
  /** See {@link HriBehavior}. */
  hri?: HriBehavior;
  /** Transform stored content into the ^FD payload (e.g. UPC-E prepends
   *  the number-system digit the spec requires). Default: identity. */
  fdContent?: (content: string) => string;
  /** Default true. EAN/UPC set false: their fixed-length check digit (which our
   *  content may already include) would be corrupted by ^SN/^SF incrementing. */
  serialisable?: boolean;
  /** Symbology offers a GS1 mode (Code 128 → GS1-128); `zplCommand` must emit
   *  the mode flag when `props.gs1` is set. */
  gs1Capable?: boolean;
  /** Symbology offers ^BC m=A. Declared here so the panel reads one flag, the emit reads m from the props. */
  autoModeCapable?: boolean;
  /** See {@link ObjectTypeCore.contentSpec}; static half, GS1 mode is derived. */
  contentSpec?: ContentSpec;
  /** See {@link ObjectTypeCore.controlChars}. */
  controlChars?: boolean;
  /** Encode a resolved literal payload that carries control bytes into the
   *  symbology's own escape form, see code128Subset. Null falls back to the
   *  ^FH emit. */
  ctrlFdEncode?: (payload: string) => string | null;
  /** Escape the characters the symbology's own ^FD grammar would swallow
   *  (Code 128 reads `>` as an invocation code). Applied to every non-GS1
   *  payload, including a template's literal text. */
  fdPlainEscape?: (payload: string) => string;
}

const gs1ModeDFd = (s: string): string => planGs1Fd(s, 'code128').fd;

export const BARCODE_1D_PROP_SPECS: PropSpecs<Barcode1DProps> = {
  content: { type: 'string' },
  height: { type: 'number', scale: 'dots' },
  moduleWidth: moduleWidthSpec(),
  printInterpretation: { type: 'boolean' },
  printInterpretationAbove: { type: 'boolean' },
  checkDigit: { type: 'boolean' },
  rotation: ROTATION_SPEC,
  serial: { type: 'object' },
  preSerialContent: { type: 'string' },
  gs1: { type: 'boolean' },
  mode: { type: 'string', values: CODE128_STORED_MODES },
  msiCheckMode: { type: 'string', values: MSI_CHECK_MODES },
  msiHriCheck: { type: 'boolean' },
};

export function createBarcode1DCore(config: Barcode1DCoreConfig): ObjectTypeCore<Barcode1DProps> {
  const defaultProps: Barcode1DProps = {
    content: '',
    height: 100,
    moduleWidth: 2,
    printInterpretation: !config.interpretationLocked,
    printInterpretationAbove: false,
    checkDigit: false,
    rotation: 'N',
  };
  // Obj-aware ^FD transform for literal/single-bind payloads, shared by toZPL
  // and the batch override. Templates skip the content transform (it would
  // mangle #n# references); GS1 templates pre-map at segment level in toZPL.
  const fdTransformFor =
    config.fdContent || config.gs1Capable || config.fdPlainEscape
      ? (obj: LabelObjectBase & { props: Barcode1DProps }) => {
          const gs1 = config.gs1Capable === true && obj.props.gs1 === true;
          // GS1 mode brings its own escaping, and m=A reads the payload literally.
          const escape = code128Mode(obj.props) === 'N' ? config.fdPlainEscape : undefined;
          // A lone marker (single-bind) still transforms its default/CSV value;
          // only a real template is skipped. Ctrl-capable types resolve chips
          // first: chips-only is non-template there.
          const isTemplate =
            hasTemplateMarkers(
              config.controlChars === true
                ? resolveControlMarkers(obj.props.content)
                : obj.props.content,
            ) && !isLoneMarker(obj.props.content);
          const base = isTemplate ? undefined : gs1 ? gs1ModeDFd : config.fdContent;
          // The plain grammar encodes a control byte in its invocation form. Any other m leaves it to ^FH,
          // and so does a template, as ^FE tokens cannot survive inside the invocation form.
          const wire = !isTemplate && config.controlChars === true && !gs1 && escape && config.ctrlFdEncode
            ? (s: string) => planCode128Fd(s, 'whole').fd
            : escape;
          return !base ? wire : !wire ? base : (s: string) => wire(base(s));
        }
      : undefined;

  // Single source for the palette command icon: derive the `^Bx` prefix from
  // the same zplCommand the generator uses, so there's no second literal.
  const zplCmd = config.zplCommand(defaultProps).match(/^\^[A-Z0-9]{2}/)?.[0];
  return {
    label: config.label,
    icon: config.icon,
    zplCmd,
    group: config.group,
    barcodeClass: '1d',
    bindable: true,
    // EAN/UPC opt out (fixed-length check digit); every other 1D serializes cleanly.
    serialisable: config.serialisable ?? true,
    propSpecs: BARCODE_1D_PROP_SPECS,
    defaultProps,
    placeholderContent: config.placeholderContent,
    defaultSize: { width: 300, height: 120 },
    heightLocked: config.heightLocked,
    interpretationLocked: config.interpretationLocked,
    hri: config.hri,
    // GS1 mode swaps in the shared GS1 element-string spec; the static half
    // stays the symbology's own rule.
    contentSpec: config.gs1Capable
      ? (props) => ((props as Barcode1DProps).gs1 ? GS1_CONTENT_SPEC : config.contentSpec)
      : config.contentSpec,
    gs1Capable: config.gs1Capable,
    controlChars: config.controlChars,
    ctrlNeedsOwnEscape: config.ctrlFdEncode !== undefined,

    preflight: moduleTooSmallPreflight<Barcode1DProps>('moduleWidth'),

    // heightLocked symbologies disable the transformer entirely; others scale
    // bar height with sy and module width with sx (clamped in the helper).
    commitTransform: config.heightLocked
      ? undefined
      : (obj, ctx) => commitBarcodeWidthHeightTransform(obj, ctx, BARCODE_1D_PROP_SPECS),

    // e.g. UPC-E compaction; shared with the CSV batch override so a per-row
    // value is compacted the same way as the single-format default. A template
    // field keeps only the plain escape (see fdTransformFor; GS1 templates are
    // handled by toZPL's segment-level ^FD pre-map instead).
    fdTransform: fdTransformFor,

    toZPL: (obj, ctx) => {
      // g (HRI above) is only valid when f (interpretation) is on, and
      // interpretationLocked symbologies (e.g. ^BR) have no HRI in ZPL at all.
      // Normalize both so a stale/legacy prop never emits an out-of-spec flag.
      const printInterpretation =
        !config.interpretationLocked && obj.props.printInterpretation;
      const p = {
        ...obj.props,
        printInterpretation,
        printInterpretationAbove:
          printInterpretation && obj.props.printInterpretationAbove,
      };
      const byCmd = config.byRatio !== undefined
        ? `^BY${p.moduleWidth},${config.byRatio}`
        : `^BY${p.moduleWidth}`;
      // Serial mode: the seed is wrapped by ^SN/^SF. It still runs through the
      // symbology's fdContent transform (e.g. UPC-E's number-system prefix) so a
      // serialized barcode emits the same payload shape as a non-serial one.
      const fdTransform = fdTransformFor?.(obj);
      // GS1 TEMPLATE payload: pre-map to the mode-D ^FD form at SEGMENT level
      // BEFORE ^FE embed expansion (the post-embed transform would mangle the
      // #n# references). Unparseable content falls back to raw emit; marker
      // VALUES are escaped at their ^FN declaration (gs1ModeDExclusiveFns).
      let content = p.content;
      let fdTransformOnce = fdTransform;
      // Shared-slot single-bind: one ^FN value serves several field types, so
      // the Code 128 escape would corrupt the co-consumers; emit raw like
      // mode-D does (preflight warns on the value instead).
      const plainEscape = code128Mode(p) === 'N' ? config.fdPlainEscape : undefined;
      if (plainEscape && ctx?.rawFdFns && ctx.variables
          && isLoneMarker(content)) {
        const cls = classifyField(content, ctx.variables);
        if (cls.kind === 'single' && ctx.rawFdFns.has(cls.variable.fnNumber)) {
          fdTransformOnce = (s: string) => planCode128Fd(s, 'sharedRaw').fd;
        }
      }
      // Template payload: escape literal spans BEFORE ^FE/^FC tokenization. A
      // clock char may be '=' or '<', so a post-token escape would read a
      // literal `>` next to a token as an invocation and skip the `>0`.
      // Chips-only payloads stay raw for fdTransformFor's invocation plan;
      // marker BODIES stay raw too (names may carry >/^/~).
      if (plainEscape && !isLoneMarker(content)
          && hasTemplateMarkers(resolveControlMarkers(content))) {
        content = planCode128Fd(content, 'template').fd;
        fdTransformOnce = undefined;
      }
      if (config.gs1Capable && p.gs1 && hasTemplateMarkers(content) && !isLoneMarker(content)) {
        const segs = ctx?.variables ? parseGs1ToSegments(content, ctx.variables) : null;
        // Already the ^FD form; a second transform would double the >0 escapes.
        if (segs && segs.length > 0) {
          content = segmentsToZplFd(segs);
          fdTransformOnce = undefined;
        }
      }
      const fieldData = obj.props.serial && !p.gs1
        // GS1 excluded (legacy models may carry both flags): the alnum seed
        // filter would eat the >8 FNC1 and merge AI values. Serial seeds skip
        // fdPlainEscape (an injected `>0` would leave a stray 0 in the ^SF
        // mask) and a template seed skips the base transform too.
        ? serialFieldData(
            // No gs1 arm: the serial path is gated on !p.gs1 above.
            (hasTemplateMarkers(p.content) && !isLoneMarker(p.content)
              ? undefined
              : config.fdContent
            )?.(p.content) ?? p.content,
            obj.props.serial)
        : fdFieldFor(content, ctx, fdTransformOnce, undefined,
            // Chips resolve only outside GS1 mode (a raw byte would corrupt
            // the element-string payload).
            config.controlChars === true && !p.gs1);
      return [
        fieldPos1d(obj, ctx),
        // In-span after the field opener, see qrcode.
        byCmd,
        config.zplCommand(p),
        fieldData,
      ].filter(Boolean).join('');
    },
  };
}
