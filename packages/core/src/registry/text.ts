import type { ObjectTypeCore } from "../types/ObjectType";
import { textFieldPos, fdFieldFor, resolveFontCmd } from "./zplHelpers";
import { effectiveScale } from "./transformHelpers";
import { encodeFbContent } from "../lib/fbContent";
import { encodeTbContent } from "../lib/tbContent";
import { serialFieldData, type SerialMode } from "./serialField";
import { deriveBlockTextPatch } from "../lib/textBlock";
import {
  isBlockTooNarrow,
  wrapBlockLines,
  zebraLineWidthDots,
  tbLineStepDots,
  type ZplRotation,
} from "../lib/zebraTextLayout";

/** Text layout mode. 'normal' = plain ^A (no wrap), 'fb' = ^FB field
 *  block (max-lines cap, justify, hanging indent), 'tb' = ^TB text block
 *  (word-wrap clipped at a pixel height). Only 'tb' is stored explicitly;
 *  'normal' vs 'fb' is inferred from blockWidth presence so legacy designs
 *  and ^FB imports keep working. Read it through `resolveTextMode`. */
export type TextMode = "normal" | "fb" | "tb";

export function resolveTextMode(p: Pick<TextProps, "textMode" | "blockWidth" | "serial">): TextMode {
  // Serial is a plain single-line counter (^A + ^SN/^SF); block props lie
  // dormant while it is active, so the mode resolves to 'normal' regardless.
  if (p.serial) return "normal";
  if (p.textMode) return p.textMode;
  return p.blockWidth ? "fb" : "normal";
}

/** Whether the field's content may contain line breaks. Only text in a block
 *  mode (^FB/^TB) wraps to multiple lines; plain text (^A) and every barcode
 *  field is single-line, so the content editor must reject Enter there. */
export function fieldIsMultiline(obj: { type: string; props?: unknown }): boolean {
  if (obj.type !== "text") return false;
  return resolveTextMode(obj.props as Pick<TextProps, "textMode" | "blockWidth" | "serial">) !== "normal";
}

/** Primary command the text emits in its current mode: plain `^A`, field-block
 *  `^FB`, or text-block `^TB`. Drives the properties header command badge. */
export function textZplCmd(p: Pick<TextProps, "textMode" | "blockWidth" | "serial">): "^A" | "^FB" | "^TB" {
  const mode = resolveTextMode(p);
  return mode === "fb" ? "^FB" : mode === "tb" ? "^TB" : "^A";
}

export interface TextProps {
  content: string;
  fontHeight: number;
  fontWidth: number;
  rotation: ZplRotation;
  reverse?: boolean;
  /** Stored only for 'tb' (the one mode blockWidth can't disambiguate from
   *  ^FB). See `resolveTextMode`. */
  textMode?: TextMode;
  /** Printer-stored TrueType font filename. Round-trips with the
   *  `^A@{rot},{h},{w},E:NAME.TTF` form when the field references a
   *  printer-resident font directly by path. Mutually exclusive with
   *  `fontId`; if both happen to be set, `fontId` wins at emit. */
  printerFontName?: string;
  /** Single-character font identifier ([0-9A-Z]) referencing a built-in
   *  Zebra font (0, A-H) or a ^CW alias registered on the label. Emits
   *  the short `^A{id}{rot},{h},{w}` form. Mutually exclusive with
   *  `printerFontName`. */
  fontId?: string;
  /** ^FB field block properties */
  blockWidth?: number;
  blockLines?: number;
  blockLineSpacing?: number;
  blockJustify?: "L" | "C" | "R" | "J";
  /** ^FB hanging indent (dots) applied to lines 2+. Spec range 0..9999,
   *  negatives are clamped to 0 to match Labelary's observed behavior. */
  blockHangingIndent?: number;
  /** ^TB block height in dots; the rendered text is clipped at this height
   *  (Labelary truncates mid-glyph). tb-mode only. */
  blockHeight?: number;
  /** ^FP field-direction modifier. 'H' = horizontal advance (default,
   *  omitted on emit), 'V' = stack glyphs along the field's
   *  perpendicular axis, 'R' = reverse glyph order (RTL languages). */
  fpDirection?: "H" | "V" | "R";
  /** ^FP inter-character gap in dots, added on top of the font's
   *  natural advance. Omitted on emit when 0. */
  fpCharGap?: number;
  /** Per-field firmware counter (^SN/^SF). When set, the field is a serial
   *  counter: `content` is the seed value, emitted via the serial command
   *  instead of a plain/variable ^FD. While active it suppresses block/reverse/^FP
   *  at emit and render (`resolveTextMode` returns 'normal'); those props lie
   *  dormant and return when serial is turned off, so the switch is reversible. */
  serial?: SerialMode;
  /** Template snapshot from before serial mode replaced `content` with the
   *  seed; consumed by the serial-off restore. Never emitted. */
  preSerialContent?: string;
}

