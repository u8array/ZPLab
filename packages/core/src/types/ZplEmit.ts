import type { Variable } from './Variable';
import type { LabelConfig } from './LabelConfig';

export interface TransformContext {
  /** Konva scaleX from the transform end. */
  sx: number;
  /** Konva scaleY from the transform end. */
  sy: number;
  /** Snaps a value to the user's grid (identity when snap is disabled). */
  snap: (n: number) => number;
  /** Konva node's intrinsic height after scale was reset. Only meaningful for stacked 2D. */
  nodeHeight: number;
  /** ^FB block resize intent: "frame" edits blockWidth/line cap, "glyph"
   *  edits font width/height. Set by the canvas (toggle + Alt override);
   *  undefined for non-block commits, which keep their default behaviour. */
  resizeMode?: "frame" | "glyph";
  /** Captured at drag start; shape varies by anchor kind (row for
   *  stacked 2D, moduleWidth for 1D barcodes). Consumers narrow on
   *  `kind` before reading the type-specific fields. */
  anchor:
    | { kind: "row"; nodeHeight: number; rowHeight: number; nodeWidth: number; moduleWidth: number }
    | { kind: "moduleWidth"; nodeWidth: number; moduleWidth: number }
    | null;
}

export interface ZplEmitContext {
  label: LabelConfig;
  /** Bound field emits `^FN{n}^FD{default}^FS`. */
  variables?: readonly Variable[];
  /** ^FE delimiter; default `#`. */
  embedChar?: string;
  /** ^FC chars; defaults `% { #`. */
  clockChars?: { date: string; time: string; tertiary: string };
  /** ^FN slots a plain ^BC single-bind must emit RAW (chip-resolved only):
   *  the slot is shared, so the Code 128 escape would corrupt co-consumers. */
  rawFdFns?: ReadonlySet<number>;
  /** ^FN slots a ^XF recall supplies: the stored format must carry no ^FD
   *  for them or the template data wins, for placed fields and ^FE embeds
   *  alike (ZD230-measured, #407; Labelary cannot referee the embed case). */
  bareFnSlots?: ReadonlySet<number>;
}

/** The prop slice HRI formatters may read; every leaf props bag satisfies it. */
export interface HriFormatProps {
  checkDigit?: boolean;
  msiCheckMode?: "C" | "D";
  msiHriCheck?: boolean;
}

/** Per-type HRI overrides; defaults render text below bars in raw form. */
export interface HriBehavior {
  /** HRI sits above bars (logmars, ^BS). */
  textAbove?: boolean;
  /** Firmware-reserved band in dots when the generic module-scaled line does
   *  not match it (^B4 differs above vs below). */
  zoneDots?: (moduleWidth: number, above: boolean) => number;
  /** Bar-to-text gap in dots; function form for moduleWidth dependence (^BS). */
  aboveGapDots?: number | ((moduleWidth: number) => number);
  /** Transform raw content for display; default identity. `props` is the
   *  leaf's props bag (Code 11 reads checkDigit, MSI its ^BM extras). */
  formatHri?: (content: string, props?: HriFormatProps) => string;
  /** Start/stop marker flanking the HRI text: Code 11 triangle and Code 93
   *  square are shapes (no font glyph); Code 39 asterisk is a real glyph but
   *  rendered as a flanking node so it can be lowered to sit centered. */
  startStopGlyph?: "triangle" | "square" | "asterisk";
  /** Override the generic per-module em sizing with explicit per-module
   *  em font dots (^BS reuses the EAN OCR-B step table). */
  fontDots?: (moduleWidth: number) => number;
  /** HRI font family; default is Labelary's Font A (Vera). Function form
   *  for moduleWidth dependence (^BS follows the EAN/UPC Vera-then-OCR-B
   *  switch). */
  fontFamily?: string | ((moduleWidth: number) => string);
}
