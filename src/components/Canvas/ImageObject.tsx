import { useState, useEffect, useRef, type ReactElement } from "react";
import { Group, Image as KImage, Path, Rect } from "react-konva";
import type { LabelObject } from "@zplab/core/types/Group";
import { dotsToPx, pxToDots } from "@zplab/core/lib/coordinates";
import { getImage } from "@zplab/core/lib/imageCache";
import { rasterFromGfa } from "@zplab/core/lib/gfaDecode";
import { headerByteSource, imageEmitRotation, isImageRotatable } from "@zplab/core/registry/image";
import { loadImage } from "@zplab/core/lib/loadImage";
import { monoPreviewCanvas, rasterPreviewCanvas } from "@zplab/core/lib/imageToZpl";
import { useColorScheme } from "../../hooks/useColorScheme";
import { selectionHandlers, type KonvaObjectProps } from "./konvaObjectProps";
import { setMeasuredBounds, clearMeasuredBounds } from "../../lib/measuredBoundsCache";
import { rotatedGroupTransform } from "./rotatedGroupTransform";
import { isAxisSwapped, objectRotation } from "@zplab/core/registry/rotation";

type ImageLabelObject = Extract<LabelObject, { type: "image" }>;
type Props = Omit<KonvaObjectProps, "obj"> & { obj: ImageLabelObject };

/** Keyed on the props object (like footprintProber's caches): entries die with
 *  their design instead of pinning megabyte payload strings for the process
 *  lifetime, and the canvas on screen can never be evicted from under Konva. */
const gfaPreviewCache = new WeakMap<object, HTMLCanvasElement | null>();

/** Decode-and-draw for an image the store cannot supply. Memoised per props
 *  identity (an edit swaps the props object): a re-render must not re-decode,
 *  and Konva needs a stable image identity. */
function gfaPreviewCanvas(
  props: object,
  gfa: string | undefined,
  rotation: string,
): HTMLCanvasElement | null {
  if (!gfa || rotation !== "N") return null;
  const hit = gfaPreviewCache.get(props);
  if (hit !== undefined) return hit;
  // No visible width: the header is what these bytes print at (headerByteSource).
  const raster = rasterFromGfa(gfa);
  const canvas = raster ? rasterPreviewCanvas(raster) : null;
  gfaPreviewCache.set(props, canvas);
  return canvas;
}

/** Own component so the async-decode hooks stay out of KonvaObject's
 *  dispatcher, which narrows `obj` before passing. */
