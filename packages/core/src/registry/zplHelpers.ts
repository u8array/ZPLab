import type { LabelObjectBase } from "../types/LabelObject";
import { effectiveDpmm, type JmDensity } from "../types/LabelConfig";
import type { ZplEmitContext } from "../types/ZplEmit";
import type { Variable } from "../types/Variable";
import { hasTemplateMarkers, markersToEmbeds } from "../lib/fnTemplate";
import { hasClockMarkers, markersToTokens } from "../lib/fcTemplate";
import { hasControlMarkers, resolveControlMarkers } from "../types/controlKey";
import { classifyField } from "../lib/variableField";
import { modelToZplAnchor } from "../lib/labelGeometry/textPositionTransforms";
import { resolveDeviceFontId, type DeviceFontLabel } from "../lib/customFonts";
import { anchorInkWidthDots } from "../lib/labelGeometry/textRenderMetrics";
import { blockInterLineExtentDots } from "../lib/zebraTextLayout";
import type { LabelObject } from "../types/Group";
import { objectRotation } from "./rotation";
import { measureFootprintDots } from "../lib/footprintProber";

/** Emit `^FT` or `^FO` depending on how the object was originally positioned.
 *  1D emitters use this z-less form: their x is import-normalised top-left,
 *  and z-emit for 1D is the S3 stage. */
export function fieldPos(obj: LabelObjectBase): string {
  const cmd = obj.positionType === "FT" ? "FT" : "FO";
  return `^${cmd}${obj.x},${obj.y}`;
}

/** The firmware-verified justify combo (R + rotation N, ^FO or ^FT); shared
 *  with the import normaliser so gate and shift can never disagree on it. */
export function verifiedZJustifyCombo(obj: LabelObjectBase & { type: string }): boolean {
  if (obj.fieldJustify !== "R") return false;
  return objectRotation((obj as unknown as { props: object }).props) === "N";
}

/** Printer-side right-anchor x (model x + measured width) when the gated,
 *  verified combo applies; null otherwise. Single source for the emit, the
 *  home-shift drop test and the off-label preflight, so the three can never
 *  disagree on which edge the printer sees. Callers own the 1D-type check
 *  (importing BARCODE_1D_TYPES here would cycle the registry). */
export function printerAnchoredX(
  obj: LabelObjectBase & { type: string },
  label: { emit1dZJustify?: boolean; dpmm?: number; jmDensity?: JmDensity },
): number | null {
  if (!label.emit1dZJustify || !verifiedZJustifyCombo(obj)) return null;
  const fp = measureFootprintDots(
    obj as LabelObject,
    label.dpmm === undefined ? undefined : effectiveDpmm({ dpmm: label.dpmm, jmDensity: label.jmDensity }),
  );
  return fp ? obj.x + fp.w : null;
}

/** {@link fieldPos} for 1D: behind the emit1dZJustify gate an R field emits
 *  `x+w,y,1` so the PRINTER anchors the right edge (^SN/variable data). */
export function fieldPos1d(obj: LabelObjectBase & { type: string }, ctx?: ZplEmitContext): string {
  const ax = ctx ? printerAnchoredX(obj, ctx.label) : null;
  return ax === null ? fieldPos(obj) : `${fieldPos({ ...obj, x: ax })},1`;
}

/** {@link fieldPos} with the z echo: import never normalises these fields, so
 *  x is still the ZPL anchor and echoing z=1 reproduces the source placement. */
export function fieldPosZ(obj: LabelObjectBase): string {
  const z = obj.fieldJustify === "R" ? ",1" : "";
  return `${fieldPos(obj)}${z}`;
}

/** Graphic leaf types whose ^FO/^FT origin comes from {@link graphicAnchor}
 *  (the footprint top-left under ^FO, a bottom corner under ^FT). For box /
 *  ellipse / image the model x/y already is that top-left; a line's x/y is an
 *  endpoint, so its emitted origin is the bbox top-left instead. Single source
 *  shared by the generator's home-shift drop test and the preflight off-label
 *  check, so the two can't disagree on which types anchor this way. */
export const GRAPHIC_ANCHOR_TYPES: ReadonlySet<string> = new Set([
  "box",
  "ellipse",
  "image",
  "line",
]);

/** Emitted ^FO/^FT origin coords for a graphic of footprint w x h at top-left
 *  (x, y). `^FO` emits the top-left verbatim; `^FT` anchors a bottom corner
 *  (spec p.205): bottom-left, or bottom-right when right-justified. The numeric
 *  half of {@link graphicAnchor}, also reused by the preflight off-label check
 *  so what it tests can't drift from what the generator emits. */
