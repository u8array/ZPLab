import { useRef, useEffect, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import type Konva from "konva";
import { dotsToPx, pxToDots } from "@zplab/core/lib/coordinates";
import { blockBoundsDots, blockGlyphAnchorPoint, blockReflowGeometry, tbBoundsDots, tbReflowGeometry, type BlockJustify, type ZplRotation } from "@zplab/core/lib/zebraTextLayout";
import { resolveDeviceFontId } from "@zplab/core/lib/customFonts";
import { getCurrentObjects, useLabelStore } from "../../../store/labelStore";
import {
  SHAPE_PRIMITIVE_TYPES,
  BARCODE_1D_TYPES,
  STACKED_2D_TYPES,
  getEntry,
} from "@zplab/core/registry";
import type { LeafObject } from "@zplab/core/registry";
import { resolveBlockResizeMode } from "@zplab/core/registry/transformHelpers";
import { resolveTextMode, type TextProps } from "@zplab/core/registry/text";
import type { ObjectChanges } from "../../../store/labelStore";
import { findObjectById, isGroup } from "@zplab/core/types/Group";
import {
  activeEdgesFromAnchorName,
  applyHeightSnap,
  applyModuleWidthSnap,
  barcodeHeightReflowGeometry,
  barcodeMwReflowGeometry,
  uniformReflowGeometry,
  pinnedMin,
  pinInactiveEdges,
  positionDidMove,
  forceAspectBox,
  shrinkingBelowFloor,
  type ActiveEdgeFlags,
  type BarcodeHeightReflowStart,
  type BarcodeMwReflowStart,
  type BoundingBox,
  type TransformAnchor,
  type UniformReflowStart,
} from "../transformerGeometry";
import { naturalRect, parentRect, stageRect } from "../nodeRect";
import {
  committedUprightBarDots,
  modelPositionFromRenderedTopLeft,
  renderedTopLeftFromModel,
} from "../transformPosition";
import { isBarcode, isRightAnchoredField, rotatedFootprint, type BoundingBoxDots } from "@zplab/core/lib/objectBounds";
import { projectedAnchorXDots, projectMultiResize } from "../../../lib/multiResize";
import { lineHandlesNodeId, lineRootNodeId } from "../konvaObjectProps";
import { isAxisSwapped, objectRotation } from "@zplab/core/registry/rotation";
import { getMeasuredSnapshot } from "../../../lib/measuredBoundsCache";
import {
  computeResizeSnap,
  deriveActiveEdges,
  type SnapGuide,
  type SnapRect,
} from "../../../lib/snapGuides";

/** Minimum bounding-box edge length during a resize, in stage pixels. Below
 *  this the user is presumed to have flicked past the object and we keep the
 *  previous box rather than collapsing it to a sliver. */
const MIN_RESIZE_BOX_PX = 10;

/** Pack a Konva clientRect into the SnapRect shape used by snap helpers. */
function toSnapRect(
  id: string,
  rect: { x: number; y: number; width: number; height: number },
): SnapRect {
  return { id, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * Snapshot every object's stage-space bbox at transform start. Other objects
 * can't move during a resize, so we cache once and avoid per-tick Konva queries.
 */
function captureOtherRects(
  stage: Konva.Stage,
  objects: LeafObject[],
  excludeId: string,
): SnapRect[] {
  const result: SnapRect[] = [];
  for (const o of objects) {
    if (o.id === excludeId) continue;
    const n = stage.findOne<Konva.Node>(`#${o.id}`);
    if (!n) continue;
    result.push(toSnapRect(o.id, stageRect(n, stage)));
  }
  return result;
}

/**
 * Phase 2 of resize: snap moving edges to other objects' / label edges
 * (object-snap, mirrors drag-time snap). Pure delegation to `computeResizeSnap`
 * with input shape conversion.
 */
function applyResizeObjectSnap(
  bbox: BoundingBox,
  startBbox: SnapRect,
  others: SnapRect[],
  labelRect: SnapRect,
): { bbox: BoundingBox; guides: SnapGuide[] } {
  const draggedRect = toSnapRect(startBbox.id, bbox);
  const activeEdges = deriveActiveEdges(startBbox, draggedRect);
  const result = computeResizeSnap(
    draggedRect,
    others,
    activeEdges,
    undefined,
    labelRect,
    labelRect,
  );
  return {
    bbox: {
      x: result.x,
      y: result.y,
      width: result.width,
      height: result.height,
      rotation: bbox.rotation,
    },
    guides: result.guides,
  };
}

/** Invisible rect at the selection's model union; the transformer attaches to
 *  it for multi-resize so member nodes never stretch live. */
export const MULTI_RESIZE_PROXY_ID = "multi-resize-proxy";

/** Shapes whose reflow is center-aware (box/ellipse); line resizes via endpoint
 *  handles, not this reflow, so it stays out. One source for both the arming and
 *  supportsCenteredResize so they can't drift. */
const SHAPE_REFLOW_TYPES: ReadonlySet<string> = new Set(["box", "ellipse"]);

/** Types the transformer mirrors under Alt: 1D barcodes, uniform-2D matrix
 *  codes, and box/ellipse. Mirrors the reflow arming (registry-derived for
 *  barcodes, SHAPE_REFLOW_TYPES for shapes) so centeredResizeArmed matches it. */
function supportsCenteredResize(type: string): boolean {
  return (
    BARCODE_1D_TYPES.has(type) || !!getEntry(type)?.uniformScaleProp || SHAPE_REFLOW_TYPES.has(type)
  );
}

interface Options {
  transformerRef: React.RefObject<Konva.Transformer | null>;
  stageRef: React.RefObject<Konva.Stage | null>;
  selectedIds: string[];
  objects: LeafObject[];
  scale: number;
  dpmm: number;
  objectsOffsetX: number;
  labelOffsetY: number;
  snap: (dots: number) => number;
  updateObject: (id: string, changes: ObjectChanges) => void;
  updateObjects: (updates: { id: string; changes: ObjectChanges }[]) => void;
  /** Model union bbox of the selection when every member is movable; null
   *  disables multi-resize (locked member, or single selection). */
  multiResizeBboxDots: BoundingBoxDots | null;
  /** Label rect in stage-screen space, used as a snap target. */
  labelRect: SnapRect;
  /** True when grid-snap is OFF; object-snap during resize mirrors drag. */
  objectSnapEnabled: boolean;
  /** Shared Ctrl/Cmd bypass state (useSnapBypassRef). boundBoxFunc receives no
   *  native event, so the held modifier arrives via this ref. */
  snapBypassRef: React.RefObject<boolean>;
  /** Pushes resize-time snap guides into the canvas's shared guide state. */
  setGuides: (guides: SnapGuide[]) => void;
  /** Canvas view rotation. When non-zero, the parent group is rotated and
   *  Konva's bbox semantics in boundBoxFunc no longer match our axis-aware
   *  snap / pin helpers; we fall back to native Konva resize there. */
  viewRotation: number;
  /** True while Labelary preview replaces the editor leaves. The selected
   *  KonvaObject nodes are unmounted during preview, so we re-resolve them
   *  by id when the flag flips back to false. */
  previewLocks: boolean;
}

export interface TransformerState {
  rotateEnabled: false;
  resizeEnabled: boolean;
  enabledAnchors: string[] | undefined;
  /** Center-justified glyph blocks scale from the center so the box grows
   *  symmetrically and tracks the centered text live. */
  centeredScaling: boolean;
  /** The single selection supports Alt-centered resize (1D barcode or 2D matrix
   *  code); the Alt-handle bypass gates on it. */
  centeredResizeArmed: boolean;
  onTransformStart: () => void;
  onTransform: (e?: Konva.KonvaEventObject<Event>) => void;
  boundBoxFunc: (oldBox: BoundingBox, newBox: BoundingBox) => BoundingBox;
  onTransformEnd: () => void;
}

/** Pre-drag snapshot + collapsed final for a one-entry reflow commit, or null
 *  when the drag baked nothing. */
type ReflowCommit = { restore: ObjectChanges; final: ObjectChanges } | null;

export function useKonvaTransformer({
  transformerRef,
  stageRef,
  selectedIds,
  objects,
  scale,
  dpmm,
  objectsOffsetX,
  labelOffsetY,
  snap,
  updateObject,
  updateObjects,
  multiResizeBboxDots,
  labelRect,
  objectSnapEnabled,
  snapBypassRef,
  setGuides,
  viewRotation,
  previewLocks,
}: Options): TransformerState {
  // Captures the per-type snap reference at drag start so boundBoxFunc uses a
  // fixed step size throughout the entire drag session (row height for stacked
  // 2D, moduleWidth for 1D barcodes).
  const transformAnchorRef = useRef<TransformAnchor | null>(null);
  // Captures the bbox at transform start so deriveActiveEdges can detect which
  // edges are moving relative to the start state (oldBox in boundBoxFunc is the
  // previous frame, which would always look "everything moved").
  const transformStartBboxRef = useRef<SnapRect | null>(null);
  // Snapshot of the other objects' bboxes at transform start. Other objects
  // can't move during a resize, so we avoid re-querying Konva on every tick.
  const othersSnapshotRef = useRef<SnapRect[]>([]);
  // Anchor name at drag start; commit skips grid-snap on inactive axes
  // so the opposite corner stays put.
  const activeEdgesRef = useRef<ActiveEdgeFlags | null>(null);
  // Block node rect at glyph-mode drag start (unrotated view only); commit
  // re-measures with the baked font to pin the stable point, so a justified
  // block doesn't jump when the font re-justifies in the same width.
  const glyphBlockStartRectRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Active only while a ^FB block is being live-reflowed (frame mode): the
  // block re-wraps as blockWidth/blockLines change each tick instead of the
  // group scaling. Captures the fixed (anchored) edges so the opposite side
  // stays put. Null for every other transform.
  const liveReflowRef = useRef<{
    mode: "fb" | "tb";
    edges: ActiveEdgeFlags | null;
    rotation: "N" | "R" | "I" | "B";
    lineSpacing: number;
    fontHeight: number;
    fontId?: string;
    leftX: number;
    topY: number;
    rightX: number;
    bottomY: number;
    // Pre-drag model snapshot + a dirty flag, so the per-tick (untracked) store
    // writes collapse into a single undo entry on release. blockLines is the
    // ^FB second axis; blockHeight the ^TB one.
    snapshot: { x: number; y: number; blockWidth: number; blockLines: number; blockHeight: number };
    changed: boolean;
  } | null>(null);

  // Box/ellipse reflow per tick so stroke inset and corners stay correct under
  // raw scale; snapshot + dirty flag collapse the writes into one undo entry.
  const shapeReflowRef = useRef<{
    snapshot: { x: number; y: number; width: number; height: number };
    changed: boolean;
    /** Alt state of the last live pin, so the commit centres to match the last
     *  preview frame even if Alt is released before mouse-up (no transform tick). */
    lastCentered: boolean;
  } | null>(null);

  // Barcode live reflow: re-renders on each integer crossing (module width,
  // height dot, or magnification, per mode) so the bitmap always draws at its
  // true size instead of stretching until release. The per-tick pin also
  // stands in for boundBoxFunc's band snap, which breaks under rotation.
  const barcodeReflowRef = useRef<
    | (BarcodeMwReflowStart & {
        mode: "mw";
        uprightW0: number;
        uprightH0: number;
        snapshot: { x: number; y: number; moduleWidth: number; height?: number };
        /** Gesture-start values of extraModuleWidthProps (TLC39 ^BT w2). */
        extraWidths0?: Record<string, number>;
        changed: boolean;
        lastCentered: boolean;
      })
    | (BarcodeHeightReflowStart & {
        mode: "height";
        uprightW0: number;
        snapshot: { x: number; y: number; height: number };
        changed: boolean;
        lastCentered: boolean;
      })
    | (UniformReflowStart & {
        mode: "uniform";
        propName: string;
        // Captured at arm time like the 1D modes: the cache updates after each
        // crossing's re-render, so a fresh read times the start-relative ratio
        // would double-count from the second crossing on.
        uprightW0?: number;
        uprightH0?: number;
        snapshot: { x: number; y: number; modules: number };
        changed: boolean;
        lastCentered: boolean;
      })
    | null
  >(null);

  const multiResizeRef = useRef<{
    proxy: Konva.Node;
    bboxDots: BoundingBoxDots;
    start: { x: number; y: number };
    nodes: {
      node: Konva.Node;
      startX: number;
      startY: number;
      anchorPxX: number;
      anchorPxY: number;
      scales: boolean;
      uniform: boolean;
      frozenX: boolean;
      hide?: Konva.Node;
    }[];
    ids: string[];
  } | null>(null);

  // True while any live reflow (text block, shape, or barcode) owns the drag.
  const anyReflowActive = () =>
    liveReflowRef.current !== null ||
    shapeReflowRef.current !== null ||
    barcodeReflowRef.current !== null;

  // Same indirection as anyReflowActive, for the React Compiler.
  const multiResizeActive = () => multiResizeRef.current !== null;

  // Block resize mode resolved once at drag start (panel mode + Alt). Reused at
  // commit so toggling Alt mid-drag can't make start and end disagree.
  const blockResizeModeRef = useRef<"frame" | "glyph">("frame");

  // Live Alt state: sampled once at drag start for the block resize mode,
  // and read live per tick for centered barcode resize (mirrors Konva's own
  // Alt-driven preview).
  const altKeyRef = useRef(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent) => { altKeyRef.current = e.altKey; };
    // Reset on blur: a keyup during Alt+Tab never fires, so the ref would stick.
    const clear = () => { altKeyRef.current = false; };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // A live reflow pauses undo recording on drag start and resumes in
  // onTransformEnd. If we unmount mid-drag, transformend never fires, so resume
  // here too or undo would stay silently disabled app-wide. resume() is an
  // idempotent set, so the no-active-drag case is a harmless no-op.
  useEffect(() => {
    return () => {
      if (anyReflowActive()) {
        useLabelStore.temporal.getState().resume();
      }
    };
  }, []);

  // Stable key of selected object types, avoids re-running on every drag-move
  // position update (which changes objects but not the types of selected objects).
  const selectedTypesKey = selectedIds
    .map((id) => objects.find((o) => o.id === id)?.type ?? "")
    .join(",");

  // Signature of the selected objects' size-relevant props. Changes after
  // commitTransform → forces the transformer to re-measure the attached node
  // so its bounding box matches the new rendered size. Position is excluded:
  // moves don't change bbox dimensions, and Konva tracks the node's position
  // automatically. Lock state is included so toggling lock re-runs the attach
  // effect (locked nodes detach; unlocked nodes re-attach).
  const selectedSignature = selectedIds
    .map((id) => {
      const o = objects.find((obj) => obj.id === id);
      return o ? `${id}:${o.locked ? "L" : ""}:${JSON.stringify(o.props)}` : id;
    })
    .join("|");

  // Toggling the block drag mode swaps the measured frame rect on/off, so the
  // transformer must re-measure even though no object prop changed.
  const blockDragMode = useLabelStore((s) => s.blockDragMode);

  // Layout effect: sync before paint or the border flashes for one frame.
  useLayoutEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;
    // During a live reflow the per-tick store update re-runs this effect;
    // re-attaching (.nodes()) mid-drag aborts the gesture, so skip it. The
    // reflow handler keeps the transformer in sync via forceUpdate().
    if (anyReflowActive() || multiResizeActive()) return;
    if (selectedIds.length === 0) {
      transformerRef.current.nodes([]);
      return;
    }
    if (selectedIds.length === 1) {
      const selectedObj = objects.find((o) => o.id === selectedIds[0]);
      const useTransformer =
        selectedObj && selectedObj.type !== "line" && !selectedObj.locked;
      const node = useTransformer
        ? stageRef.current.findOne<Konva.Node>(`#${selectedIds[0]}`)
        : null;
      transformerRef.current.nodes(node ? [node] : []);
    } else {
      // Attach to the proxy at the model union (client rects disagree for
      // fat diagonals / HRI); synced here, outside any gesture.
      const proxy = multiResizeBboxDots
        ? stageRef.current.findOne<Konva.Node>(`#${MULTI_RESIZE_PROXY_ID}`)
        : null;
      if (proxy && multiResizeBboxDots) {
        proxy.setAttrs({
          x: objectsOffsetX + dotsToPx(multiResizeBboxDots.x, scale, dpmm),
          y: labelOffsetY + dotsToPx(multiResizeBboxDots.y, scale, dpmm),
          width: dotsToPx(multiResizeBboxDots.width, scale, dpmm),
          height: dotsToPx(multiResizeBboxDots.height, scale, dpmm),
          scaleX: 1,
          scaleY: 1,
        });
        transformerRef.current.nodes([proxy]);
      } else {
        transformerRef.current.nodes([]);
      }
    }
    // Force a re-measure: after commitTransform the node's getClientRect has
    // changed but the transformer caches its bounds from the last interaction.
    transformerRef.current.forceUpdate();
    // selectedTypesKey encodes the type of every selected object, sufficient to
    // detect the line/non-line distinction that governs transformer attachment.
    // selectedSignature triggers a re-measure when an object's size or position
    // changes (e.g. after commitTransform finishes a resize).
    // previewLocks: KonvaObject nodes are unmounted during preview, so the
    // transformer holds stale node refs until we re-resolve once preview ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedIds,
    selectedTypesKey,
    selectedSignature,
    blockDragMode,
    stageRef,
    transformerRef,
    previewLocks,
    multiResizeBboxDots?.x,
    multiResizeBboxDots?.y,
    multiResizeBboxDots?.width,
    multiResizeBboxDots?.height,
    scale,
    dpmm,
    objectsOffsetX,
    labelOffsetY,
  ]);

  const singleSelected =
    selectedIds.length === 1
      ? objects.find((o) => o.id === selectedIds[0])
      : undefined;
  const resizeEnabled =
    selectedIds.length > 1
      ? multiResizeBboxDots != null
      : selectedIds.length === 1 && !singleSelected?.locked;
  const singleType = singleSelected?.type ?? "";
  // Exposed so the Alt-handle bypass (useAltClickCycle) gates on the SAME
  // resolved leaf selection the reflow arming uses, not a re-derived one.
  const centeredResizeArmed = supportsCenteredResize(singleType);
  const typeEntry = getEntry(singleType);
  const uniformScaleDef = typeEntry?.uniformScale;
  // uniformScaleProp implies uniformScale: integer-module 2D symbology scales
  // both axes together (square, or fixed-aspect rectangular DataMatrix), so
  // the registry doesn't need to set both.
  const isUniformScale =
    !!typeEntry?.uniformScaleProp ||
    (typeof uniformScaleDef === "function"
      ? !!singleSelected &&
        !isGroup(singleSelected) &&
        uniformScaleDef(singleSelected.props as object)
      : !!uniformScaleDef);
  const enabledAnchors: string[] | undefined =
    selectedIds.length > 1
      ? undefined
      : getEntry(singleType)?.heightLocked
        ? []
        : BARCODE_1D_TYPES.has(singleType)
          ? [
              "top-center",
              "bottom-center",
              // The screen handles map to the bar axes by rotation: for N/I
              // middle-left/right is the moduleWidth axis, for R/B it's
              // top/bottom-center (the bars turn a quarter). The live snap
              // rounds whichever screen axis carries moduleWidth to a valid ^BY
              // value (1..10) on release; mid-drag the bitmap stretches free.
              "middle-left",
              "middle-right",
            ]
          : isUniformScale
            ? ["top-left", "top-right", "bottom-left", "bottom-right"]
            : undefined;
  const isFreeResize = enabledAnchors === undefined;

  // The commit reuses this exact value (not a re-derivation) so the anchor pin
  // can't disagree with the preview when Alt flips the mode this prop can't see.
  const centeredScaling =
    !!singleSelected &&
    !isGroup(singleSelected) &&
    singleSelected.type === "text" &&
    !!(singleSelected.props as { blockWidth?: number }).blockWidth &&
    resolveBlockResizeMode(blockDragMode, false) === "glyph" &&
    (singleSelected.props as { blockJustify?: BlockJustify }).blockJustify === "C";

  /** Reset all transform-time state. Idempotent; safe to call from any exit path. */
  function cleanupTransformState() {
    multiResizeRef.current = null;
    transformAnchorRef.current = null;
    transformStartBboxRef.current = null;
    othersSnapshotRef.current = [];
    activeEdgesRef.current = null;
    liveReflowRef.current = null;
    shapeReflowRef.current = null;
    barcodeReflowRef.current = null;
    glyphBlockStartRectRef.current = null;
    blockResizeModeRef.current = "frame";
    setGuides([]);
  }

  /** Collapse a paused live-reflow drag into one undo entry: reset any residual
   *  node scale, and when the drag baked something (`commit` non-null), restore
   *  the pre-drag snapshot while still paused, resume, then re-apply the final
   *  geometry as a single tracked change. Always resumes + cleans up, even on a
   *  throw (resume is idempotent). */
  function collapseReflowToOneEntry(
    id: string | undefined,
    commit: ReflowCommit,
  ) {
    const node = id ? stageRef.current?.findOne<Konva.Node>(`#${id}`) : null;
    node?.scaleX(1);
    node?.scaleY(1);
    const temporal = useLabelStore.temporal.getState();
    try {
      if (id && commit) {
        updateObject(id, commit.restore);
        temporal.resume();
        updateObject(id, commit.final);
      }
    } finally {
      temporal.resume();
      cleanupTransformState();
    }
  }

  const onTransformStart = () => {
    if (selectedIds.length > 1) {
      const stage = stageRef.current;
      const proxy = stage?.findOne<Konva.Node>(`#${MULTI_RESIZE_PROXY_ID}`);
      if (!stage || !proxy || !multiResizeBboxDots) return;
      const nodes = selectedIds.flatMap((id) => {
        const leaf = objects.find((o) => o.id === id);
        if (!leaf) return [];
        // Lines are flat: transform their root group so body, hit line and
        // selection chrome all follow; other types transform their own node.
        const node = stage.findOne<Konva.Node>(
          leaf.type === "line" ? `#${lineRootNodeId(id)}` : `#${id}`,
        );
        if (!node) return [];
        // Grips would deform under the group scale; hide for the gesture.
        const hide = leaf.type === "line" ? stage.findOne<Konva.Node>(`#${lineHandlesNodeId(id)}`) : null;
        hide?.visible(false);
        const projX = projectedAnchorXDots(leaf, getMeasuredSnapshot().get(id)?.width);
        return [
          {
            node,
            startX: node.x(),
            startY: node.y(),
            // The quantity the commit projects (projectedAnchorXDots), not the
            // model anchor: a right-anchored field projects its ink edge, so
            // projecting x here jumped it by shift*(1-f) on release. Render
            // offsets (^FT bar base, ^BQ shift) ride along unscaled below.
            anchorPxX: objectsOffsetX + dotsToPx(projX ?? leaf.x, scale, dpmm),
            anchorPxY: labelOffsetY + dotsToPx(leaf.y, scale, dpmm),
            // Unmeasured right-anchored leaf: the commit holds x, so must live.
            frozenX: projX === null,
            scales: SHAPE_PRIMITIVE_TYPES.has(leaf.type),
            // lockAspect commits min(fx, fy); live must match or it snaps back.
            uniform:
              leaf.type === "ellipse" &&
              (leaf.props as { lockAspect?: boolean }).lockAspect === true,
            hide: hide ?? undefined,
          },
        ];
      });
      multiResizeRef.current = {
        proxy,
        bboxDots: multiResizeBboxDots,
        start: { x: proxy.x(), y: proxy.y() },
        nodes,
        ids: [...selectedIds],
      };
      return;
    }
    const singleId = selectedIds[0];
    if (!singleId || !stageRef.current) return;
    const node = stageRef.current.findOne<Konva.Node>(`#${singleId}`);
    if (!node) return;
    const obj = objects.find((o) => o.id === singleId);
    activeEdgesRef.current = activeEdgesFromAnchorName(
      transformerRef.current?.getActiveAnchor() ?? null,
    );
    transformAnchorRef.current = (() => {
      if (!obj) return null;
      if (STACKED_2D_TYPES.has(obj.type)) {
        // Group .height/.width return their attrs (0); without the rect
        // read the snap guards early-return on 0 and the drag drifts on
        // commit.
        const rect = naturalRect(node);
        return {
          kind: "row",
          nodeHeight: rect.height,
          rowHeight: (obj.props as { rowHeight: number }).rowHeight,
          nodeWidth: rect.width,
          moduleWidth: (obj.props as { moduleWidth: number }).moduleWidth,
          moduleWidthMin: getEntry(obj.type)?.moduleWidthMin ?? 1,
          rotation: objectRotation(obj.props),
        };
      }
      // Live moduleWidth snap for 1D barcodes, all rotations: quantise the
      // moduleWidth axis (screen width for N/I, screen height for R/B) so
      // overshoot is blocked and the anchored edge stays put, like N.
      if (BARCODE_1D_TYPES.has(obj.type)) {
        // Konva Group .width() returns its attr (0 here); the visible
        // bbox comes from the children via getClientRect.
        const rect = naturalRect(node);
        return {
          kind: "moduleWidth",
          nodeWidth: rect.width,
          nodeHeight: rect.height,
          moduleWidth: (obj.props as { moduleWidth: number }).moduleWidth,
          rotation: objectRotation(obj.props),
        };
      }
      return null;
    })();
    // startBbox is captured lazily on the first boundBoxFunc call; Konva
    // passes those bboxes in the transformer's frame, which on rotated
    // parents differs from getClientRect's stage frame.
    transformStartBboxRef.current = null;
    othersSnapshotRef.current = captureOtherRects(
      stageRef.current,
      objects,
      singleId,
    );
    // Live-reflow setup: a frame-mode ^FB block (any rotation) re-wraps during
    // the drag instead of scaling. Capture the fixed edges so the anchored
    // side stays put while blockWidth/blockLines change.
    liveReflowRef.current = null;
    if (obj && !isGroup(obj) && obj.type === "text") {
      const bp = obj.props as {
        blockWidth?: number;
        blockLines?: number;
        blockLineSpacing?: number;
        blockHeight?: number;
        fontHeight: number;
        fontId?: string;
        printerFontName?: string;
        rotation: string;
      };
      const deviceFontId = resolveDeviceFontId(
        bp.fontId,
        bp.printerFontName,
        useLabelStore.getState().label,
      );
      // Alt is sampled once at drag start to pick the mode for the whole
      // gesture; toggling it mid-drag intentionally does not switch frame/glyph.
      blockResizeModeRef.current = resolveBlockResizeMode(
        useLabelStore.getState().blockDragMode,
        altKeyRef.current,
      );
      const frameMode = blockResizeModeRef.current === "frame";
      // ^FB and ^TB both reflow live in frame mode (no glyph stretch); the only
      // difference is the second axis (^FB lines vs ^TB clip height).
      const tbMode = resolveTextMode(obj.props as TextProps) === "tb";
      if (bp.blockWidth && bp.blockWidth > 0 && frameMode) {
        const rot = (["N", "R", "I", "B"].includes(bp.rotation)
          ? bp.rotation
          : "N") as "N" | "R" | "I" | "B";
        const blockHeight = bp.blockHeight ?? bp.fontHeight;
        const b0 = tbMode
          ? tbBoundsDots(bp.blockWidth, blockHeight, rot)
          : blockBoundsDots({
              blockWidthDots: bp.blockWidth,
              blockLines: bp.blockLines ?? 1,
              blockLineSpacing: bp.blockLineSpacing ?? 0,
              fontHeight: bp.fontHeight,
              deviceFontId: deviceFontId,
              rotation: rot,
            });
        const x0 = node.x() + dotsToPx(b0.x, scale, dpmm);
        const y0 = node.y() + dotsToPx(b0.y, scale, dpmm);
        liveReflowRef.current = {
          mode: tbMode ? "tb" : "fb",
          edges: activeEdgesRef.current,
          rotation: rot,
          lineSpacing: bp.blockLineSpacing ?? 0,
          fontHeight: bp.fontHeight,
          fontId: deviceFontId,
          leftX: x0,
          topY: y0,
          rightX: x0 + dotsToPx(b0.width, scale, dpmm),
          bottomY: y0 + dotsToPx(b0.height, scale, dpmm),
          snapshot: {
            x: obj.x,
            y: obj.y,
            blockWidth: bp.blockWidth,
            blockLines: bp.blockLines ?? 1,
            blockHeight,
          },
          changed: false,
        };
        // Per-tick store writes during the drag would each land in the undo
        // history; pause recording and collapse to one entry on release.
        useLabelStore.temporal.getState().pause();
      } else if (!frameMode && (bp.blockWidth ?? 0) > 0 && viewRotation === 0) {
        // Glyph mode bakes on end: capture the start rect so commit can re-pin
        // the stable point after the font re-justifies.
        glyphBlockStartRectRef.current = stageRect(node, stageRef.current);
      }
    }
    // Free-resize shapes reflow live (see onTransform): pause undo so the
    // per-tick writes collapse into one entry on release.
    if (obj && !isGroup(obj) && SHAPE_REFLOW_TYPES.has(obj.type)) {
      const sp = obj.props as { width: number; height: number };
      shapeReflowRef.current = {
        snapshot: { x: obj.x, y: obj.y, width: sp.width, height: sp.height },
        changed: false,
        lastCentered: false,
      };
      useLabelStore.temporal.getState().pause();
    }
    // 1D live reflow, armed per grabbed axis. Needs the measured footprint for
    // the start box; an unmeasured barcode falls back to bake-on-end. View
    // rotation is safe: node coords, anchor-name edges and the model inversion
    // live in the unrotated parent frame, and the per-tick pin stands in for
    // boundBoxFunc's band snap, which bails under rotation.
    barcodeReflowRef.current = null;
    if (obj && !isGroup(obj) && BARCODE_1D_TYPES.has(obj.type)) {
      const edges = activeEdgesRef.current;
      const rot = objectRotation(obj.props);
      const swapped = isAxisSwapped(rot);
      const cache = getMeasuredSnapshot().get(singleId);
      const p = obj.props as { moduleWidth?: number; height?: number };
      if (edges && cache) {
        const leftX = node.x();
        const topY = node.y();
        const box = {
          leftX,
          topY,
          rightX: leftX + dotsToPx(cache.width, scale, dpmm),
          bottomY: topY + dotsToPx(cache.height, scale, dpmm),
        };
        const uprightH0 = cache.uprightBarHDots ?? p.height ?? 0;
        const mwAxisActive = swapped ? edges.top || edges.bottom : edges.left || edges.right;
        const heightAxisActive = swapped ? edges.left || edges.right : edges.top || edges.bottom;
        if (mwAxisActive && typeof p.moduleWidth === "number" && p.moduleWidth > 0) {
          barcodeReflowRef.current = {
            mode: "mw",
            rotation: rot,
            edges,
            ...box,
            mw0: p.moduleWidth,
            uprightW0: cache.uprightBarWDots ?? 0,
            uprightH0,
            // height rides along: normalizeChanges may re-clamp it as a side
            // effect of the per-tick moduleWidth writes (code49), and the undo
            // baseline must restore that too.
            snapshot: { x: obj.x, y: obj.y, moduleWidth: p.moduleWidth, height: p.height },
            extraWidths0: Object.fromEntries(
              (getEntry(obj.type)?.extraModuleWidthProps ?? []).flatMap((name) => {
                const v = (p as Record<string, unknown>)[name];
                return typeof v === "number" ? [[name, v]] : [];
              }),
            ),
            changed: false,
            lastCentered: altKeyRef.current,
          };
          useLabelStore.temporal.getState().pause();
        } else if (heightAxisActive && typeof p.height === "number" && p.height > 0 && uprightH0 > 0) {
          // The transformer frames the bars only, so per tick the bar height IS
          // the frame extent; the constant non-bar zone (HRI text, EAN guard
          // tails) is added back solely to pin the anchored bbox edge.
          const axisFootprintDots = swapped ? cache.width : cache.height;
          barcodeReflowRef.current = {
            mode: "height",
            rotation: rot,
            edges,
            ...box,
            zonePx: Math.max(0, dotsToPx(axisFootprintDots - uprightH0, scale, dpmm)),
            uprightW0: cache.uprightBarWDots ?? 0,
            snapshot: { x: obj.x, y: obj.y, height: p.height },
            changed: false,
            lastCentered: altKeyRef.current,
          };
          useLabelStore.temporal.getState().pause();
        }
      }
    }
    // Uniform 2D (QR/Aztec/DataMatrix): arm the reflow so the per-tick pin,
    // not boundBoxFunc, drives quantise and aspect (see the bail below).
    const uniformProp = obj && !isGroup(obj) ? getEntry(obj.type)?.uniformScaleProp : undefined;
    if (obj && uniformProp) {
      const edges = activeEdgesRef.current;
      const modules = (obj.props as unknown as Record<string, number>)[uniformProp.name];
      const box = parentRect(node);
      if (edges && typeof modules === "number" && modules > 0 && box.width > 0 && box.height > 0) {
        const cache = getMeasuredSnapshot().get(singleId);
        barcodeReflowRef.current = {
          mode: "uniform",
          edges,
          modules0: modules,
          min: uniformProp.min,
          max: uniformProp.max,
          leftX: box.x,
          topY: box.y,
          rightX: box.x + box.width,
          bottomY: box.y + box.height,
          propName: uniformProp.name,
          uprightW0: cache?.uprightBarWDots,
          uprightH0: cache?.uprightBarHDots,
          snapshot: { x: obj.x, y: obj.y, modules },
          changed: false,
          lastCentered: altKeyRef.current,
        };
        useLabelStore.temporal.getState().pause();
      }
    }
  };

  // Per-tick live reflow for a frame-mode ^FB block: convert the group scale
  // into blockWidth/blockLines, re-wrap via a synchronous store update, reset
  // the scale, re-pin the anchored edge, and re-baseline the handles. Keeps
  // glyphs constant and justify correct because the content actually re-renders.
  const onTransform = (e?: Konva.KonvaEventObject<Event>) => {
    // Track the drag's own Alt state, so a keydown missed before window focus
    // (or an Alt+Tab blur) can't desync us from Konva's e.altKey centering.
    if (e?.evt && "altKey" in e.evt) altKeyRef.current = (e.evt as MouseEvent).altKey;
    const mr = multiResizeRef.current;
    if (mr) {
      const fx = mr.proxy.scaleX();
      const fy = mr.proxy.scaleY();
      const px = mr.proxy.x();
      const py = mr.proxy.y();
      for (const n of mr.nodes) {
        if (n.scales) {
          // Scaling nodes hold the anchor in their scaled children (line roots
          // at 0, shape groups at the anchor): the position projects linearly.
          n.node.position({
            x: px + (n.startX - mr.start.x) * fx,
            y: py + (n.startY - mr.start.y) * fy,
          });
          const u = Math.min(fx, fy);
          n.node.scale(n.uniform ? { x: u, y: u } : { x: fx, y: fy });
        } else {
          // Anchor projects, the render offset rides along unscaled.
          n.node.position({
            x: n.frozenX ? n.startX : px + (n.anchorPxX - mr.start.x) * fx + (n.startX - n.anchorPxX),
            y: py + (n.anchorPxY - mr.start.y) * fy + (n.startY - n.anchorPxY),
          });
        }
      }
      return;
    }
    if (selectedIds.length !== 1 || !stageRef.current) return;
    const id = selectedIds[0];
    if (!id) return;
    const node = stageRef.current.findOne<Konva.Node>(`#${id}`);
    if (!node) return;
    const sx = node.scaleX();
    const sy = node.scaleY();
    if (Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3) return;
    const cur = findObjectById(getCurrentObjects(), id);
    if (!cur || isGroup(cur)) return;
    const lr = liveReflowRef.current;
    if (lr) {
      const cp = cur.props as { blockWidth?: number; blockLines?: number; blockHeight?: number };
      const common = {
        scaleX: sx,
        scaleY: sy,
        rotation: lr.rotation,
        blockWidthDots: cp.blockWidth ?? 1,
        activeLeft: lr.edges?.left ?? false,
        activeTop: lr.edges?.top ?? false,
        leftX: lr.leftX,
        topY: lr.topY,
        rightX: lr.rightX,
        bottomY: lr.bottomY,
        scale,
        dpmm,
        objectsOffsetX,
        labelOffsetY,
      };
      const geo =
        lr.mode === "tb"
          ? (() => {
              const g = tbReflowGeometry({ ...common, blockHeightDots: cp.blockHeight ?? lr.fontHeight });
              return { ...g, props: { blockWidth: g.blockWidthDots, blockHeight: g.blockHeightDots } };
            })()
          : (() => {
              const g = blockReflowGeometry({
                ...common,
                blockLines: cp.blockLines ?? 1,
                blockLineSpacing: lr.lineSpacing,
                fontHeight: lr.fontHeight,
                deviceFontId: lr.fontId,
              });
              return { ...g, props: { blockWidth: g.blockWidthDots, blockLines: g.blockLines } };
            })();
      flushSync(() => {
        updateObject(id, {
          x: geo.modelXDots,
          y: geo.modelYDots,
          props: geo.props,
        });
      });
      lr.changed = true;
      node.scaleX(1);
      node.scaleY(1);
      node.x(geo.targetXPx);
      node.y(geo.targetYPx);
      transformerRef.current?.forceUpdate();
      return;
    }

    // 1D barcode reflow: bake the next size step the moment the frame crosses
    // it, so bars, HRI and text zone re-render at their true size instead of
    // stretching. The moduleWidth axis quantises from the TOTAL drag extent
    // (same inputs as the box snap) because rendered pixel widths are stepwise
    // in moduleWidth; an incremental-scale quantiser would oscillate wherever
    // adjacent module widths render at the same pixel width.
    const br = barcodeReflowRef.current;
    if (br) {
      const natural = naturalRect(node);
      // Alt is read live (Konva's own preview mirrors on e.altKey live too), so
      // holding or releasing it mid-drag flips centered resize like the preview.
      const centered = altKeyRef.current;
      // A mid-band Alt flip moves the pin by half the accumulated delta; write
      // the store on the flip too, else release commits the crossing-time position.
      const modeFlip = br.changed && centered !== br.lastCentered;
      // The FT anchor and QR firmware shift both scale with magnification, so the
      // same inversion as the 1D modes keeps them consistent with the render.
      if (br.mode === "uniform") {
        const geo = uniformReflowGeometry(br, natural.width * sx, natural.height * sy, centered);
        if (!geo) return;
        const modCurrent = (cur.props as unknown as Record<string, number>)[br.propName];
        if (typeof modCurrent !== "number" || !(modCurrent > 0)) return;
        const crossed = geo.modules !== modCurrent;
        if (crossed || modeFlip) {
          const ratio = geo.modules / br.modules0;
          const model = modelPositionFromRenderedTopLeft(
            cur,
            pxToDots(geo.targetXPx - objectsOffsetX, scale, dpmm),
            pxToDots(geo.targetYPx - labelOffsetY, scale, dpmm),
            br.uprightW0 !== undefined ? br.uprightW0 * ratio : undefined,
            br.uprightH0 !== undefined ? br.uprightH0 * ratio : undefined,
            geo.modules,
          );
          flushSync(() => {
            updateObject(id, {
              x: model.x,
              y: model.y,
              props: { [br.propName]: geo.modules },
            });
          });
          br.changed = true;
          br.lastCentered = centered;
        }
        // Pin every tick; subtract the child render offset (QR draws off the
        // group origin) so the rendered top-left lands on the target.
        const rendered = crossed ? naturalRect(node) : natural;
        const rx = rendered.width > 0 ? geo.linearW / rendered.width : 1;
        const ry = rendered.height > 0 ? geo.linearH / rendered.height : 1;
        node.scaleX(rx);
        node.scaleY(ry);
        node.x(geo.targetXPx - rendered.x * rx);
        node.y(geo.targetYPx - rendered.y * ry);
        transformerRef.current?.forceUpdate();
        return;
      }
      const swapped = isAxisSwapped(br.rotation);
      if (br.mode === "mw") {
        const mwCurrent = (cur.props as { moduleWidth?: number }).moduleWidth;
        if (typeof mwCurrent !== "number" || !(mwCurrent > 0)) return;
        const frameExtentPx = swapped ? natural.height * sy : natural.width * sx;
        const geo = barcodeMwReflowGeometry(br, frameExtentPx, centered);
        if (!geo) return;
        const crossed = geo.moduleWidth !== mwCurrent;
        if (crossed || modeFlip) {
          const ratio = geo.moduleWidth / br.mw0;
          // Same inversion as the end commit for the ACTIVE axis; the anchored
          // axis keeps its pre-drag model value (mirrors the end commit's
          // snapAxis), else the bar-zone offset (above-HRI, rotated EAN) that
          // the FO inversion ignores would corrupt the stored anchor coordinate.
          const model = modelPositionFromRenderedTopLeft(
            cur,
            pxToDots(geo.targetXPx - objectsOffsetX, scale, dpmm),
            pxToDots(geo.targetYPx - labelOffsetY, scale, dpmm),
            br.uprightW0 * ratio,
            br.uprightH0,
          );
          // TLC39's second module width follows the same ratio so the
          // composite keeps its proportions mid-drag.
          const extraWidths: Record<string, number> = {};
          for (const [name, v0] of Object.entries(br.extraWidths0 ?? {})) {
            extraWidths[name] = Math.min(10, Math.max(1, Math.round(v0 * ratio)));
          }
          flushSync(() => {
            updateObject(id, {
              x: swapped ? br.snapshot.x : model.x,
              y: swapped ? model.y : br.snapshot.y,
              props: { moduleWidth: geo.moduleWidth, ...extraWidths },
            });
          });
          br.changed = true;
          br.lastCentered = centered;
        }
        // Pin every tick, not just on crossings: the reflow is the sole band
        // pin, so the raster holds in rotated views where boundBoxFunc bails.
        // The residual fits the re-rendered content into the linear frame (1
        // when pixels-per-module are exact). Only a crossing re-renders, so
        // mid-band `natural` is still the current rect.
        const rendered = crossed ? naturalRect(node) : natural;
        const renderedExtent = swapped ? rendered.height : rendered.width;
        const residual = renderedExtent > 0 ? geo.linearExtentPx / renderedExtent : 1;
        node.scaleX(swapped ? 1 : residual);
        node.scaleY(swapped ? residual : 1);
        node.x(geo.targetXPx);
        node.y(geo.targetYPx);
        transformerRef.current?.forceUpdate();
        return;
      }
      // Height axis, baked per integer dot. Route each tick through the registry
      // commit at identity scale (= clamp only) so per-type ranges hold mid-drag:
      // code49 must clamp into bwip's module window or the whole render errors.
      // The height re-render lands on the frame exactly, so the pin needs no
      // residual; the scale just resets to 1.
      const frameExtentPx = swapped ? natural.width * sx : natural.height * sy;
      const geo = barcodeHeightReflowGeometry(br, frameExtentPx, centered);
      if (!geo) return;
      const newHeightDots = pxToDots(geo.barExtentPx, scale, dpmm);
      const hCurrent = (cur.props as { height?: number }).height;
      if (!(newHeightDots >= 1)) return;
      const commitFn = getEntry(cur.type)?.commitTransform;
      const candidate = { ...cur, props: { ...cur.props, height: newHeightDots } } as typeof cur;
      const committed = commitFn?.(candidate, {
        sx: 1,
        sy: 1,
        snap: (n: number) => n,
        nodeHeight: 0,
        anchor: null,
        resizeMode: blockResizeModeRef.current,
      }) as { height?: number } | undefined;
      const hNext = committed?.height ?? newHeightDots;
      const pin = barcodeHeightReflowGeometry(br, dotsToPx(hNext, scale, dpmm), centered);
      if (!pin) return;
      if (hNext !== hCurrent || modeFlip) {
        const model = modelPositionFromRenderedTopLeft(
          cur,
          pxToDots(pin.targetXPx - objectsOffsetX, scale, dpmm),
          pxToDots(pin.targetYPx - labelOffsetY, scale, dpmm),
          br.uprightW0,
          hNext,
        );
        flushSync(() => {
          updateObject(id, {
            x: swapped ? model.x : br.snapshot.x,
            y: swapped ? br.snapshot.y : model.y,
            props: { height: hNext },
          });
        });
        br.changed = true;
        br.lastCentered = centered;
      }
      // Pin every tick for the same reason as the mw axis: hold the node in
      // rotated views between dot bakes, else the anchored edge jitters.
      node.scaleX(1);
      node.scaleY(1);
      node.x(pin.targetXPx);
      node.y(pin.targetYPx);
      transformerRef.current?.forceUpdate();
      return;
    }

    // Box/ellipse: bake the group scale into width/height each tick. Rounding
    // into the store is drift-free because forceUpdate re-baselines to it each
    // tick, so the store dim times the live scale stays the true current size.
    const sr = shapeReflowRef.current;
    if (sr) {
      const sp = cur.props as { width: number; height: number; lockAspect?: boolean };
      // boundBoxFunc is skipped during reflow, so a locked circle enforces its
      // own uniform scale here, matching the ellipse commit's min-axis collapse.
      const [scaleW, scaleH] = sp.lockAspect
        ? [Math.min(sx, sy), Math.min(sx, sy)]
        : [sx, sy];
      const width = Math.max(1, Math.round(sp.width * scaleW));
      const height = Math.max(1, Math.round(sp.height * scaleH));
      // Pin the anchored edge from the snapshot (mirrors the end commit):
      // rebuilding it from a rounded node.x/y plus a float dim oscillated it.
      // Alt mirrors the box around its start centre instead.
      const centered = altKeyRef.current;
      const edges = activeEdgesRef.current;
      const x = Math.round(
        pinnedMin(!!edges?.left, sr.snapshot.x, sr.snapshot.x + sr.snapshot.width, width, centered),
      );
      const y = Math.round(
        pinnedMin(!!edges?.top, sr.snapshot.y, sr.snapshot.y + sr.snapshot.height, height, centered),
      );
      flushSync(() => {
        updateObject(id, { x, y, props: { width, height } });
      });
      sr.changed = true;
      sr.lastCentered = centered;
      node.scaleX(1);
      node.scaleY(1);
      node.x(objectsOffsetX + dotsToPx(x, scale, dpmm));
      node.y(labelOffsetY + dotsToPx(y, scale, dpmm));
      transformerRef.current?.forceUpdate();
    }
  };

  const boundBoxFunc = (
    oldBox: BoundingBox,
    newBox: BoundingBox,
  ): BoundingBox => {
    // No axis pin / band snap; only the shrink floor, so a union already
    // thinner than the floor stays resizable on the other axis.
    if (multiResizeRef.current) {
      return shrinkingBelowFloor(oldBox, newBox, MIN_RESIZE_BOX_PX) ? oldBox : newBox;
    }
    if (shrinkingBelowFloor(oldBox, newBox, MIN_RESIZE_BOX_PX)) return oldBox;
    // Capture the TRUE drag-start box on tick 0, before any bail: a bail path
    // (Alt) that later hands back to the snap path (Alt released mid-drag) must
    // re-baseline from the real start, not a box already grown under the bail.
    if (!transformStartBboxRef.current) {
      transformStartBboxRef.current = {
        id: selectedIds[0] ?? "",
        x: oldBox.x,
        y: oldBox.y,
        width: oldBox.width,
        height: oldBox.height,
      };
    }
    // The text-block reflow re-pins from its own captured edges, so the snap /
    // inactive-edge pin below would fight it; skip entirely.
    if (liveReflowRef.current) return newBox;
    // boundBoxFunc yields to the per-tick reflow pin as sole authority: always
    // for uniform-2D (moved-edge aspect is frame-wrong under view rotation),
    // and for any barcode reflow under Alt (both edges move, snap fights mirror).
    const br = barcodeReflowRef.current;
    if (br && (br.mode === "uniform" || altKeyRef.current)) return newBox;
    // Locked-circle reflow needs forceAspectBox so Konva keeps sx==sy; node and
    // reflow only agree when the bbox keeps its aspect. Snap/pin below is free-axis only.
    if (shapeReflowRef.current && isUniformScale) {
      return forceAspectBox(oldBox, newBox);
    }
    // A free box/ellipse under Alt: onTransform's centered pin is the authority,
    // so skip the edge-anchored snap/pin below that would fight the mirror.
    if (shapeReflowRef.current && altKeyRef.current) return newBox;
    // Free-resize shapes fall through: object-snap + inactive-edge pin still
    // apply (reflow pins from the same node position), keeping edge snapping.
    if (isUniformScale) newBox = forceAspectBox(oldBox, newBox);
    // When the canvas view is rotated, Konva's bbox semantics in this
    // callback no longer match an axis-aware snap / pin model; visual
    // bottom-edge becomes node-local-left etc. Skip the height snap,
    // object-snap and inactive-edge pin in that case and let Konva
    // resize natively. Stacked-2D row quantisation only matters when
    // not rotated anyway.
    //
    // Latent coord-frame mismatch: at viewRotation=0 the transformer-frame
    // bboxes (oldBox/newBox here, and the startBbox captured above) coincide
    // with stage coords, which is the same frame othersSnapshotRef and
    // labelRect use. Removing this early-return without first lifting the
    // others / labelRect snapshot into the transformer frame would re-introduce
    // the rotated-resize drift this whole block guards against.
    if (viewRotation !== 0) return newBox;
    const dotPx = scale / dpmm;
    const startBbox = transformStartBboxRef.current;
    let bbox = applyHeightSnap(
      oldBox,
      newBox,
      dotPx,
      transformAnchorRef.current,
    );
    bbox = applyModuleWidthSnap(oldBox, bbox, transformAnchorRef.current);
    // Quantised types skip object-snap: a sub-module neighbour-pixel
    // alignment breaks the integer-module commit and the post-render
    // bitmap drifts off the anchor.
    const hasQuantisedAnchor = transformAnchorRef.current !== null;
    if (objectSnapEnabled && isFreeResize && startBbox && !hasQuantisedAnchor) {
      if (snapBypassRef.current) {
        // Ctrl/Cmd held: resize freely; drop guides left by earlier ticks.
        setGuides([]);
      } else {
        const snapped = applyResizeObjectSnap(
          bbox,
          startBbox,
          othersSnapshotRef.current,
          labelRect,
        );
        setGuides(snapped.guides);
        bbox = snapped.bbox;
      }
    }
    if (startBbox) {
      const startBox: BoundingBox = {
        x: startBbox.x,
        y: startBbox.y,
        width: startBbox.width,
        height: startBbox.height,
        rotation: 0,
      };
      const activeEdges = deriveActiveEdges(startBbox, {
        id: startBbox.id,
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
      });
      bbox = pinInactiveEdges(bbox, startBox, activeEdges);
    }
    return bbox;
  };

  const onTransformEnd = () => {
    // Each live-reflow branch derives its (restore, final) prop delta and hands
    // it to collapseReflowToOneEntry, which folds the paused per-tick writes into
    // one undo entry (or resets the residual scale and bails when nothing baked).
    const lr = liveReflowRef.current;
    if (lr) {
      const id = selectedIds[0];
      const cur = id ? findObjectById(getCurrentObjects(), id) : undefined;
      let commit: ReflowCommit = null;
      if (lr.changed && id && cur && !isGroup(cur)) {
        const cp = cur.props as { blockWidth?: number; blockLines?: number; blockHeight?: number };
        // ^TB collapses width + clip height; ^FB width + line count.
        const secondAxis = lr.mode === "tb" ? { blockHeight: cp.blockHeight } : { blockLines: cp.blockLines };
        const snapAxis = lr.mode === "tb" ? { blockHeight: lr.snapshot.blockHeight } : { blockLines: lr.snapshot.blockLines };
        commit = {
          restore: { x: lr.snapshot.x, y: lr.snapshot.y, props: { blockWidth: lr.snapshot.blockWidth, ...snapAxis } },
          final: { x: cur.x, y: cur.y, props: { blockWidth: cp.blockWidth, ...secondAxis } },
        };
      }
      collapseReflowToOneEntry(id, commit);
      return;
    }
    const br = barcodeReflowRef.current;
    if (br && br.mode === "uniform") {
      const id = selectedIds[0];
      const cur = id ? findObjectById(getCurrentObjects(), id) : undefined;
      let commit: ReflowCommit = null;
      if (br.changed && id && cur && !isGroup(cur)) {
        // Per-tick writes already went through computeNewModules, so the final
        // value is clamped; re-commit it as the single tracked change.
        const modules = (cur.props as unknown as Record<string, number>)[br.propName];
        commit = {
          restore: { x: br.snapshot.x, y: br.snapshot.y, props: { [br.propName]: br.snapshot.modules } },
          final: { x: cur.x, y: cur.y, props: { [br.propName]: modules } },
        };
      }
      collapseReflowToOneEntry(id, commit);
      return;
    }
    if (br) {
      const id = selectedIds[0];
      const cur = id ? findObjectById(getCurrentObjects(), id) : undefined;
      let commit: ReflowCommit = null;
      if (br.changed && id && cur && !isGroup(cur)) {
        const cp = cur.props as { moduleWidth?: number; height?: number };
        // Final goes through the registry commit at identity scale (= re-commit
        // the baked props) so per-type contracts hold: grid snap for height,
        // the ^BY clamp, code49's bwip range clamp. The fallback mirrors the
        // generic formula for entries without a commitTransform.
        const commitFn = getEntry(cur.type)?.commitTransform;
        const finalProps = commitFn
          ? commitFn(cur, {
              sx: 1,
              sy: 1,
              snap,
              nodeHeight: 0,
              anchor: null,
              resizeMode: blockResizeModeRef.current,
            })
          : br.mode === "mw"
            ? { moduleWidth: cp.moduleWidth }
            : { height: Math.max(1, snap(Math.round(cp.height ?? 1))) };
        commit = {
          restore: {
            x: br.snapshot.x,
            y: br.snapshot.y,
            props:
              br.mode === "mw"
                ? {
                    moduleWidth: br.snapshot.moduleWidth,
                    // The undo baseline must restore the ratio-scaled extra
                    // widths too, or Ctrl+Z leaves w2 on the post-drag value.
                    ...br.extraWidths0,
                    ...(typeof br.snapshot.height === "number" && { height: br.snapshot.height }),
                  }
                : { height: br.snapshot.height },
          },
          final: { x: cur.x, y: cur.y, props: finalProps },
        };
      }
      collapseReflowToOneEntry(id, commit);
      return;
    }
    const sr = shapeReflowRef.current;
    if (sr) {
      const id = selectedIds[0];
      const cur = id ? findObjectById(getCurrentObjects(), id) : undefined;
      let commit: ReflowCommit = null;
      if (sr.changed && id && cur && !isGroup(cur)) {
        const sp = cur.props as { width: number; height: number };
        // Apply the grid snap the per-tick bake skips (round only); the anchored
        // edge is then re-pinned from the snapped size so it can't walk.
        const width = Math.max(1, snap(Math.round(sp.width)));
        const height = Math.max(1, snap(Math.round(sp.height)));
        const edges = activeEdgesRef.current;
        // The last live pin's Alt state (not the current ref): a keyup fires no
        // transform tick, so committing on the live value avoids a snap on release.
        const centered = sr.lastCentered;
        commit = {
          restore: { x: sr.snapshot.x, y: sr.snapshot.y, props: { width: sr.snapshot.width, height: sr.snapshot.height } },
          final: {
            x: Math.round(
              pinnedMin(!!edges?.left, sr.snapshot.x, sr.snapshot.x + sr.snapshot.width, width, centered),
            ),
            y: Math.round(
              pinnedMin(!!edges?.top, sr.snapshot.y, sr.snapshot.y + sr.snapshot.height, height, centered),
            ),
            props: { width, height },
          },
        };
      }
      collapseReflowToOneEntry(id, commit);
      return;
    }
    const mr = multiResizeRef.current;
    if (mr) {
      const fx = mr.proxy.scaleX();
      const fy = mr.proxy.scaleY();
      // Left/top anchors move the proxy origin (the opposite edge is pinned);
      // capture it before the reset so the commit keeps that translation.
      const endX = mr.proxy.x();
      const endY = mr.proxy.y();
      // Restore pre-gesture transforms; the commit re-render applies the new
      // model. Line bodies have no x/y props, react-konva keeps live offsets.
      for (const n of mr.nodes) {
        n.node.position({ x: n.startX, y: n.startY });
        if (n.scales) n.node.scale({ x: 1, y: 1 });
        n.hide?.visible(true);
      }
      let committed = false;
      if (fx !== 1 || fy !== 1) {
        // Visible leaves only, matching the drag gesture (which skips hidden
        // members); `objects` also carries the cascaded lock.
        const leafById = new Map(objects.map((o) => [o.id, o]));
        const leafs = mr.ids.flatMap((id) => {
          const l = leafById.get(id);
          return l ? [l] : [];
        });
        const origin = {
          x: mr.bboxDots.x + pxToDots(endX - mr.start.x, scale, dpmm),
          y: mr.bboxDots.y + pxToDots(endY - mr.start.y, scale, dpmm),
        };
        // Drop no-op entries so a sub-dot jiggle records no undo step.
        const measured = getMeasuredSnapshot();
        const changes = projectMultiResize(
          leafs,
          mr.bboxDots,
          origin,
          fx,
          fy,
          snap,
          (id) => measured.get(id)?.width,
        ).filter(
          (c) => {
            const l = leafById.get(c.id);
            if (!l) return false;
            if (c.x !== l.x || c.y !== l.y) return true;
            const lp = l.props as unknown as Record<string, number>;
            return !!c.props && Object.entries(c.props).some(([k, v]) => lp[k] !== v);
          },
        );
        if (changes.length > 0) {
          committed = true;
          updateObjects(
            changes.map((c) => ({
              id: c.id,
              changes: { x: c.x, y: c.y, ...(c.props ? { props: c.props } : {}) },
            })),
          );
        }
      }
      // Committed: park on the end geometry (no flash before the sync effect
      // re-measures). No commit: restore the start, nothing will re-sync.
      if (committed) {
        mr.proxy.setAttrs({
          scaleX: 1,
          scaleY: 1,
          width: mr.proxy.width() * fx,
          height: mr.proxy.height() * fy,
        });
      } else {
        mr.proxy.setAttrs({
          scaleX: 1,
          scaleY: 1,
          x: mr.start.x,
          y: mr.start.y,
        });
      }
      // A mid-gesture delete destroyed the proxy; do not hold ghost anchors.
      if (!mr.proxy.getStage()) transformerRef.current?.nodes([]);
      transformerRef.current?.forceUpdate();
      cleanupTransformState();
      return;
    }
    if (selectedIds.length !== 1 || !selectedIds[0] || !stageRef.current) {
      cleanupTransformState();
      return;
    }
    const singleId = selectedIds[0];
    const node = stageRef.current.findOne<Konva.Node>(`#${singleId}`);
    if (!node) {
      cleanupTransformState();
      return;
    }
    const sx = node.scaleX();
    const sy = node.scaleY();
    const nodeHeight = node.height();
    node.scaleX(1);
    node.scaleY(1);
    const obj = findObjectById(getCurrentObjects(), singleId);
    if (!obj || isGroup(obj)) {
      cleanupTransformState();
      return;
    }
    const renderedXDots = pxToDots(node.x() - objectsOffsetX, scale, dpmm);
    const renderedYDots = pxToDots(node.y() - labelOffsetY, scale, dpmm);
    // FT anchor inverse from the continuous drag scale, not the snapped commit
    // props (rounding fed back makes rotated barcodes jump); see committedUprightBarDots.
    const ftEntry = getEntry(obj.type);
    let committedW: number | undefined;
    let committedH: number | undefined;
    if (obj.positionType === "FT" && isBarcode(obj) && !ftEntry?.uniformScaleProp) {
      const cache = getMeasuredSnapshot().get(singleId);
      const fallbackH = (obj.props as { height?: number }).height ?? 0;
      const dims = committedUprightBarDots(
        objectRotation(obj.props),
        sx,
        sy,
        cache?.uprightBarWDots ?? 0,
        cache?.uprightBarHDots ?? fallbackH,
      );
      committedW = dims.w;
      committedH = dims.h;
    } else if (!(obj.positionType === "FT" && isBarcode(obj)) && isRightAnchoredField(obj)) {
      // Right-anchored fields: the inverse adds back the committed width, since the Group node's width()/height() are always 0.
      const m = getMeasuredSnapshot().get(singleId);
      if (m && m.width > 0) {
        const up = rotatedFootprint(m.width * sx, m.height * sy, objectRotation(obj.props));
        committedW = up.width;
        committedH = up.height;
      } else if (obj.type === "symbol") {
        const sp = obj.props as { width: number; height: number };
        committedW = sp.width * sx;
        committedH = sp.height * sy;
      }
    }
    // Invert per-type render offsets (QR's +10 Y, the rotation-aware FT bar
    // anchor) so the stored model matches the render path. Text renders at
    // obj.x/y directly.
    const modelPos = modelPositionFromRenderedTopLeft(
      obj,
      renderedXDots,
      renderedYDots,
      committedW,
      committedH,
    );
    // Grid-snap an axis only when the user grabbed an edge on it; an
    // inactive-axis snap walks the anchored opposite corner. Without
    // anchor info, fall back to bbox-diff via positionDidMove.
    const oldRendered = renderedTopLeftFromModel(obj);
    const edges = activeEdgesRef.current;
    const snapAxis = (axis: "x" | "y") => {
      const rendered = axis === "x" ? renderedXDots : renderedYDots;
      const old = axis === "x" ? oldRendered.x : oldRendered.y;
      const model = axis === "x" ? modelPos.x : modelPos.y;
      const objVal = axis === "x" ? obj.x : obj.y;
      if (edges) {
        const axisMoved =
          axis === "x" ? edges.left || edges.right : edges.top || edges.bottom;
        return axisMoved ? model : objVal;
      }
      return positionDidMove(rendered, old) ? snap(model) : objVal;
    };
    const pos = { x: snapAxis("x"), y: snapAxis("y") };
    const entry = getEntry(obj.type);
    const commit = entry?.commitTransform;
    if (commit) {
      const propChanges = commit(obj, {
        sx,
        sy,
        snap,
        nodeHeight,
        anchor: transformAnchorRef.current,
        resizeMode: blockResizeModeRef.current,
      });
      const start = glyphBlockStartRectRef.current;
      if (
        obj.type === "text" &&
        ((obj.props as { blockWidth?: number }).blockWidth ?? 0) > 0 &&
        blockResizeModeRef.current === "glyph" &&
        start
      ) {
        // Bake the font, re-measure the ink, and pin the stable point (via
        // blockGlyphAnchorPoint) so a justified block doesn't drift on release.
        const fp = obj.props as {
          fontWidth: number;
          fontHeight: number;
          rotation: ZplRotation;
          blockJustify?: BlockJustify;
        };
        const temporal = useLabelStore.temporal.getState();
        // try/finally so a throw from flushSync/getClientRect can't leave undo
        // recording globally paused (resume is idempotent).
        temporal.pause();
        try {
          // Konva left the node at the drag position; the font-only commit does
          // not change x/y so react-konva won't reset it. Move it back to the
          // model origin so the re-measure reflects the block at obj.x/y.
          node.x(objectsOffsetX + dotsToPx(obj.x, scale, dpmm));
          node.y(labelOffsetY + dotsToPx(obj.y, scale, dpmm));
          flushSync(() => updateObject(singleId, { props: propChanges }));
          const newRect = stageRect(node, stageRef.current);
          const edges = activeEdgesRef.current;
          const justify = fp.blockJustify ?? "L";
          const anchorArgs = { rotation: fp.rotation, justify, edges, centeredStacking: centeredScaling };
          const startA = blockGlyphAnchorPoint({ rect: start, ...anchorArgs });
          const newA = blockGlyphAnchorPoint({ rect: newRect, ...anchorArgs });
          const model = modelPositionFromRenderedTopLeft(
            obj,
            pxToDots(node.x() + (startA.x - newA.x) - objectsOffsetX, scale, dpmm),
            pxToDots(node.y() + (startA.y - newA.y) - labelOffsetY, scale, dpmm),
          );
          // Restore pre-drag state while paused, resume, then apply the final as
          // one tracked change so undo records pre-drag -> final once.
          updateObject(singleId, {
            x: obj.x,
            y: obj.y,
            props: { fontWidth: fp.fontWidth, fontHeight: fp.fontHeight },
          });
          temporal.resume();
          updateObject(singleId, { x: model.x, y: model.y, props: propChanges });
        } finally {
          temporal.resume();
          cleanupTransformState();
        }
        return;
      }
      updateObject(singleId, { ...pos, props: propChanges });
    }
    cleanupTransformState();
  };

  return {
    rotateEnabled: false,
    resizeEnabled,
    enabledAnchors,
    centeredScaling,
    centeredResizeArmed,
    onTransformStart,
    onTransform,
    boundBoxFunc,
    onTransformEnd,
  };
}
