import React, { useCallback, useEffect } from "react";
import { Image as KImage, Group, Rect, Shape, Text } from "react-konva";
import type Konva from "konva";
import { BARCODE_1D_TYPES, ObjectRegistry, objectResolvesCtrl } from "@zplab/core/registry";
import { dotsToPx, mmToDots, pxToDots } from "@zplab/core/lib/coordinates";
import { barcodeFtAnchorOffset, qrPrintsAsGraphic } from "@zplab/core/lib/objectBounds";
import { useColorScheme, CANVAS_WARNING } from "../../hooks/useColorScheme";
import { useFontCacheVersion } from "../../hooks/useFontCacheVersion";
import { selectionHandlers, useBlankFieldWarns, PLACEHOLDER_DASH, PLACEHOLDER_STROKE_PX, type KonvaObjectProps } from "./konvaObjectProps";
import { setMeasuredBounds, clearMeasuredBounds } from "./measuredBoundsCache";
import {
  getDisplaySize,
  stateFrameProps,
  get1DBwipScale,
  getEanUpcHriFragments,
  renderBarcodeCanvas,
  type BarcodeDisplaySize,
  type EanUpcType,
} from "./bwipHelpers";
import { resolveHriAbove, gs1HriFontDots } from "@zplab/core/lib/barcodeHri";
import { gs1ContentToElementString } from "@zplab/core/lib/gs1";
import { placeholderContentFor, samplePropsFor } from "@zplab/core/registry/placeholderContent";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { hasTemplateMarkers } from "@zplab/core/lib/fnTemplate";
import { hasControlMarkers } from "@zplab/core/types/controlKey";
import { objectRotation } from "@zplab/core/registry/rotation";
import { maxicodeScmOwnedByPreflight, type MaxicodeProps } from "@zplab/core/registry/maxicode";
import { rotatedGroupTransform } from "./rotatedGroupTransform";
import { buildEanUpcDigitOverlay } from "./eanUpcDigitNodes";
import { buildCode1dStartStopGlyphs } from "./code1dHriOverlay";
import {
  VERA_MONO_HRI_EM_PER_MODULE,
  VERA_MONO_HRI_CAP_TOP_PAD,
  HRI_FONT_A,
  HRI_FONT_0,
  aboveHriGapDots,
  eanUpcHriFontFamily,
  ocrbEanHriFontDots,
  ocrbEanHriGapDots,
  EAN_TEXT_ZONE_DOTS,
  EAN_UPC_TYPES,
  QR_FO_Y_OFFSET_DOTS,
  QR_FT_MODULE_OFFSET,
} from "@zplab/core/lib/bwipConstants";

/** Drops the EAN/UPC getSelfRect patch so the prototype method resurfaces.
 *  Konva reuses the Image instance across symbology switches; without this
 *  every type after an EAN/UPC visit keeps measuring the stale bar rect. */
function restoreSelfRect(node: Konva.Image | null): void {
  if (node) delete (node as Partial<Konva.Image>).getSelfRect;
}

/** Resolve a registry value that may be a constant or a function of
 *  moduleWidth. Mirrors the pattern formatHri uses for content. */
function resolveMwValue<T>(
  v: T | ((moduleWidth: number) => T) | undefined,
  moduleWidth: number,
): T | undefined {
  return typeof v === "function"
    ? (v as (mw: number) => T)(moduleWidth)
    : v;
}

/** State marker over sample bars: warning orange for a blank field, error red
 *  for uncodable content. Drawn via a sceneFunc Shape (zero clientRect) so
 *  the frame never inflates the Transformer bbox. */
export function StateFrame({
  x = 0,
  y = 0,
  width,
  height,
  color,
}: {
  x?: number;
  y?: number;
  width: number;
  height: number;
  color: string;
}) {
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        // Scale by the inherited alpha (a plain Rect would); the drop ghost
        // renders this frame under a 0.5 group, so the tint must fade with it.
        const base = ctx.globalAlpha;
        ctx.save();
        ctx.globalAlpha = base * 0.12;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, width, height);
        ctx.globalAlpha = base;
        ctx.beginPath();
        ctx.setLineDash(PLACEHOLDER_DASH);
        ctx.lineCap = "round";
        ctx.strokeStyle = color;
        ctx.lineWidth = PLACEHOLDER_STROKE_PX;
        ctx.strokeRect(x, y, width, height);
        ctx.restore();
      }}
    />
  );
}

