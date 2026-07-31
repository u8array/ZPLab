import { useEffect } from "react";
import { useFontCacheVersion } from "../../hooks/useFontCacheVersion";
import { Ellipse, Group, Rect, Shape, Text } from "react-konva";
import { getObjectStringContent, shouldShowFallbackTint } from "@zplab/core/lib/variableBinding";
import { lookupBoundVariable } from "@zplab/core/lib/variableField";
import { BarcodeObject } from "./BarcodeObject";
import { LineObject } from "./LineObject";
import { ImageObject } from "./ImageObject";
import { dotsToPx, pxToDots } from "@zplab/core/lib/coordinates";
import { measureInkWidthPx } from "@zplab/core/lib/labelGeometry/measureTextDots";
import { outlineInset } from "../../lib/shapeGeometry";
import { reverseShapeStyle } from "./reverseShapeStyle";
import { useColorScheme, CANVAS_WARNING } from "../../hooks/useColorScheme";
import { useLabelStore } from "../../store/labelStore";
import { applyBindingToObject } from "@zplab/core/lib/variableBinding";
import { usePreviewBinding } from "../../store/usePreviewBinding";
import { ZPL_FONT_HEIGHT_TO_CSS_RATIO } from "@zplab/core/lib/labelGeometry/textPositionTransforms";
import { getTextRenderMetrics } from "@zplab/core/lib/labelGeometry/textRenderMetrics";
import { selectionHandlers, shapeHitProps, useBlankFieldWarns, CAPTURE_CHROME, PLACEHOLDER_DASH, PLACEHOLDER_STROKE_PX, type KonvaObjectProps } from "./konvaObjectProps";
import { setMeasuredBounds, clearMeasuredBounds } from "./measuredBoundsCache";
import { DEFAULT_GS_SYMBOL_META, GS_SYMBOLS } from "@zplab/core/registry/symbol";
import { GS_SYMBOL_PATHS, GS_VECTOR_CODES, type GsVectorCode } from "../../registry/gsSymbolPaths";
import { blockBoundsDots, blockJustifyWordPositions, blockLineStartDots, blockLineStepDots, EMPTY_TEXT_PLACEHOLDER_GLYPHS, isBlankText, tbBoundsDots, tbLineStepDots, wrapBlockLines, zebraAlignOffsetDots, zebraHangingIndentOffsetDots, zebraJustifyGapDots, zebraLineWidthDots, type ZplRotation } from "@zplab/core/lib/zebraTextLayout";
import { resolveTextMode } from "@zplab/core/registry/text";
import { isAxisSwapped } from "@zplab/core/registry/rotation";
import { objectResolvesCtrl, type LeafObject } from "@zplab/core/registry";
import type { TextProps } from "@zplab/core/registry/text";

type Props = KonvaObjectProps;

/** Non-listening selection overlay tracing the declared bbox; decoupled
 *  from the body so thick outlines still get a clean marker. */
function SelectionOverlay({
  width,
  height,
  strokeWidth,
  color,
  cornerRadius,
}: {
  width: number;
  height: number;
  strokeWidth: number;
  color: string;
  cornerRadius?: number;
}) {
  return (
    <Rect
      x={0}
      y={0}
      width={width}
      height={height}
      stroke={color}
      strokeWidth={Math.max(strokeWidth, 1.5)}
      strokeScaleEnabled={false}
      fill="transparent"
      cornerRadius={cornerRadius}
      listening={false}
    />
  );
}

/** Ellipse-shaped counterpart of `SelectionOverlay` for ^GE / ^GC bodies. */
function EllipseSelectionOverlay({
  rx,
  ry,
  color,
}: {
  rx: number;
  ry: number;
  color: string;
}) {
  return (
    <Ellipse
      x={rx}
      y={ry}
      radiusX={rx}
      radiusY={ry}
      stroke={color}
      strokeWidth={1.5}
      strokeScaleEnabled={false}
      fill="transparent"
      listening={false}
    />
  );
}

/** Canvas projection of ^FP (direction is a single letter, V/R exclusive). */
function applyFpToContent(content: string, fpDirection: "H" | "V" | "R" | undefined): string {
  if (fpDirection === "V") return [...content].join("\n");
  if (fpDirection === "R") return [...content].reverse().join("");
  return content;
}

/** Reversed block's left edge sits this fraction of fontHeight right of
 *  `FO - totalAdvance`. Per Labelary pixel scan. */
const FPR_ANCHOR_LEFT_PADDING_RATIO = 0.8;