export const text: ObjectTypeCore<TextProps> = {
  label: "Text",
  icon: "T",
  zplCmd: "^A",
  zplCmdFor: (obj) => textZplCmd(obj.props),
  group: "text" as const,
  bindable: true,
  serialisable: true,
  // Per-row seam the CSV batch override reads: a single-bound block field's
  // row values need the block escaping re-applied (^TB `<`, ^FB `\`), exactly
  // like a barcode's fdContent. toZPL does NOT route this through fdFieldFor's
  // transform param: its template payload is pre-encoded and would double-encode.
  fdTransform: (obj) => {
    const mode = resolveTextMode(obj.props);
    return mode === "fb" ? encodeFbContent : mode === "tb" ? encodeTbContent : undefined;
  },
  defaultProps: {
    content: '',
    fontHeight: 30,
    fontWidth: 0,
    rotation: "N",
  },
  defaultSize: { width: 200, height: 40 },
  // Block modes (^FB/^TB) silently lose data two ways: a block narrower than one
  // glyph cell prints nothing (error), and content that wraps past the line cap
  // (^FB) or block height (^TB) is clipped (overset warning). Mirrors the wrap
  // the panel/canvas already use (Font-0 metrics), so the badge matches them.
  preflight: (obj) => {
    const p = obj.props;
    const mode = resolveTextMode(p);
    if (mode === "normal") return [];
    if (isBlockTooNarrow(p.blockWidth ?? 0, p.fontHeight, p.fontWidth ?? 0)) {
      return [{ kind: "blockTooNarrow" }];
    }
    // ^FB honours newlines as hard breaks; ^TB collapses them to spaces (mirrors
    // encodeTbContent), so wrap the collapsed form there to avoid false overset.
    const content = mode === "tb" ? (p.content ?? "").replace(/\n/g, " ") : (p.content ?? "");
    const lines = wrapBlockLines(content, p.blockWidth ?? 0, (line) =>
      zebraLineWidthDots(line, p.fontHeight, p.fontWidth ?? 0),
    );
    // ^TB clips at blockHeight; N lines occupy (N-1) steps plus the last line's
    // own height, not N steps (the trailing 0.25 line-gap doesn't render).
    const tbHeight = (p.blockHeight ?? 0) > 0
      ? (lines.length - 1) * tbLineStepDots(p.fontHeight) + p.fontHeight
      : 0;
    const overset =
      mode === "fb"
        ? lines.length > (p.blockLines ?? 1)
        : (p.blockHeight ?? 0) > 0 && tbHeight > (p.blockHeight ?? 0);
    return overset ? [{ kind: "textOverset" }] : [];
  },
  // Rectangle resize: corner drag updates fontHeight from sy and
  // fontWidth from sx independently. fontWidth=0 in storage is the
  // Zebra default meaning "match height"; in that case the effective
  // pre-resize width equals fontHeight, so we scale that derived value
  // by sx and persist the result. `effectiveScale` flips sx/sy for R/B
  // rotations so the user's screen-vertical drag stays attached to
  // fontHeight regardless of how Konva orients the glyphs.
  // Canonical un-emit shape so round-trips stay diff-free.
  normalizeChanges: (_obj, changes) => {
    const nextProps = changes.props as Partial<TextProps> | undefined;
    if (!nextProps) return changes;
    let patched = nextProps;
    if (patched.fpDirection === "H") patched = { ...patched, fpDirection: undefined };
    if (patched.fpCharGap === 0) patched = { ...patched, fpCharGap: undefined };
    // Hard line breaks added to a ^FB block must grow its maxLines cap, else the
    // extra lines clip. Central here so every content edit path (inline field,
    // Variable-Builder modal) gets it, not just the old panel handler.
    if (typeof patched.content === "string" && !patched.serial && !_obj.props.serial) {
      const merged = { ..._obj.props, ...patched };
      if (resolveTextMode(merged) === "fb") {
        const grown = deriveBlockTextPatch(
          patched.content,
          { blockWidth: merged.blockWidth, blockLines: merged.blockLines },
          merged.fontHeight,
          merged.fontWidth,
        );
        if (grown.blockLines !== undefined && grown.blockLines !== merged.blockLines) {
          patched = { ...patched, blockLines: grown.blockLines };
        }
      }
    }
    return patched === nextProps ? changes : { ...changes, props: patched };
  },

  commitTransform: (obj, ctx) => {
    const oldH = obj.props.fontHeight;
    const oldW = obj.props.fontWidth > 0 ? obj.props.fontWidth : oldH;
    const mode = resolveTextMode(obj.props);
    const { esx, esy } = effectiveScale(obj.props.rotation, ctx);
    // Frame mode (^FB/^TB blocks, default): the box is the wrap frame, so X
    // grows blockWidth (reflow); Y grows the line cap (^FB) or the clip height
    // (^TB). Glyph mode (and plain text): X/Y stretch the font. The canvas
    // picks the mode from the toggle, with Alt as a per-drag override.
    const frameMode = mode !== "normal" && ctx.resizeMode !== "glyph";
    if (frameMode) {
      const oldBW = obj.props.blockWidth ?? 1;
      const blockWidth = Math.max(1, ctx.snap(Math.round(oldBW * esx)));
      if (mode === "tb") {
        const oldBH = obj.props.blockHeight ?? oldH;
        return { blockWidth, blockHeight: Math.max(1, ctx.snap(Math.round(oldBH * esy))) };
      }
      const oldLines = obj.props.blockLines ?? 1;
      return { blockWidth, blockLines: Math.max(1, Math.round(oldLines * esy)) };
    }
    return {
      fontHeight: Math.max(1, ctx.snap(Math.round(oldH * esy))),
      fontWidth: Math.max(1, ctx.snap(Math.round(oldW * esx))),
    };
  },

  toZPL: (obj, ctx) => {
    const p = obj.props;
    // Serial mode: plain ^A field whose ^FD is wrapped by ^SN/^SF. No block,
    // reverse, ^FP or variable binding (those are cleared on switch).
    if (p.serial) {
      return `${textFieldPos(obj)}${resolveFontCmd(p, ctx)}${serialFieldData(p.content, p.serial)}`;
    }
    const mode = resolveTextMode(p);
    const fontCmd = resolveFontCmd(p, ctx);
    // ^FB uses `\&` line-breaks + soft hyphens; ^TB has neither and instead
    // escapes `<` as `<<>` (verified via Labelary). Literal `content` is
    // pre-encoded here (before fdFieldFor substitutes ^FE/^FC markers, which
    // must not be re-encoded); the bound-variable default is encoded inside
    // fdFieldFor via `encodeDefault`. Each encoder is symmetric with the
    // matching parser decoder, so payloads round-trip.
    let blockCmd = "";
    let content = p.content;
    let encodeDefault: (s: string) => string = (s) => s;
    if (mode === "fb") {
      blockCmd = `^FB${p.blockWidth ?? 0},${p.blockLines ?? 1},${p.blockLineSpacing ?? 0},${p.blockJustify ?? "L"},${p.blockHangingIndent ?? 0}`;
      content = encodeFbContent(p.content);
      encodeDefault = encodeFbContent;
    } else if (mode === "tb") {
      blockCmd = `^TB${p.rotation},${p.blockWidth ?? 0},${p.blockHeight ?? 0}`;
      content = encodeTbContent(p.content);
      encodeDefault = encodeTbContent;
    }
    // Always emit the gap so the round-trip is unambiguous.
    const fpDir = p.fpDirection ?? "H";
    const fpGap = p.fpCharGap ?? 0;
    const fpCmd = fpDir !== "H" || fpGap > 0 ? `^FP${fpDir},${fpGap}` : "";
    const anchor = textFieldPos(obj);
    const fd = fdFieldFor(content, ctx, undefined, encodeDefault);
    // ^FR is the spec-true reverse: it knocks the glyph ink out of whatever is
    // already drawn (e.g. a black ^GB placed behind the text), so we emit it as
    // a bare field flag and never synthesize a background box. The field's
    // position type and any separately-authored box round-trip unchanged.
    const frCmd = p.reverse ? "^FR" : "";
    return [anchor, fpCmd, fontCmd, blockCmd, frCmd, fd].filter(Boolean).join("");
  },
};