export function graphicAnchorCoords(
  x: number,
  y: number,
  w: number,
  h: number,
  positionType: LabelObjectBase["positionType"],
  justify: LabelObjectBase["fieldJustify"],
): { x: number; y: number } {
  if (positionType !== "FT") return { x, y };
  return justify === "R" ? { x: x + w, y: y + h } : { x, y: y + h };
}

/** Anchor command for a graphic of footprint w x h at top-left (x, y). Shared by
 *  every graphic emitter (box/ellipse/image, and the diagonal-line bounding box). */
export function graphicAnchor(
  x: number,
  y: number,
  w: number,
  h: number,
  positionType: LabelObjectBase["positionType"],
  justify: LabelObjectBase["fieldJustify"],
): string {
  const a = graphicAnchorCoords(x, y, w, h, positionType, justify);
  if (positionType !== "FT") return `^FO${a.x},${a.y}`;
  return justify === "R" ? `^FT${a.x},${a.y},1` : `^FT${a.x},${a.y}`;
}

/** {@link graphicAnchor} for an object whose `x`/`y` is the footprint top-left. */
export function graphicFieldPos(obj: LabelObjectBase, w: number, h: number): string {
  return graphicAnchor(obj.x, obj.y, w, h, obj.positionType, obj.fieldJustify);
}

/** Symmetric with parser's ^LR state flip at ^LRN. */
export function wrapReverse(reverse: boolean | undefined, body: string): string {
  return reverse ? `^LRY${body}^LRN` : body;
}

interface TextLikeObjForFieldPos extends LabelObjectBase {
  props: {
    fontHeight: number;
    fontWidth: number;
    content: string;
    rotation: "N" | "R" | "I" | "B";
    fontId?: string;
    printerFontName?: string;
    blockWidth?: number;
    blockLines?: number;
    blockLineSpacing?: number;
    textMode?: "normal" | "fb" | "tb";
    blockHeight?: number;
  };
}

/** Vertical extent of a block beyond its first line, in dots. Shifts the
 *  FT baseline / FO-R/I anchor. ^TB is a fixed clip height; ^FB stacks lines. */
function blockExtentFor(p: TextLikeObjForFieldPos["props"]): number {
  if (p.textMode === "tb") {
    return Math.max(0, (p.blockHeight ?? p.fontHeight) - p.fontHeight);
  }
  return blockInterLineExtentDots({
    blockWidthDots: p.blockWidth ?? 0,
    blockLines: p.blockLines ?? 1,
    blockLineSpacing: p.blockLineSpacing ?? 0,
    fontHeight: p.fontHeight,
  });
}

/** Priority: fontId -> printerFontName -> ctx defaultFontId -> ^A0. */
export function resolveFontCmd(
  props: {
    rotation: "N" | "R" | "I" | "B";
    fontHeight: number;
    fontWidth: number;
    fontId?: string;
    printerFontName?: string;
  },
  ctx?: ZplEmitContext,
): string {
  const { rotation, fontHeight, fontWidth, fontId, printerFontName } = props;
  if (fontId) {
    return `^A${fontId}${rotation},${fontHeight},${fontWidth}`;
  }
  if (printerFontName) {
    return `^A@${rotation},${fontHeight},${fontWidth},E:${printerFontName}`;
  }
  const defaultId = ctx?.label.defaultFontId;
  if (defaultId) {
    return `^A${defaultId}${rotation},${fontHeight},${fontWidth}`;
  }
  return `^A0${rotation},${fontHeight},${fontWidth}`;
}

/** Numeric ZPL anchor (cap-top/baseline) for a text-like field. `label`
 *  resolves the effective device font (^CF default, ^CW alias override)
 *  for the anchor snap; `variables` resolve a single-bind marker to the
 *  default the wire actually prints (^FN{n}^FD{default}). */
export function textZplAnchorCoords(
  obj: TextLikeObjForFieldPos,
  label?: DeviceFontLabel,
  variables?: readonly Variable[],
): {
  cmd: "FO" | "FT";
  x: number;
  y: number;
} {
  const cmd = obj.positionType === "FT" ? "FT" : "FO";
  const p = obj.props;
  const blockExtentDots = blockExtentFor(p);
  const anchorFontId = resolveDeviceFontId(p.fontId, p.printerFontName, label ?? {});
  const cls = variables ? classifyField(p.content, variables) : undefined;
  const anchorContent = cls?.kind === "single" ? cls.variable.defaultValue : p.content;
  const inkWidthDots = anchorInkWidthDots({
    fontId: anchorFontId,
    content: anchorContent,
    fontHeight: p.fontHeight,
    fontWidth: p.fontWidth,
    printerFontName: p.printerFontName,
  });
  const a = modelToZplAnchor(
    obj.x,
    obj.y,
    { ...p, fontId: anchorFontId },
    obj.positionType,
    inkWidthDots,
    blockExtentDots,
    p.blockWidth ?? 0,
  );
  // ^FO/^FT take integers; firmware would truncate fractional residue anyway.
  return { cmd, x: Math.round(a.x), y: Math.round(a.y) };
}