interface BaseTextProps {
  fontSize: number;
  fontFamily: string;
  fontStyle: "bold" | "normal";
  scaleX: number;
  rotation: number;
  fill: string;
  stroke: string | undefined;
  strokeWidth: number;
  letterSpacing?: number;
  /** Horizontal shift (^FPR, and device-font left-bearing trim). */
  offsetXPx?: number;
  /** Vertical shift (device-font cap-top trim vs Labelary). */
  offsetYPx?: number;
  /** `difference` for ^FR reverse text, so the white glyphs knock out of
   *  whatever black is drawn behind them (matches reverseShapeStyle). */
  globalCompositeOperation?: "difference" | "source-over";
}

/** One `<Text>` per line at Zebra alignment offset when ^FB is active.
 *  Konva's own Text.align uses canvas measureText which over-estimates
 *  A0 advances and drifts noticeably on centred blocks. */
type TextFieldObj = LeafObject & { type: "text"; props: TextProps };

function PlaceholderRect({
  x, y, width, height, rotation, color, fontVersion,
}: {
  x: number; y: number; width: number; height: number;
  rotation?: number; color: string; fontVersion: number;
}) {
  return (
    <Rect
      key={fontVersion}
      x={x}
      y={y}
      width={width}
      height={height}
      rotation={rotation}
      fill="transparent"
      stroke={color}
      strokeWidth={PLACEHOLDER_STROKE_PX}
      lineCap="round"
      dash={PLACEHOLDER_DASH}
      strokeScaleEnabled={false}
      listening={true}
    />
  );
}

/** Opacity of the ^TB overset ghost (the clipped-off value shown for editing). */
const TB_OVERSET_GHOST_OPACITY = 0.3;