export function ImageObject({
  obj,
  scale,
  dpmm,
  offsetX,
  offsetY,
  isSelected,
  onSelect,
  dragHandlers,
}: Props) {
  const p = obj.props;
  const colors = useColorScheme();
  const cached = getImage(p.imageId);

  const [htmlImg, setHtmlImg] = useState<HTMLImageElement | null>(null);
  // Reset the cached HTMLImageElement during render when the source changes,
  // instead of inside an effect. The "set state during render on prop change"
  // pattern is the official React workaround for what would otherwise be a
  // setState-in-effect anti-pattern. The next render observes prevDataUrl
  // already updated, so this does not loop.
  const prevDataUrlRef = useRef<string | undefined>(cached?.dataUrl);
  if (prevDataUrlRef.current !== cached?.dataUrl) {
    prevDataUrlRef.current = cached?.dataUrl;
    setHtmlImg(null);
  }
  useEffect(() => {
    if (!cached) return;
    let active = true;
    void loadImage(cached.dataUrl)
      .then((img) => {
        if (active) setHtmlImg(img);
      })
      .catch(() => {
        // A bitmap that fails to decode just doesn't render (as before).
      });
    return () => {
      active = false;
    };
  }, [cached]);

  // Whether this instance turns, which is not the same question as the rotation
  // its bytes resolve at (imageEmitRotation).
  const rotation = isImageRotatable(p) ? objectRotation(p) : "N";
  const swap = isAxisSwapped(rotation);

  // WYSIWYG mono preview (see monoPreviewCanvas), handed to Konva to nearest-
  // neighbour upscale (imageSmoothingEnabled=false, as BarcodeObject). Upright;
  // the inner Group turns it. The colored source is never shown on the label.
  const preview = htmlImg && cached
    ? monoPreviewCanvas(htmlImg, p.widthDots, p.threshold)
    // Byte-only graphic: headerByteSource is the emit-side precedence, so the
    // canvas cannot show bytes the print would not use.
    : gfaPreviewCanvas(p, headerByteSource(p), imageEmitRotation(p));
  const widthDots = !cached && preview ? preview.width : p.widthDots;
  const w = dotsToPx(widthDots, scale, dpmm);
  // Height from the raster is dot-quantised, so the box matches the emitted
  // ^GF height exactly. Pre-load, aspect-lock off the cached dimensions
  // (guarding 0-width malformed files: NaN-sized nodes otherwise); recall-only
  // placeholders fall back to `heightDots` so the user can shape the box.
  const h = preview
    ? w * (preview.height / preview.width)
    : cached && cached.width > 0
      ? w * (cached.height / cached.width)
      : dotsToPx(p.heightDots ?? p.widthDots, scale, dpmm);
  const x = offsetX + dotsToPx(obj.x, scale, dpmm);
  const y = offsetY + dotsToPx(obj.y, scale, dpmm);

  // Publish the rendered footprint (dots) for align/distribute; height tracks
  // the aspect-locked size, not the stale heightDots prop. Store the already-
  // rotated footprint (axes swapped on R/B) so bounds/selection match.
  const uprightWDots = pxToDots(w, scale, dpmm);
  const uprightHDots = pxToDots(h, scale, dpmm);
  const footprintWDots = swap ? uprightHDots : uprightWDots;
  const footprintHDots = swap ? uprightWDots : uprightHDots;
  useEffect(() => {
    // Footprint dropped to zero (e.g. content cleared): drop the stale entry.
    if (footprintWDots <= 0 || footprintHDots <= 0) {
      clearMeasuredBounds(obj.id);
      return;
    }
    setMeasuredBounds(obj.id, { width: footprintWDots, height: footprintHDots });
  }, [obj.id, footprintWDots, footprintHDots]);
  useEffect(() => () => clearMeasuredBounds(obj.id), [obj.id]);

  // Whole-object drag (snap + commit) is centralized in the drag controller.
  const handleDragMove = dragHandlers?.onDragMove;
  const handleDragEnd = dragHandlers?.onDragEnd;

  // Gate on `preview`, not `htmlImg`: an image that loaded but can't rasterize
  // (dimensionless SVG, naturalWidth 0) emits a blank ^GF, so showing the color
  // source would lie. Fall through to the placeholder in that case.
  if (preview) {
    // bwip-style rotation: the upright preview draws inside an inner Group whose
    // rotatedGroupTransform places it for R/I/B; the outer Group keeps the
    // object's x/y and interaction (matches BarcodeObject).
    const innerTr = rotatedGroupTransform(rotation, w, h);
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
        <Group x={innerTr.x} y={innerTr.y} rotation={innerTr.rotation}>
          <KImage
            image={preview}
            width={w}
            height={h}
            imageSmoothingEnabled={false}
            stroke={isSelected ? colors.selection : undefined}
            strokeWidth={isSelected ? 2 : 0}
            strokeScaleEnabled={false}
          />
        </Group>
      </Group>
    );
  }

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
        width={w}
        height={h}
        fill="#f9fafb"
        stroke={isSelected ? colors.selection : "#9ca3af"}
        strokeWidth={isSelected ? 2 : 1}
        dash={[4, 2]}
      />
      <PlaceholderIcon w={w} h={h} />
    </Group>
  );
}

/** Heroicons "photo" outline rendered via Konva.Path so the placeholder
 *  is OS-independent. We previously used the 🖼 emoji which rendered
 *  inconsistently (color on macOS, monochrome on Linux, missing on
 *  some Windows configurations). */
const PHOTO_ICON_PATH =
  "M2.25 15.75l5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z";
const PHOTO_ICON_VIEWBOX = 24;

function PlaceholderIcon({ w, h }: { w: number; h: number }): ReactElement {
  // Centre the icon at 60% of the smaller dimension; clamp so a thin
  // image strip still shows something visible. Stroke-only mirrors
  // Heroicons' outline style.
  const target = Math.max(Math.min(w, h) * 0.6, 12);
  const scale = target / PHOTO_ICON_VIEWBOX;
  return (
    <Path
      data={PHOTO_ICON_PATH}
      x={(w - target) / 2}
      y={(h - target) / 2}
      scaleX={scale}
      scaleY={scale}
      stroke="#6b7280"
      strokeWidth={1.5 / scale}
      fillEnabled={false}
      lineCap="round"
      lineJoin="round"
    />
  );
}