/** Converts EM top-left model coord to ZPL anchor (cap-top/baseline). */
export function textFieldPos(
  obj: TextLikeObjForFieldPos,
  label?: DeviceFontLabel,
  variables?: readonly Variable[],
): string {
  const a = textZplAnchorCoords(obj, label, variables);
  // Same echo contract as fieldPosZ (text is never import-normalised).
  const z = obj.fieldJustify === "R" ? ",1" : "";
  return `^${a.cmd}${a.x},${a.y}${z}`;
}

/** ^FX has no ^FH escape; strip ^/~ to prevent surrounding-command termination. */
export function stripZplCommandChars(s: string): string {
  return s.replace(/[\^~]/g, "");
}

const FH_DELIM = "_";
// C0 control bytes re-escape too: an imported ^FH field (decoded to raw bytes
// in content) or a control-key chip would otherwise re-emit unescaped.
// eslint-disable-next-line no-control-regex
const NEEDS_FH = /[\^~\x00-\x1F]/;
// eslint-disable-next-line no-control-regex
const FH_ESCAPE = /[\^~_\x00-\x1F]/g;

function hex(ch: string): string {
  return (
    FH_DELIM + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")
  );
}

/** Hex-escape ^/~ and control bytes via ^FH_ (and _ itself) so user content
 *  can't smuggle commands and nonprintables survive re-emit. `arm` carries
 *  per-field ^FC/^FE armings; it sits after a ^FH but flush against ^FD,
 *  because ^FE only applies when it immediately precedes its ^FD (spec p.191). */
export function fdField(payload: string, arm = ''): string {
  if (!NEEDS_FH.test(payload)) return `${arm}^FD${payload}^FS`;
  const escaped = payload.replace(FH_ESCAPE, hex);
  return `^FH${FH_DELIM}${arm}^FD${escaped}^FS`;
}

/** Single-bind content (`«name»`) emits `^FN{n}` + default; a template expands
 *  to `^FE` embeds, everything else stays literal. `transform` (e.g. GS1 FNC1
 *  escaping) is applied to the final field-data payload so it composes with
 *  binding instead of bypassing it. `encodeDefault` block-encodes only the
 *  bound default (e.g. ^TB `<<>` escaping); literal/template `content` must
 *  already be encoded by the caller, since encoding after marker substitution
 *  would corrupt the inserted ^FE/^FC tokens. */
export function fdFieldFor(
  content: string,
  ctx?: ZplEmitContext,
  transform: (payload: string) => string = (s) => s,
  encodeDefault: (payload: string) => string = (s) => s,
  /** Opt-in per emitter: only `controlChars`-capable types may turn chips into
   *  raw bytes; everywhere else a leftover chip stays literal marker text,
   *  like any other unresolved marker. */
  resolveCtrl = false,
): string {
  // Single-bind emits the variable's ^FN + default literally (never expanding a
  // marker inside the mirrored default), so preview and export agree. Derived
  // from content: content == exactly one known marker.
  if (ctx?.variables) {
    const cls = classifyField(content, ctx.variables);
    if (cls.kind === "single") {
      const v = cls.variable;
      return `^FN${v.fnNumber}${fdField(transform(encodeDefault(v.defaultValue)))}`;
    }
  }
  // Template path: arm ^FE/^FC on this field (absent ctx delim = templates not
  // emittable, so content stays literal). Firmware scopes both armings to the
  // ^FD they precede, even for default chars (spec p.189/191; ZD230-verified:
  // without them embeds and clock tokens print literally).
  let payload = content;
  let arm = '';
  if (ctx?.variables && ctx.embedChar && hasTemplateMarkers(payload)) {
    // Arm ^FE only when a marker actually became an embed: hasTemplateMarkers
    // also matches non-variable «...» spans (e.g. clock markers), which
    // markersToEmbeds leaves untouched.
    const { payload: next, referencedFnNumbers } = markersToEmbeds(payload, ctx.variables, ctx.embedChar);
    if (referencedFnNumbers.size > 0) arm = `^FE${ctx.embedChar}`;
    payload = next;
  }
  if (ctx?.clockChars && hasClockMarkers(payload)) {
    payload = markersToTokens(payload, ctx.clockChars);
    arm = `^FC${ctx.clockChars.date},${ctx.clockChars.time},${ctx.clockChars.tertiary}${arm}`;
  }
  // Control-key chips become their raw byte; fdField hex-escapes it via ^FH.
  if (resolveCtrl && hasControlMarkers(payload)) payload = resolveControlMarkers(payload);
  return fdField(transform(payload), arm);
}