function TextFieldContent({
  obj,
  content,
  base,
  scale,
  dpmm,
  fontVersion,
  placeholderColor,
  emptyColor,
  isSelected = false,
}: {
  obj: TextFieldObj;
  content: string;
  base: BaseTextProps;
  scale: number;
  dpmm: number;
  fontVersion: number;
  placeholderColor: string;
  /** Empty-field placeholder stroke: warning orange once the untouched grace
   *  ended, the affordance accent while pristine or on the drop ghost. */
  emptyColor: string;
  isSelected?: boolean;
}) {
  const shift = base.offsetXPx ?? 0;
  const shiftY = base.offsetYPx ?? 0;
  if (obj.type !== "text") {
    return <Text key={fontVersion} x={shift} y={shiftY} text={content} {...base} />;
  }
  const { blockWidth, blockLines, blockHeight, blockJustify, blockLineSpacing, blockHangingIndent, fontHeight, fontWidth } = obj.props;
  const mode = resolveTextMode(obj.props);
  if (mode === "normal" || !blockWidth) {
    // Single-line text has no spec-defined min width, so only empty
    // content triggers the placeholder (block also covers too-narrow).
    if (isBlankText(content)) {
      return (
        <PlaceholderRect
          fontVersion={fontVersion}
          x={shift}
          y={0}
          width={dotsToPx(fontHeight * EMPTY_TEXT_PLACEHOLDER_GLYPHS, scale, dpmm)}
          height={dotsToPx(fontHeight, scale, dpmm)}
          rotation={base.rotation}
          color={emptyColor}
        />
      );
    }
    return <Text key={fontVersion} x={shift} y={shiftY} text={content} {...base} />;
  }
  // Font 0 uses the Labelary-calibrated advance (tuned to land center/right
  // justify on the firmware pixel); explicit-width / device fonts aren't in
  // that table, so measure the rendered glyphs instead.
  const isDefaultFont0 =
    fontWidth === 0 && Math.abs((base.scaleX ?? 1) - 1) < 1e-3;
  const measureLinePx = (s: string) =>
    isDefaultFont0
      ? dotsToPx(zebraLineWidthDots(s, fontHeight, fontWidth), scale, dpmm)
      : measureInkWidthPx(s, base.fontSize, base.fontFamily, base.fontStyle) *
        (base.scaleX ?? 1);
  // Skip the field only when not even one rendered char fits (Labelary wraps to
  // a single char). Soft hyphens are dropped by the wrap, so never gate on one.
  const firstChar = content.replace(/\u00AD/g, "").trim()[0] ?? "";
  const tooNarrow =
    firstChar !== "" &&
    dotsToPx(blockWidth, scale, dpmm) < measureLinePx(firstChar);
  const emptyContent = isBlankText(content);
  if (tooNarrow || emptyContent) {
    const bounds =
      mode === "tb"
        ? tbBoundsDots(blockWidth, blockHeight ?? fontHeight, obj.props.rotation)
        : blockBoundsDots({
            blockWidthDots: blockWidth,
            blockLines: blockLines ?? 1,
            blockLineSpacing: blockLineSpacing ?? 0,
            fontHeight,
            rotation: obj.props.rotation,
          });
    return (
      <PlaceholderRect
        fontVersion={fontVersion}
        x={dotsToPx(bounds.x, scale, dpmm)}
        y={dotsToPx(bounds.y, scale, dpmm)}
        width={dotsToPx(bounds.width, scale, dpmm)}
        height={dotsToPx(bounds.height, scale, dpmm)}
        // Unconfigured (empty) reads as the warning family, matching the
        // blank-barcode frame; too-narrow keeps the design-affordance accent.
        color={emptyContent ? emptyColor : placeholderColor}
      />
    );
  }
  // ^TB: word-wrap left-aligned, no spacing/indent/justify, clipped at the
  // block height (Labelary truncates mid-glyph, so clip rather than drop whole
  // lines). At 90deg rotations the block rect stays axis-aligned.
  if (mode === "tb") {
    // ^TB has no hard break; emit collapses newlines to spaces, so the canvas
    // must too or it would show line breaks that won't print.
    const tbText = content.replace(/\n/g, " ");
    const tbLines = wrapBlockLines(tbText, dotsToPx(blockWidth, scale, dpmm), measureLinePx);
    const tbStep = tbLineStepDots(fontHeight);
    const clip = tbBoundsDots(blockWidth, blockHeight ?? fontHeight, obj.props.rotation);
    // Lines sit exactly like ^FB (first line at the block top with Konva's cap
    // pad); matches the Labelary preview so toggling it doesn't shift the text.
    const tbLineNodes = (extra?: Partial<BaseTextProps>) =>
      tbLines.map((line, i) => {
        const startDots = blockLineStartDots(i, obj.props.rotation, 0, tbStep);
        return (
          <Text
            key={`${fontVersion}-${i}`}
            x={dotsToPx(startDots.x, scale, dpmm) + shift}
            y={dotsToPx(startDots.y, scale, dpmm) + shiftY}
            text={line}
            {...base}
            {...extra}
          />
        );
      });
    return (
      <>
        {/* Overset ghost: the full value including the part the box clips,
            dimmed and editor-only, so the hidden text stays visible and the
            transformer (whole-text bounds) can still scale it. */}
        {isSelected && (
          <Group name={CAPTURE_CHROME} listening={false} opacity={TB_OVERSET_GHOST_OPACITY}>
            {tbLineNodes({ stroke: undefined, strokeWidth: 0 })}
          </Group>
        )}
        {/* Printing text, clipped to the ^TB box. getClientRect ignores the
            clip, so the selection bounds stay the full text (scalable). */}
        <Group
          clipX={dotsToPx(clip.x, scale, dpmm) + shift}
          clipY={dotsToPx(clip.y, scale, dpmm) + shiftY}
          clipWidth={dotsToPx(clip.width, scale, dpmm)}
          clipHeight={dotsToPx(clip.height, scale, dpmm)}
        >
          {tbLineNodes()}
        </Group>
      </>
    );
  }
  const justify = blockJustify ?? "L";
  const indent = blockHangingIndent ?? 0;
  const lineStepDots = blockLineStepDots(fontHeight, blockLineSpacing ?? 0);
  // Wrap to the rendered block width; ^FB slot b: text exceeding blockLines
  // overprints onto the last line (matches Labelary), so pin overflow rows to
  // the last index rather than dropping them.
  const cap = blockLines ?? 1;
  const lines = wrapBlockLines(
    content,
    dotsToPx(blockWidth, scale, dpmm),
    measureLinePx,
  ).map((line, i) => ({ line, row: Math.min(i, cap - 1) }));
  // Labelary centers / justifies as if a trailing space is present; feed the
  // rendered space width so both match the preview on scaled / device fonts.
  const spaceWidthDots = pxToDots(measureLinePx(" "), scale, dpmm);
  return (
    <>
      {lines.flatMap(({ line, row }, i) => {
        const indentDots = zebraHangingIndentOffsetDots(row, indent);
        // Measure the rendered glyphs (same basis as the wrap) so justify
        // offsets match what is drawn; zebraLineWidthDots over-estimates
        // scaled / device fonts and would clamp the offset to 0 (stuck left).
        const lineWidthDots = pxToDots(measureLinePx(line), scale, dpmm);
        const effectiveBlockWidth = blockWidth - indentDots;
        // Justify=J stretches word-gaps to fill the block; last line and
        // lines without word boundaries fall back to L.
        if (justify === "J") {
          const isLast = i === lines.length - 1;
          const words = line.split(" ");
          const extraGap = zebraJustifyGapDots(lineWidthDots, effectiveBlockWidth, words.length - 1, isLast);
          if (extraGap > 0) {
            const startDots = blockLineStartDots(row, obj.props.rotation, indentDots, lineStepDots);
            const positions = blockJustifyWordPositions({
              words, rotation: obj.props.rotation, startDots,
              fontHeight, fontWidth, extraGapDots: extraGap,
              wordWidthDots: (w) => pxToDots(measureLinePx(w), scale, dpmm),
              spaceWidthDots,
            });
            return positions.map((p, wi) => (
              <Text
                key={`${fontVersion}-${i}-${wi}`}
                x={dotsToPx(p.x, scale, dpmm) + shift}
                y={dotsToPx(p.y, scale, dpmm) + shiftY}
                text={p.text}
                {...base}
              />
            ));
          }
        }
        const alignOffsetDots = zebraAlignOffsetDots(lineWidthDots, effectiveBlockWidth, justify, spaceWidthDots);
        const startDots = blockLineStartDots(row, obj.props.rotation, indentDots + alignOffsetDots, lineStepDots);
        return [
          <Text
            key={`${fontVersion}-${i}`}
            x={dotsToPx(startDots.x, scale, dpmm) + shift}
            y={dotsToPx(startDots.y, scale, dpmm) + shiftY}
            text={line}
            {...base}
          />,
        ];
      })}
    </>
  );
}