export function BarcodeObject({
  obj,
  scale,
  dpmm,
  offsetX,
  offsetY,
  isSelected,
  onSelect,
  dragHandlers,
  preBindingContent,
}: KonvaObjectProps & {
  /** Content before marker resolution: `obj` arrives resolved, so the SCM
   *  alarm suppression needs the raw string to tell literal from bound.
   *  Required: a resolved-content fallback would silently re-suppress the
   *  alarm for bound fields. */
  preBindingContent: string;
}) {
  const colors = useColorScheme();
  // Vera Mono (HRI) loads async; Konva won't repaint on an unchanged
  // fontFamily once the FontFace resolves. Keying the overlay on this
  // version remounts it on `loadingdone` for a fresh paint.
  const fontVersion = useFontCacheVersion();

  // Overlay group (HRI text + start/stop glyphs, or EAN/UPC digits) with
  // getClientRect zeroed so the parent bbox stays tight on the bars.
  const setOverlayGroupRef = useCallback((node: Konva.Group | null) => {
    if (node) {
      node.getClientRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
    }
  }, []);

  // Cross-type props read once so the canvas builder and the HRI overlay
  // share one source of truth. Single-field casts at the boundary instead
  // of switch-narrowing keep the cross-type read flat (2D types without
  // moduleWidth fall through with the default; their branches don't
  // render HRI text anyway).
  const moduleWidth =
    (obj.props as { moduleWidth?: number }).moduleWidth ?? 2;
  // GS1-128 shows the parenthesized element string as HRI (firmware prints the
  // parens it strips for encoding).
  const gs1Hri = !!(obj.props as { gs1?: boolean }).gs1;
  const contentRaw = getObjectStringContent(obj) ?? "";
  // A blank (unconfigured) field renders the symbology's sample (GS1 sample
  // in GS1 mode): bwip still gets encodable content, so the object keeps its
  // true footprint. The sample never reaches emit; the blank field's ^FD
  // stays empty.
  const blank = contentRaw.trim() === "";
  const blankWarns = useBlankFieldWarns(obj.id);
  const warnBlank = blank && blankWarns;
  const sample = placeholderContentFor(obj.type, obj.props) ?? "";
  const withSample = { ...obj, props: { ...samplePropsFor(obj.type, obj.props), content: sample } } as typeof obj;

  // Same encoder as the renderFailed preflight, on the same marker-resolved
  // obj, so the canvas and the badge agree on what's codable.
  const primary = renderBarcodeCanvas(blank ? withSample : obj, scale, dpmm);
  // Uncodable content falls back to the sample bars so the object keeps its
  // footprint instead of collapsing to the error box; the encoder message
  // lives in the renderFailed preflight, not on the canvas.
  const codableFail = !blank && primary.error !== null && sample !== "";
  const secondary = codableFail ? renderBarcodeCanvas(withSample, scale, dpmm) : null;
  // Prefer the sample render only if it actually produced a canvas; else the
  // primary carries the real error to the fallback box (sample also failed).
  const source = secondary?.canvas ? secondary : primary;
  const usingSample = source === secondary;
  const { canvas: barcodeCanvas, error: errorMsg } = source;
  const showSample = blank || usingSample;
  // Red "content is wrong" frame only for genuine content: an unresolved
  // «marker» in schema-preview mode is expected to be uncodable (it resolves
  // fine in preview/print), so it shows the sample bars without the alarm.
  // A control chip that will NEVER resolve on this object (incapable type or
  // GS1 mode) is genuine bad content and must not be masked, not even by
  // other markers next to it.
  const unresolvableCtrl = !objectResolvesCtrl(obj) && hasControlMarkers(contentRaw);
  const invalid = usingSample && (unresolvableCtrl || !hasTemplateMarkers(contentRaw));
  const displayObj = showSample ? withSample : obj;
  const effectiveContent = showSample ? sample : contentRaw;
  const rawContent = gs1Hri ? gs1ContentToElementString(effectiveContent) : effectiveContent;
  const printInterpEnabled =
    !ObjectRegistry[obj.type]?.interpretationLocked &&
    !!(obj.props as { printInterpretation?: boolean }).printInterpretation;

  // Single object holding the full ZPL footprint (w/h) and the bar
  // sub-rectangle (barW/barH/barLeftPx/barTopPx). Defaults zero out
  // when the bwip canvas hasn't rendered yet.
  const dim: BarcodeDisplaySize = barcodeCanvas
    ? getDisplaySize(displayObj, barcodeCanvas, scale, dpmm)
    : { w: 0, h: 0, barW: 0, barH: 0, barLeftPx: 0, barTopPx: 0,
        upright: { w: 0, h: 0, barW: 0, barH: 0, barLeftPx: 0, barTopPx: 0 } };

  // Publish the rotated visual footprint (dots) for the align/distribute math.
  // dim.w/dim.h are the post-rotation px extent; objectBounds consumes the
  // already-rotated footprint verbatim.
  const footprintWDots = pxToDots(dim.w, scale, dpmm);
  const footprintHDots = pxToDots(dim.h, scale, dpmm);
  // Rotation-aware bar sub-rect height; objectBounds reads it only as the
  // fallback for the upright FT anchor when upright dims aren't published yet.
  const footprintBarHDots = pxToDots(dim.barH, scale, dpmm);
  // Text-zone offset (dots) of the bbox top-left from the bars, mirroring the
  // render shift (-barLeftPx, -barTopPx) so objectBounds lands the same origin.
  const footprintBarLeftDots = pxToDots(dim.barLeftPx, scale, dpmm);
  const footprintBarTopDots = pxToDots(dim.barTopPx, scale, dpmm);
  // Upright (unrotated) bar-rect size, for the rotation-aware ^FT anchor.
  const uprightBarWDots = pxToDots(dim.upright.barW, scale, dpmm);
  const uprightBarHDots = pxToDots(dim.upright.barH, scale, dpmm);
  useEffect(() => {
    // Footprint dropped to zero (e.g. content cleared): drop the stale entry.
    if (footprintWDots <= 0 || footprintHDots <= 0) {
      clearMeasuredBounds(obj.id);
      return;
    }
    setMeasuredBounds(obj.id, {
      width: footprintWDots,
      height: footprintHDots,
      barHeightDots: footprintBarHDots,
      barLeftDots: footprintBarLeftDots,
      barTopDots: footprintBarTopDots,
      uprightBarWDots,
      uprightBarHDots,
    });
  }, [obj.id, footprintWDots, footprintHDots, footprintBarHDots, footprintBarLeftDots, footprintBarTopDots, uprightBarWDots, uprightBarHDots]);
  useEffect(() => () => clearMeasuredBounds(obj.id), [obj.id]);

  // ^FT anchor (bar base, left edge) -> bbox top-left, rotation-aware: N shifts
  // up by the bar height; R/I/B rotate the anchor with the field. Shared source
  // (barcodeFtAnchorOffset) so objectBounds lands the same origin.
  const rotation = objectRotation(obj.props);
  const ftBarHDots =
    uprightBarHDots > 0
      ? uprightBarHDots
      : BARCODE_1D_TYPES.has(obj.type)
        ? (obj.props as { height: number }).height
        : 0;
  // A rotated QR prints as a shift-free ^GFA, so the ^BQ artifacts below are N-only.
  const graphicQr = qrPrintsAsGraphic(obj);
  const ftOffset = barcodeFtAnchorOffset(graphicQr ? "N" : rotation, uprightBarWDots, ftBarHDots);
  // Zebra firmware artifact: ^FT for QR shifts the symbol up by exactly 3 modules
  // (= 3 * magnification dots), independent of dpmm or content; ^FO QR is +10 dots.
  // Verified against Labelary across magnifications 4-10 at 8 and 12 dpmm.
  const qrFtShiftDots =
    obj.type === "qrcode" && !graphicQr
      ? QR_FT_MODULE_OFFSET * (obj.props as { magnification: number }).magnification
      : 0;
  const foYShiftDots = obj.type === "qrcode" && !graphicQr ? QR_FO_Y_OFFSET_DOTS : 0;

  const displayX = obj.positionType === "FT" ? obj.x + ftOffset.x : obj.x;
  const displayY =
    obj.positionType === "FT"
      ? obj.y + ftOffset.y - qrFtShiftDots
      : obj.y + foYShiftDots;

  // Bars draw at FO; bbox top-left shifts by (-barLeftPx, -barTopPx)
  // when the text zone extends LEFT/ABOVE the bars (rotated EAN/UPC,
  // inverted EAN/UPC/LOGMARS). The Konva Group is positioned at bbox
  // top-left and KImage offsets back to land bars at FO.
  const x = offsetX + dotsToPx(displayX, scale, dpmm) - dim.barLeftPx;
  const y = offsetY + dotsToPx(displayY, scale, dpmm) - dim.barTopPx;

  // Dotted frame over the sample bars: orange for a blank (unconfigured) field,
  // red for genuinely uncodable content. Shared by both render branches.
  const showStateFrame = warnBlank || invalid;
  const stateFrameColor = invalid ? colors.error : CANVAS_WARNING;

  // Whole-object drag (snap + commit) is centralized in the drag controller;
  // the commit is a pure translation, so the bar-anchor offset math is moot.
  const handleDragMove = dragHandlers?.onDragMove;
  const handleDragEnd = dragHandlers?.onDragEnd;

  if (barcodeCanvas) {
    // Konva crop prop is undefined when no cropping is needed; passing it
    // selectively skips bwip's internal padding (e.g. GS1 DataBar's
    // paddingheight rows) so bars fill the bbox at firmware-correct height.
    const bitmapCrop = dim.bitmapCrop;
    // Force-off when the symbology has no HRI in ZPL (e.g. GS1 Databar); the
    // canvas must match the print output even if a legacy saved object still
    // carries printInterpretation: true.
    const isUpright = rotation === "N";
    // Generic 1D bar-to-HRI gap (bar bottom to glyph cap top). Labelary's
    // is a module-independent ~6 dots; 5 sits a hair tighter.
    const textGap = Math.max(dotsToPx(5, scale, dpmm), 3);

    const hri = ObjectRegistry[obj.type]?.hri;
    // fontDots returns em font dots directly (^BS: OCR-B step table);
    // the per-module fallback is em-calibrated for Vera Font A.
    const baseFontDots = hri?.fontDots
      ? hri.fontDots(moduleWidth)
      : moduleWidth * VERA_MONO_HRI_EM_PER_MODULE;
    const fontDots =
      gs1Hri && printInterpEnabled
        ? gs1HriFontDots(rawContent, baseFontDots, uprightBarWDots)
        : baseFontDots;
    const textFontSize = Math.max(dotsToPx(fontDots, scale, dpmm), 6);
    // Generic 1D subtracts this below the bars so the visible bar-to-cap gap
    // equals textGap and stays module-width-independent (see the constant).
    const glyphTopPad = textFontSize * VERA_MONO_HRI_CAP_TOP_PAD;
    // Konva centers the line in its em box, so a digit baseline sits ~glyphTopPad
    // above the box bottom. Above-bars centered text adds it back so the visible
    // glyph bottom (not the box) lands aboveGapPx over the bars; ^BS bottom-aligns
    // its own box and needs no correction.
    const aboveBottomPad = hri?.fontDots ? 0 : glyphTopPad;
    const checkDigit = (obj.props as { checkDigit?: boolean }).checkDigit;
    const displayText = hri?.formatHri?.(rawContent, checkDigit) ?? rawContent;
    const isTextAbove = resolveHriAbove(obj);
    // Above-gap grows with module width (Labelary); per-symbology override
    // wins (logmars/^BS), else the shared above-gap table. 3px floor keeps
    // it legible at tiny scales.
    const gapDots =
      resolveMwValue(hri?.aboveGapDots, moduleWidth) ?? aboveHriGapDots(moduleWidth);
    const aboveGapPx = Math.max(dotsToPx(gapDots, scale, dpmm), 3);

    // ── 1D barcode with HRI overlay (all 4 rotations, both EAN/UPC and
    //    Other 1D). Text overlay always lives in upright bbox-relative
    //    coords inside an inner rotated Group; the Group's transform
    //    handles every R/I/B placement. Upright EAN/UPC additionally
    //    needs clip-expansion on the outer Group so the floated
    //    sys/trail digits stay visible (their x extends past the
    //    bar bbox); rotated EAN/UPC gets no clipping because the
    //    floated digits land within the rotated bbox after Konva's
    //    bbox computation.
    const isEanUpc = EAN_UPC_TYPES.has(obj.type);
    const showHriOverlay =
      printInterpEnabled && BARCODE_1D_TYPES.has(obj.type);
    const isUprightEanUpc = isUpright && isEanUpc;

    if (showHriOverlay) {
      const ub = dim.upright;
      // Inner Group covers the full upright bbox so KImage + text both
      // live inside it at upright bbox-relative coords. The Group's
      // transform handles all R/I/B placement.
      const innerTr = rotatedGroupTransform(rotation, ub.w, ub.h);

      // Build text overlay content in upright bbox-relative coords.
      // Upright EAN/UPC also needs clip extents to keep the floated
      // sys/trail digits visible past the bar bbox; the helper returns
      // them alongside the digit nodes, gated by isUprightEanUpc at
      // the parent Group below.
      let overlayContent: React.ReactNode;
      let eanOverlay: ReturnType<typeof buildEanUpcDigitOverlay> | null = null;
      // EAN/UPC above renders a single centered HRI line (Vera, Labelary-
      // validated at all mw), not the split sys/trail fragment layout used
      // below; route it through the generic centered-text path.
      if (isEanUpc && !isTextAbove) {
        // Display px per encoded module = bar width / module count, where
        // the bwip canvas is moduleCount * renderScale px wide.
        const renderScale = get1DBwipScale(moduleWidth, scale, dpmm);
        const moduleCount = Math.max(barcodeCanvas.width / renderScale, 1);
        const modulePx = ub.barW / moduleCount;
        // OCR-B HRI: discrete font + gap per module width (caps, then
        // doubles), unlike the generic Vera linear sizing above.
        const eanFontSize = Math.max(dotsToPx(ocrbEanHriFontDots(moduleWidth), scale, dpmm), 6);
        const eanGap = Math.max(dotsToPx(ocrbEanHriGapDots(moduleWidth), scale, dpmm), 3);
        eanOverlay = buildEanUpcDigitOverlay({
          fragments: getEanUpcHriFragments(obj.type as EanUpcType, displayText),
          modulePx,
          uprightBarW: ub.barW,
          uprightBarH: ub.barH,
          textGap: eanGap,
          textFontSize: eanFontSize,
          fontFamily: eanUpcHriFontFamily(moduleWidth),
        });
        // EAN/UPC have barTopPx === 0 (no text zone above), so the
        // helper's bar-relative textY equals the bbox-relative one
        // here; render directly without an offset wrapper.
        overlayContent = eanOverlay.nodes;
      } else {
        // Other 1D: centered text, optionally flanked by start/stop glyphs.
        // GS1-128 HRI prints in Font 0, not the generic HRI face.
        const fontFamily = gs1Hri
          ? HRI_FONT_0
          : resolveMwValue(hri?.fontFamily, moduleWidth) ?? HRI_FONT_A;
        const textY = isTextAbove
          ? ub.barTopPx - textFontSize - aboveGapPx + aboveBottomPad
          : ub.barTopPx + ub.barH + textGap - glyphTopPad;
        // ^BS bottom-aligns the glyph in a fontSize-tall box so the baseline
        // sits a gap above the bars, matching the EAN overlay.
        const bottomAlign = hri?.fontDots
          ? { height: textFontSize, verticalAlign: "bottom" as const }
          : {};
        // Code 11/93: keep the centered text as-is and only add the shape
        // start/stop glyphs flanking it (Code 11 triangle, Code 93 square).
        const startStopGlyphs = hri?.startStopGlyph
          ? buildCode1dStartStopGlyphs({
              text: displayText, fontFamily, fontSize: textFontSize,
              barLeftPx: ub.barLeftPx, barW: ub.barW, textY,
              glyph: hri.startStopGlyph,
            })
          : null;
        // Keyed array (like the EAN path), not a fragment: a keyless data
        // Text adjacent to keyed start/stop Text nodes of the same type makes
        // react-konva mis-reconcile and drop the flanking ones (Code 39 *).
        const dataText = (
          <Text
            key="hri"
            x={ub.barLeftPx} y={textY} width={Math.max(ub.barW, 1)}
            text={displayText} fontSize={textFontSize}
            fontFamily={fontFamily}
            align="center" wrap="none" fill="#000000" listening={false}
            {...bottomAlign}
          />
        );
        overlayContent = startStopGlyphs ? [dataText, ...startStopGlyphs] : dataText;
      }

      // No counter-scaling: both resize axes live-reflow in useKonvaTransformer
      // (per-tick re-render at the committed size), so bars, HRI, text zone and
      // clip are always drawn at their true size and nothing stretches mid-drag.

      // Clip-expansion is upright-EAN/UPC only, absent on other paths
      // so Konva computes a natural bbox. Spread-or-empty keeps the
      // JSX free of four parallel ternaries.
      const clipProps = isUprightEanUpc && eanOverlay
        ? {
            clipX: -eanOverlay.clipLeft,
            clipY: 0,
            clipWidth: Math.max(ub.w, 1) + eanOverlay.clipLeft + eanOverlay.clipRight,
            clipHeight: Math.max(ub.h, 1) + textFontSize + textGap,
          }
        : {};

      return (
        <Group
          id={obj.id}
          x={x}
          y={y}
          {...clipProps}
          draggable={!obj.locked}
          {...selectionHandlers(onSelect)}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
        >
          <Group x={innerTr.x} y={innerTr.y} rotation={innerTr.rotation}>
            <KImage
              x={ub.barLeftPx}
              y={ub.barTopPx}
              image={barcodeCanvas}
              crop={bitmapCrop}
              width={ub.barW}
              height={isEanUpc
                ? ub.barH + dotsToPx(EAN_TEXT_ZONE_DOTS, scale, dpmm)
                : ub.barH}
              // Clip Transformer bbox to the bar area so resize handles ignore
              // the guard tails; the non-EAN case must undo the patch on the
              // reused instance (see restoreSelfRect).
              ref={(node) => {
                if (!node) return;
                if (isEanUpc) {
                  const w = ub.barW;
                  const h = ub.barH;
                  node.getSelfRect = () => ({ x: 0, y: 0, width: w, height: h });
                } else {
                  restoreSelfRect(node);
                }
              }}
              imageSmoothingEnabled={false}
              // EAN/UPC draws its selection stroke as the Rect below so
              // the highlight skips the guard tails.
              stroke={!isEanUpc && isSelected ? colors.selection : undefined}
              strokeWidth={!isEanUpc && isSelected ? 2 : 0}
              strokeScaleEnabled={false}
            />
            {isEanUpc && isSelected && (
              <Rect
                x={ub.barLeftPx}
                y={ub.barTopPx}
                width={ub.barW}
                height={ub.barH}
                stroke={colors.selection}
                strokeWidth={2}
                strokeScaleEnabled={false}
                listening={false}
              />
            )}
            <Group key={`hri-${fontVersion}`} ref={setOverlayGroupRef}>{overlayContent}</Group>
            {showStateFrame && (
              <StateFrame {...stateFrameProps(ub)} color={stateFrameColor} />
            )}
          </Group>
        </Group>
      );
    }

    // Default path: 2D barcodes + 1D without HRI. bwip renders upright,
    // the inner Group's rotated transform handles R/I/B placement.
    const ub = dim.upright;
    const defaultInnerTr = rotatedGroupTransform(rotation, ub.w, ub.h);
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
        <Group x={defaultInnerTr.x} y={defaultInnerTr.y} rotation={defaultInnerTr.rotation}>
          <KImage
            x={ub.barLeftPx}
            y={ub.barTopPx}
            image={barcodeCanvas}
            crop={bitmapCrop}
            width={ub.barW}
            height={ub.barH}
            ref={restoreSelfRect}
            imageSmoothingEnabled={false}
            stroke={isSelected ? colors.selection : undefined}
            strokeWidth={isSelected ? 2 : 0}
            strokeScaleEnabled={false}
          />
          {showStateFrame && (
            <StateFrame {...stateFrameProps(ub)} color={stateFrameColor} />
          )}
        </Group>
      </Group>
    );
  }

  // Fallback placeholder (error or not yet rendered); a literal mode 2/3
  // MaxiCode missing its carrier message already reports via preflight
  // (missing-SCM, or emptyContent when blank), so suppress the red alarm
  // box. Bound fields keep it (renderFailed case).
  const scmOwned =
    obj.type === "maxicode" &&
    maxicodeScmOwnedByPreflight(preBindingContent, obj.props as MaxicodeProps);
  const fallbackError = scmOwned ? null : errorMsg;
  // Spec-fixed-size types (maxicode) draw the card at their real footprint, so
  // snap/align/selection never work against a phantom box.
  const fixedSize = ObjectRegistry[obj.type]?.defaultSize;
  const fbDots =
    fixedSize && "widthMm" in fixedSize
      ? { w: mmToDots(fixedSize.widthMm, dpmm), h: mmToDots(fixedSize.heightMm, dpmm) }
      : { w: 200, h: 80 };
  const fbW = dotsToPx(fbDots.w, scale, dpmm);
  const fbH = dotsToPx(fbDots.h, scale, dpmm);
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
        width={fbW}
        height={fbH}
        fill="#f9fafb"
        stroke={isSelected ? colors.selection : "#9ca3af"}
        strokeWidth={isSelected ? 2 : 1}
        dash={isSelected ? undefined : [4, 2]}
      />
      <Text
        x={6}
        y={6}
        width={fbW - 12}
        height={fbH - 12}
        wrap="word"
        ellipsis
        text={fallbackError ? `⚠ ${fallbackError}` : obj.type}
        fontSize={Math.max(dotsToPx(10, scale, dpmm), 8)}
        fill={fallbackError ? "#b91c1c" : "#374151"}
      />
    </Group>
  );
}
