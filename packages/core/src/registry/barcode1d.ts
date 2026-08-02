import type { LabelObjectBase, ObjectGroup } from '../types/LabelObject';
import type { ObjectTypeCore } from '../types/ObjectType';
import type { HriBehavior } from '../types/ZplEmit';
import { fieldPos1d, fdFieldFor } from './zplHelpers';
import { serialFieldData, type SerialMode } from './serialField';
import { commitBarcodeWidthHeightTransform } from './transformHelpers';
import { hasTemplateMarkers } from '../lib/fnTemplate';
import { moduleTooSmallPreflight } from '../lib/barcodeScannability';
import { classifyField, isLoneMarker } from '../lib/variableField';
import { code128EscapeLiterals } from '../lib/code128Subset';
import { resolveControlMarkers } from '../types/controlKey';
import { gs1ContentToZplFd, parseGs1ToSegments, segmentsToZplFd } from '../lib/gs1';
import { GS1_CONTENT_SPEC } from './gs1FieldSpec';
import type { ContentSpec } from '../types/contentSpec';
import { type ZplRotation } from './rotation';

export interface Barcode1DProps {
  content: string;
  height: number;
  moduleWidth: number;
  printInterpretation: boolean;
  /** HRI above the bars (ZPL g-param) instead of below; default false. */
  printInterpretationAbove?: boolean;
  checkDigit: boolean;
  rotation: ZplRotation;
  /** Per-field firmware counter (^SN/^SF). When set, the ^FD payload is the
   *  seed and serializes per label. Mutually exclusive with variable binding. */
  serial?: SerialMode;
  /** Template snapshot from before serial mode replaced `content` with the
   *  seed; consumed by the serial-off restore. Never emitted. */
  preSerialContent?: string;
  /** GS1-128 mode (`^BC…,D`). Only honoured by a `gs1Capable` symbology. */
  gs1?: boolean;
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
  /** See {@link ObjectTypeCore.contentSpec}; static half, GS1 mode is derived. */
  contentSpec?: ContentSpec;
  /** See {@link ObjectTypeCore.controlChars}. */
  controlChars?: boolean;
  /** Encode a resolved literal payload that carries control bytes into the
   *  symbology's own escape form, because the firmware drops ^FH-escaped C0
   *  bytes from the symbol. Null falls back to the ^FH emit. */
  ctrlFdEncode?: (payload: string) => string | null;
  /** Escape the characters the symbology's own ^FD grammar would swallow
   *  (Code 128 reads `>` as an invocation code). Applied to every non-GS1
   *  payload, including a template's literal text. */
  fdPlainEscape?: (payload: string) => string;
}

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
          // GS1 mode brings its own escaping.
          const escape = obj.props.gs1 ? undefined : config.fdPlainEscape;
          // A lone marker (single-bind) still transforms its default/CSV value;
          // only a real template is skipped. Ctrl-capable types resolve chips
          // first: chips-only is non-template there (whole-field ctrlEncode).
          const isTemplate =
            hasTemplateMarkers(
              config.controlChars === true
                ? resolveControlMarkers(obj.props.content)
                : obj.props.content,
            ) && !isLoneMarker(obj.props.content);
          const base = isTemplate
            ? undefined
            : config.gs1Capable && obj.props.gs1
              ? gs1ContentToZplFd
              : config.fdContent;
          // Non-template payloads are whole ^FD values, so control bytes in a
          // bound default/CSV cell encode in the symbology's own form; the
          // ^FH hex fdField would otherwise drop them from the symbol.
          const ctrlEncode =
            !isTemplate && escape && config.ctrlFdEncode && config.controlChars === true
              ? config.ctrlFdEncode
              : undefined;
          const plain = !base ? escape : !escape ? base : (s: string) => escape(base(s));
          if (!ctrlEncode || !plain) return plain;
          // Resolve once so the ^FH fallback gets bytes, not chip marker text.
          return (s: string) => {
            const r = resolveControlMarkers(s);
            return ctrlEncode(r) ?? plain(r);
          };
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
      : commitBarcodeWidthHeightTransform,

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
      if (!p.gs1 && config.fdPlainEscape && ctx?.rawFdFns && ctx.variables
          && isLoneMarker(content)) {
        const cls = classifyField(content, ctx.variables);
        if (cls.kind === 'single' && ctx.rawFdFns.has(cls.variable.fnNumber)) {
          fdTransformOnce = resolveControlMarkers;
        }
      }
      // Template payload: escape literal spans BEFORE ^FE/^FC tokenization. A
      // clock char may be '=' or '<', so a post-token escape would read a
      // literal `>` next to a token as an invocation and skip the `>0`.
      // Chips-only payloads stay raw for fdTransformFor's invocation plan;
      // marker BODIES stay raw too (names may carry >/^/~).
      if (!p.gs1 && config.fdPlainEscape && !isLoneMarker(content)
          && hasTemplateMarkers(resolveControlMarkers(content))) {
        content = code128EscapeLiterals(content);
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
      // Control bytes on non-template payloads take the symbology's own
      // escape via the fdTransformFor ctrlEncode wrap; templates keep ^FH
      // (^FE tokens cannot survive inside the escape form).
      const fieldData = obj.props.serial
        // Serial seeds skip fdPlainEscape: ^SN data is filtered alphanumeric,
        // and an injected `>0` would leave a stray 0 in the ^SF mask. A
        // template seed skips the base transform too (pre-escape behaviour).
        ? serialFieldData(
            (hasTemplateMarkers(p.content) && !isLoneMarker(p.content)
              ? undefined
              : config.gs1Capable && p.gs1 ? gs1ContentToZplFd : config.fdContent
            )?.(p.content) ?? p.content,
            obj.props.serial)
        : fdFieldFor(content, ctx, fdTransformOnce, undefined,
            // Chips resolve only outside GS1 mode (a raw byte would corrupt
            // the element-string payload).
            config.controlChars === true && !p.gs1);
      return [
        byCmd,
        fieldPos1d(obj, ctx),
        config.zplCommand(p),
        fieldData,
      ].filter(Boolean).join('');
    },
  };
}