/** Dashed wrap frame for a selected ^FB block. In frame mode the invisible
 *  Rect anchors the Group's clientRect so the Transformer covers the full
 *  block (FO-aligned regardless of C/R justify); in glyph mode it is omitted
 *  so the handles hug the rendered text instead. The dashed outline is drawn
 *  via a sceneFunc Shape (zero clientRect) so it never inflates the bbox. */
function BlockWrapGuide({
  blockWidthDots,
  blockLines,
  blockLineSpacing,
  blockHeightDots,
  fontHeight,
  rotation,
  scale,
  dpmm,
  color,
  frameMeasured,
}: {
  blockWidthDots: number;
  blockLines: number;
  blockLineSpacing: number;
  /** Set for ^TB: the frame is the width x clip-height rect, not line-stacked. */
  blockHeightDots?: number;
  fontHeight: number;
  rotation: ZplRotation;
  scale: number;
  dpmm: number;
  color: string;
  frameMeasured: boolean;
}) {
  const bounds =
    blockHeightDots != null
      ? tbBoundsDots(blockWidthDots, blockHeightDots, rotation)
      : blockBoundsDots({ blockWidthDots, blockLines, blockLineSpacing, fontHeight, rotation });
  const bx = dotsToPx(bounds.x, scale, dpmm);
  const by = dotsToPx(bounds.y, scale, dpmm);
  const bw = dotsToPx(bounds.width, scale, dpmm);
  const bh = dotsToPx(bounds.height, scale, dpmm);
  // Frame mode: the transformer handles already outline the frame, so only the
  // invisible measure rect is needed. Glyph mode: handles hug the text, so draw
  // the dashed wrap frame (hidden during the drag, see below).
  return frameMeasured ? (
    <Rect x={bx} y={by} width={bw} height={bh} fill="transparent" listening={false} />
  ) : (
    <Shape
      listening={false}
      sceneFunc={(ctx, shape) => {
        // The frame is drawn relative to the group, which Konva scales during a
        // glyph-mode drag; that would shift it with the anchor translation, so
        // hide it while actively transforming (scale != 1) and redraw at rest.
        // blockWidth is constant in glyph mode, so nothing is lost.
        const parent = shape.getParent();
        const sx = parent?.scaleX() || 1;
        const sy = parent?.scaleY() || 1;
        if (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) return;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.restore();
      }}
    />
  );
}

const BARCODE_TYPES = new Set([
  "code128",
  "code39",
  "ean13",
  "ean8",
  "upca",
  "upce",
  "interleaved2of5",
  "code93",
  "pdf417",
  "qrcode",
  "datamatrix",
  "code11",
  "industrial2of5",
  "standard2of5",
  "codabar",
  "logmars",
  "msi",
  "plessey",
  "gs1databar",
  "planet",
  "postal",
  "aztec",
  "maxicode",
  "micropdf417",
  "codablock",
  "upcEanExtension",
  "code49",
  "tlc39",
]);

export function KonvaObject(props_: Props) {
  const { variables, active, clock } = usePreviewBinding();
  const dataset = useLabelStore((s) => s.dataset);
  const columnMapping = useLabelStore((s) => s.columnMapping);
  const dataRenderMode = useLabelStore((s) => s.canvasSettings.dataRenderMode);
  const obj = applyBindingToObject(props_.obj, variables, active, dataRenderMode, clock, objectResolvesCtrl(props_.obj));
  const renderProps = obj === props_.obj ? props_ : { ...props_, obj };

  // Classify the ORIGINAL content: `obj` has had its markers resolved to print
  // values by applyBindingToObject, so its content no longer matches `«name»`.
  const boundVariable = lookupBoundVariable(props_.obj, variables);
  const showFallbackTint = shouldShowFallbackTint(
    boundVariable, dataset, columnMapping, dataRenderMode,
  );

  const shape =
    obj.type === "line" ? <LineObject {...renderProps} obj={obj} /> :
    obj.type === "image" ? <ImageObject {...renderProps} obj={obj} /> :
    BARCODE_TYPES.has(obj.type) ? <BarcodeObject {...renderProps} preBindingContent={getObjectStringContent(props_.obj) ?? ""} /> :
    <KonvaObjectInner {...renderProps} />;

  if (!showFallbackTint) return shape;

  // Skip tint for content-derived-width shapes (barcodes); badge covers them.
  const props = (obj as { props?: { width?: unknown; height?: unknown } }).props;
  const wDots = typeof props?.width === "number" ? props.width : 0;
  const hDots = typeof props?.height === "number" ? props.height : 0;
  if (wDots <= 0 || hDots <= 0) return shape;
  const { scale, dpmm, offsetX, offsetY } = props_;
  const tintX = dotsToPx(obj.x, scale, dpmm) - offsetX;
  const tintY = dotsToPx(obj.y, scale, dpmm) - offsetY;
  const tintW = dotsToPx(wDots, scale, dpmm);
  const tintH = dotsToPx(hDots, scale, dpmm);

  return (
    <Group>
      <Rect
        x={tintX}
        y={tintY}
        width={tintW}
        height={tintH}
        fill={CANVAS_WARNING}
        opacity={0.12}
        listening={false}
      />
      {shape}
    </Group>
  );
}

/** New shape types: put `id={obj.id}` on the outermost Group (stage
 *  lookups walk up to it) and use the selection-overlay components
 *  rather than re-tracing the body's stroke. */
function KonvaObjectInner({
  obj,
  scale,
  dpmm,
  offsetX,
  offsetY,
  isSelected,
  onSelect,
  dragHandlers,
}: Props) {
  const fontVersion = useFontCacheVersion();
  const colors = useColorScheme();
  // Pass label so metrics resolves uploaded-TTF previews. ZPL emit/parse
  // call without `label` so round-trip stays PrintLab-based.
  const label = useLabelStore((s) => s.label);
  const requestContentEditorFocus = useLabelStore((s) => s.requestContentEditorFocus);
  const setSidebarTab = useLabelStore((s) => s.setSidebarTab);
  const selectObjects = useLabelStore((s) => s.selectObjects);
  const blockDragMode = useLabelStore((s) => s.blockDragMode);
  const emptyPlaceholderColor = useBlankFieldWarns(obj.id) ? CANVAS_WARNING : colors.accent;
  // obj.x/y is the EM-bbox top-left; ZPL anchor delta is applied only
  // at the zplGenerator/zplParser boundary.
  const baseMetrics = getTextRenderMetrics(obj, undefined, label);
  const textMetrics =
    baseMetrics && obj.type === "text"
      ? {
          ...baseMetrics,
          fontSizePx: Math.max(
            // Bitmap device fonts (A-H) carry an explicit snapped size; the
            // scalable path derives it from the ZPL height.
            baseMetrics.fontSizeDots != null
              ? dotsToPx(baseMetrics.fontSizeDots, scale, dpmm)
              : dotsToPx(obj.props.fontHeight, scale, dpmm) /
                  ZPL_FONT_HEIGHT_TO_CSS_RATIO,
            6,
          ),
        }
      : null;

  const x = offsetX + dotsToPx(obj.x, scale, dpmm);
  const y = offsetY + dotsToPx(obj.y, scale, dpmm);

  // Only single-line text needs a measured footprint; block (^FB/^TB) text
  // is purely computable. Serial resolves to single-line too (block props are
  // dormant), so route through resolveTextMode, the single mode source.
  const isSingleLineText =
    obj.type === "text" && !!textMetrics && resolveTextMode(obj.props) === "normal";
  const inkWidthDots = textMetrics?.inkWidthDots ?? 0;
  const fontHeightDots = obj.type === "text" ? obj.props.fontHeight : 0;
  // Whitespace-only content has a non-zero ink advance but draws the placeholder,
  // so gate on the same blank test the placeholder does, not on inkWidth alone.
  const blankSingleLine = isSingleLineText && isBlankText(textMetrics?.content ?? "");
  const rotation = obj.type === "text" ? obj.props.rotation : "N";
  const isQuarterTurn = isAxisSwapped(rotation);
  useEffect(() => {
    if (!isSingleLineText) return;
    // Blank (empty or whitespace) or zero-height: drop the measured entry so
    // objectBounds falls to the placeholder footprint the canvas draws.
    if (blankSingleLine || inkWidthDots <= 0 || fontHeightDots <= 0) {
      clearMeasuredBounds(obj.id);
      return;
    }
    setMeasuredBounds(obj.id, {
      width: isQuarterTurn ? fontHeightDots : inkWidthDots,
      height: isQuarterTurn ? inkWidthDots : fontHeightDots,
    });
  }, [obj.id, isSingleLineText, blankSingleLine, inkWidthDots, fontHeightDots, isQuarterTurn]);
  useEffect(() => {
    if (!isSingleLineText) return;
    return () => clearMeasuredBounds(obj.id);
  }, [obj.id, isSingleLineText]);

  // Whole-object drag (snap + commit) is centralized in the drag controller.
  const handleDragMove = dragHandlers?.onDragMove;
  const handleDragEnd = dragHandlers?.onDragEnd;

  // selectObjects directly so leaf-in-group pierces auto-promotion.
  const openEditor = () => {
    if (obj.locked) return;
    selectObjects([obj.id]);
    setSidebarTab("properties");
    requestContentEditorFocus(obj.id);
  };

  if (obj.type === "text" && textMetrics) {
    const p = obj.props;
    const { content, fontFamily, fontScaleX, fontSizePx } = textMetrics;
    // Bitmap device fonts (A-H) carry their own weight via the substitute
    // family (Vera Mono / Bold, OCR); forcing bold there faux-bolds them
    // thicker than Labelary. Font 0 / custom uploads stay bold.
    const fontStyle = textMetrics.fontSizeDots != null ? "normal" : "bold";
    // Device-font position trims (cap-top / left-bearing) vs Labelary.
    const deviceXOffPx = dotsToPx(textMetrics.xOffsetDots ?? 0, scale, dpmm);
    const deviceYOffPx = dotsToPx(textMetrics.yOffsetDots ?? 0, scale, dpmm);
    const deviceLetterSpacingPx = dotsToPx(textMetrics.letterSpacingDots ?? 0, scale, dpmm);
    const zplRotationDeg: Record<typeof p.rotation, number> = {
      N: 0,
      R: 90,
      I: 180,
      B: 270,
    };

    // Labelary ignores ^FP gap in V mode; mirror that on canvas while
    // still round-tripping the value through ZPL emit.
    const fpDirection = obj.type === "text" ? obj.props.fpDirection : undefined;
    const fpCharGap = obj.type === "text" ? obj.props.fpCharGap ?? 0 : 0;
    const fpContent = applyFpToContent(content, fpDirection);
    const fpLetterSpacingPx =
      fpDirection !== "V" && fpCharGap > 0 ? dotsToPx(fpCharGap, scale, dpmm) : 0;
    let fpShiftXPx = 0;
    if (fpDirection === "R" && content.length > 1) {
      const anchorPadDots = obj.props.fontHeight * FPR_ANCHOR_LEFT_PADDING_RATIO;
      const reservedPx = dotsToPx(textMetrics.inkWidthDots - anchorPadDots, scale, dpmm);
      const gapPx = (content.length - 1) * fpLetterSpacingPx;
      fpShiftXPx = -(reservedPx + gapPx);
    }

    // ^FR reverse routes through the normal text path with a knockout paint
    // (white + difference, see base below); no self background, so the box
    // stays a separate object and the field round-trips with its own anchor.
    const reverseText = obj.type === "text" && obj.props.reverse && !obj.props.serial;

    // Outer Group stays axis-aligned for the Transformer; rotation is
    // applied to the inner Text. Direct rotation on the transformer's
    // node produces drift and 1e15-class numbers on commit.
    // Frame-mode block resize is handled by the transformer hook (live reflow:
    // blockWidth/blockLines re-wrap each tick). Glyph mode scales the glyphs
    // (stretch preview) and the dashed frame counter-scales in the guide.
    return (
      <Group
        id={obj.id}
        x={x}
        y={y}
        draggable={!obj.locked}
        {...selectionHandlers(onSelect)}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDblClick={openEditor}
        onDblTap={openEditor}
      >
        <TextFieldContent
          obj={obj as TextFieldObj}
          content={fpContent}
          placeholderColor={colors.accent}
          emptyColor={emptyPlaceholderColor}
          base={{
            fontSize: fontSizePx,
            fontFamily,
            fontStyle,
            scaleX: fontScaleX,
            rotation: zplRotationDeg[p.rotation],
            fill: reverseText ? "#ffffff" : "#000000",
            globalCompositeOperation: reverseText ? "difference" : "source-over",
            stroke: isSelected ? colors.selection : undefined,
            strokeWidth: isSelected ? 1 : 0,
            letterSpacing: fpLetterSpacingPx + deviceLetterSpacingPx,
            offsetXPx: fpShiftXPx + deviceXOffPx,
            offsetYPx: deviceYOffPx,
          }}
          scale={scale}
          dpmm={dpmm}
          fontVersion={fontVersion}
          isSelected={isSelected}
        />
        {obj.type === "text" && isSelected && resolveTextMode(obj.props) !== "normal" && obj.props.blockWidth && (
          <BlockWrapGuide
            blockWidthDots={obj.props.blockWidth}
            blockLines={obj.props.blockLines ?? 1}
            blockLineSpacing={obj.props.blockLineSpacing ?? 0}
            blockHeightDots={resolveTextMode(obj.props) === "tb" ? obj.props.blockHeight ?? obj.props.fontHeight : undefined}
            fontHeight={obj.props.fontHeight}
            rotation={obj.props.rotation}
            scale={scale}
            dpmm={dpmm}
            color={colors.accent}
            frameMeasured={blockDragMode !== "glyph"}
          />
        )}
      </Group>
    );
  }

  if (obj.type === "symbol") {
    const p = obj.props;
    const w = dotsToPx(p.width, scale, dpmm);
    const h = dotsToPx(p.height, scale, dpmm);
    // A/B/C: vector paths from Labelary. D/E (trademarked UL/CSA) and
    // unknown codes fall to the placeholder branch.
    const vectorPath = GS_VECTOR_CODES.has(p.symbol)
      ? GS_SYMBOL_PATHS[p.symbol as GsVectorCode]
      : null;
    // Zebra rotates only the glyph; bbox stays at (w, h). sceneFunc bakes
    // rotation into rel + canvas rotate.
    return (
      <Group
        id={obj.id}
        x={x}
        y={y}
        draggable={!obj.locked}
        {...selectionHandlers(onSelect)}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        {/* Hit area for both vector and placeholder branches (both listening=false). */}
        <Rect width={w} height={h} fill="transparent" />
        {vectorPath ? (() => {
            // Custom Shape with Path2D + even-odd fill: Konva.Path has no
            // fillRule, so ®/© holes can't be carved via nonzero. `rel`
            // is the per-rotation glyph rect measured from Labelary;
            // ?? rel.N guards malformed-import rotation strings.
            const rel = vectorPath.rel[p.rotation] ?? vectorPath.rel.N;
            const glyphW = vectorPath.bbox.maxX - vectorPath.bbox.minX;
            const glyphH = vectorPath.bbox.maxY - vectorPath.bbox.minY;
            const renderW = w * rel.w;
            const renderH = h * rel.h;
            const renderX = w * rel.x;
            const renderY = h * rel.y;
            return (
              <Shape
                listening={false}
                sceneFunc={(ctx) => {
                  ctx.save();
                  ctx.translate(renderX, renderY);
                  // R/B swap effective W/H because upright glyph is sideways.
                  if (p.rotation === "R") {
                    ctx.translate(renderW, 0);
                    ctx.rotate(Math.PI / 2);
                    ctx.scale(renderH / glyphW, renderW / glyphH);
                  } else if (p.rotation === "I") {
                    ctx.translate(renderW, renderH);
                    ctx.rotate(Math.PI);
                    ctx.scale(renderW / glyphW, renderH / glyphH);
                  } else if (p.rotation === "B") {
                    ctx.translate(0, renderH);
                    ctx.rotate(-Math.PI / 2);
                    ctx.scale(renderH / glyphW, renderW / glyphH);
                  } else {
                    ctx.scale(renderW / glyphW, renderH / glyphH);
                  }
                  ctx.translate(-vectorPath.bbox.minX, -vectorPath.bbox.minY);
                  const path = new Path2D(vectorPath.d);
                  ctx.fillStyle = "#000000";
                  // Reach into Konva's underlying 2D context for the
                  // path/rule overload that Konva's wrapper omits.
                  ctx._context.fill(path, "evenodd");
                  ctx.restore();
                }}
              />
            );
          })() : (
            <>
              <Rect
                width={w}
                height={h}
                stroke="#9ca3af"
                strokeWidth={Math.max(1, Math.min(w, h) * 0.04)}
                strokeScaleEnabled={false}
                dash={[Math.max(4, w * 0.06), Math.max(3, w * 0.04)]}
                cornerRadius={Math.min(w, h) * 0.15}
                fill="transparent"
                listening={false}
              />
              <Text
                x={0}
                y={0}
                width={w}
                height={h}
                align="center"
                verticalAlign="middle"
                text={(GS_SYMBOLS.find((s) => s.code === p.symbol) ?? DEFAULT_GS_SYMBOL_META).glyph}
                fontSize={Math.min(h, w) * 0.5}
                fontFamily="'Courier New', monospace"
                fontStyle="bold"
                fill="#6b7280"
                listening={false}
              />
            </>
          )}
        {isSelected && (
          <Rect
            width={w}
            height={h}
            stroke={colors.selection}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            fill="transparent"
            listening={false}
          />
        )}
      </Group>
    );
  }

  if (obj.type === "box") {
    const p = obj.props;
    const w = dotsToPx(p.width, scale, dpmm);
    const h = dotsToPx(p.height, scale, dpmm);
    const strokeWidth = Math.max(dotsToPx(p.thickness, scale, dpmm), 0.5);
    const cornerRadius =
      p.rounding * dotsToPx(Math.min(p.width, p.height) / 8, scale, dpmm);
    // promoteFilled=true: ^GB extrudes solid to max(w,t) x max(h,t)
    // (see shapeRender.ts). ^GE/^GC collapse without promotion.
    const insetGeom = outlineInset(w, h, strokeWidth, p.filled, true);
    const renderFilled = insetGeom.renderFilled;
    const insetCornerRadius = renderFilled
      ? cornerRadius
      : Math.max(0, cornerRadius - strokeWidth / 2);

    const { stroke, fill, globalCompositeOperation } = reverseShapeStyle(
      p.reverse,
      p.color,
      renderFilled,
    );
    return (
      <Group
        id={obj.id}
        x={x}
        y={y}
        draggable={!obj.locked}
        {...selectionHandlers(onSelect)}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        <Rect
          x={insetGeom.offset}
          y={insetGeom.offset}
          width={insetGeom.width}
          height={insetGeom.height}
          stroke={stroke}
          strokeWidth={renderFilled ? 0 : strokeWidth}
          strokeScaleEnabled={false}
          fill={fill}
          cornerRadius={insetCornerRadius}
          globalCompositeOperation={globalCompositeOperation}
          {...shapeHitProps(renderFilled, strokeWidth, isSelected)}
        />
        {isSelected && (
          <SelectionOverlay
            width={w}
            height={h}
            strokeWidth={1.5}
            color={colors.selection}
            cornerRadius={cornerRadius}
          />
        )}
      </Group>
    );
  }

  if (obj.type === "ellipse") {
    const p = obj.props;
    const w = dotsToPx(p.width, scale, dpmm);
    const h = dotsToPx(p.height, scale, dpmm);
    const rx = w / 2;
    const ry = h / 2;
    const strokeWidth = Math.max(dotsToPx(p.thickness, scale, dpmm), 0.5);
    const insetGeom = outlineInset(w, h, strokeWidth, p.filled);
    const renderFilled = insetGeom.renderFilled;
    const insetRx = insetGeom.width / 2;
    const insetRy = insetGeom.height / 2;
    const { stroke, fill, globalCompositeOperation } = reverseShapeStyle(
      p.reverse,
      p.color,
      renderFilled,
    );
    return (
      <Group
        id={obj.id}
        x={x}
        y={y}
        draggable={!obj.locked}
        {...selectionHandlers(onSelect)}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        <Ellipse
          x={rx}
          y={ry}
          radiusX={insetRx}
          radiusY={insetRy}
          stroke={stroke}
          strokeWidth={renderFilled ? 0 : strokeWidth}
          strokeScaleEnabled={false}
          fill={fill}
          globalCompositeOperation={globalCompositeOperation}
          {...shapeHitProps(renderFilled, strokeWidth, isSelected)}
        />
        {isSelected && (
          <EllipseSelectionOverlay rx={rx} ry={ry} color={colors.selection} />
        )}
      </Group>
    );
  }

  return null;
}
