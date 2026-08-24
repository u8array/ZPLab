import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  useCallback,
} from "react";
import { useDroppable, useDndMonitor } from "@dnd-kit/core";
import { CANVAS_DROPPABLE_ID } from "../../dnd/types";
import { paletteGhostHandlers } from "./paletteGhostMonitor";
import { Stage, Layer, Group, Image as KImage, Rect, Transformer } from "react-konva";
import type Konva from "konva";
import { useLabelStore, currentObjects, currentPageLabel, getCurrentObjects, selectEditorFrozen, selectPreviewLocksEditor, selectRenderPageLabel, selectRenderObjects, selectRenderColumnMapping } from "../../store/labelStore";
import { useSourceShadowSync } from "../../hooks/useSourceEditShadow";
import { isGroup, getAllLeaves, exportableLeaves, expandSelection, selectionTargetId, findObjectById, canDeleteSelection, canGroupSelection, canUngroupSelection, hasLockedAncestor, isSelectionLocked, type LabelObject } from "@zplab/core/types/Group";
import { pxToDots, dotsToPx, mmToDots, SCREEN_PX_PER_MM } from "@zplab/core/lib/coordinates";
import { effectiveDpmm } from "@zplab/core/types/LabelConfig";
import { loadImage } from "@zplab/core/lib/loadImage";
import { SNAP_OPTIONS } from "@zplab/core/lib/units";
import type { Unit } from "@zplab/core/lib/units";
import { Select } from "../ui/Select";
import type { SnapGuide } from "../../lib/snapGuides";
import { computeAlignDeltas, computeDistribute, computeTidy } from "../../lib/align";
import type { AlignOp, AlignBox, DistributeAxis, AlignRef } from "../../lib/align";
import { objectBoundsDots, selectionUnionDots, printableRectDots, isBarcode } from "@zplab/core/lib/objectBounds";
import { computePreflight, markerValueFindings, suppressPristineEmpty } from "@zplab/core/lib/preflight";
import { barcodeEncodeFindings } from "./barcodePreflight";
import { usePreviewBinding } from "../../store/usePreviewBinding";
import { useContextMenu } from "../../hooks/useContextMenu";
import { rotateSelectionChanges } from "../../lib/groupRotation";
import { registerBarcodeWidthProber, unregisterBarcodeWidthProber } from "../../store/anchorRepin";
import { resolveForMeasure } from "@zplab/core/lib/barcodeDims";
import { measureBarcodeFootprintDots } from "./bwipHelpers";
import { copyText } from "../../lib/clipboard";
import { selectTidyTargets } from "../../lib/tidyClassify";
import { safeAreaRectDots } from "../../lib/safeArea";
import { measuredBoundsMap, subscribeMeasuredBounds, getMeasuredSnapshot } from "../../lib/measuredBoundsCache";
import { isEditableTarget } from "../../lib/dom";
import { KonvaObject } from "./KonvaObject";
import { PreflightOverlay } from "./PreflightOverlay";
import { CAPTURE_CHROME } from "./konvaObjectProps";
import { RfidPositionGuide } from "./RfidPositionGuide";
import { Grid } from "./Grid";
import { GuideLines } from "./GuideLines";
import { Ruler, RULER_SIZE } from "./Ruler";
import { SHAPE_PRIMITIVE_TYPES } from "@zplab/core/registry";
import type { LeafObject } from "@zplab/core/registry";
import { isImageRotatable, type ImageProps } from "@zplab/core/registry/image";
import { convertPositionType } from "../../lib/positionConvert";
import { addableGroupsFor, symbologyGroupsFor } from "../Palette/paletteGroups";
import { symbologyTargets, convertSymbologyMapper } from "../../lib/symbologySwitch";
import type { LeafType } from "@zplab/core/registry";
import { resolveAddable, type AddableEntry } from "../../registry/palettePresets";
import { useColorScheme } from "../../hooks/useColorScheme";
import { useT } from "../../hooks/useT";
import { useCanvasPanZoom } from "./hooks/useCanvasPanZoom";
import { useCanvasLasso } from "./hooks/useCanvasLasso";
import { useKonvaTransformer, MULTI_RESIZE_PROXY_ID } from "./hooks/useKonvaTransformer";
import { useKonvaDragController } from "./hooks/useKonvaDragController";
import { useSnapBypassRef } from "./hooks/useSnapBypassRef";
import { PaginationControl } from "./PaginationControl";
import { Tooltip } from "../ui/Tooltip";
import {
  axisReversal,
  inverseRotateDelta,
  isAxisSwapped,
  nextRotation,
  type ViewRotation,
} from "./rotationGeometry";
import { useAltClickCycle } from "./hooks/useAltClickCycle";
import { useSelectionActionBar, actionBarPosition, type BarBounds } from "./hooks/useSelectionActionBar";
import { FloatingCanvasButton, RADIUS as BUTTON_RADIUS, type ButtonTone } from "./FloatingCanvasButton";
import { ROTATE_ICON, TRASH_ICON, LOCK_ICON, UNLOCK_ICON, GROUP_ICON, UNGROUP_ICON, LINE_ICON, BOX_ICON } from "./canvasIcons";
import { isShapeToggleable, canToggleShapeMode, oppositeShapeMode, toggleShapeMode } from "../../lib/lineBoxConvert";
import {
  getStepRotation,
  nextZplRotation,
  objectRotation,
} from "@zplab/core/registry/rotation";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { buildContextMenu, type MenuSection } from "./canvasActions";
import { zplForSelection } from "../../lib/zplForSelection";
import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { nodeToPngBlob, downloadBlob, copyPngToClipboard } from "../../lib/canvasImage";
import { printerPreviewLayout } from "../../lib/printerPreview";

/** Object types offered by the context menu's "Add object here". */
// Curated quick-add subset for the context menu, not every registry type; the
// full catalogue lives in the palette.

const PADDING = 40;
// Horizontal stride between action-bar buttons (render-side row layout).
const BUTTON_STEP_PX = 32;

// Amber stripe tile for the mismatch hatch. Never throws and isn't cached on
// failure, so a broken tile drops the hatch rather than blocking the preview.
let hatchTilePromise: Promise<HTMLImageElement> | null = null;
function loadHatchTile(): Promise<HTMLImageElement> {
  if (hatchTilePromise) return hatchTilePromise;
  try {
    const tile = document.createElement("canvas");
    tile.width = 8;
    tile.height = 8;
    const ctx = tile.getContext("2d");
    if (!ctx) return Promise.reject(new Error("no 2d context"));
    ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
    ctx.lineWidth = 1.5;
    // Offset copies either side so the diagonal tiles seamlessly.
    for (const off of [-8, 0, 8]) {
      ctx.beginPath();
      ctx.moveTo(off, 8);
      ctx.lineTo(off + 8, 0);
      ctx.stroke();
    }
    hatchTilePromise = loadImage(tile.toDataURL()).catch((e: unknown) => {
      hatchTilePromise = null;
      throw e;
    });
    return hatchTilePromise;
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error("hatch tile failed"));
  }
}

interface RectPx { x: number; y: number; width: number; height: number }
/** Union of two optional rects (px); null only when both are null. */
function unionPx(a: RectPx | null, b: RectPx | null): RectPx | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

interface Props {
  unit: Unit;
  showGrid: boolean;
  onGridToggle: () => void;
  snapEnabled: boolean;
  onSnapToggle: () => void;
  smartSnapEnabled: boolean;
  snapSizeMm: number;
  onSnapSizeChange: (mm: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  viewRotation: ViewRotation;
  onViewRotationChange: (rotation: ViewRotation) => void;
}

export interface LabelCanvasHandle {
  alignSelection: (op: AlignOp, ref: AlignRef) => void;
  distributeSelection: (axis: DistributeAxis) => void;
  tidySelection: () => void;
  convertObjectPositionType: (id: string, target: "FO" | "FT") => void;
}

export const LabelCanvas = forwardRef<LabelCanvasHandle, Props>(function LabelCanvas({
  unit,
  showGrid,
  onGridToggle,
  snapEnabled,
  onSnapToggle,
  smartSnapEnabled,
  snapSizeMm,
  onSnapSizeChange,
  zoom,
  onZoomChange,
  viewRotation,
  onViewRotationChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  // Action-bar chrome refs live here so the drag onDelta can translate the bar
  // live (its own beforeDraw lags for controller-moved siblings).
  const actionBarRef = useRef<Konva.Group>(null);
  // The view-rotation / label group. The action bar lives outside it (stage
  // coords), so its rest bounds map through this group's transform when rotated;
  // image export also captures it to exclude the transformer / action-bar chrome.
  const rotationGroupRef = useRef<Konva.Group>(null);
  // The white label paper; its drop shadow is dropped during image capture so
  // the PNG is the label rect, not a shadow-padded box.
  const labelPaperRef = useRef<Konva.Rect>(null);
  const ctxMenu = useContextMenu<MenuSection[]>();
  const lockedFrameRef = useRef<Konva.Group>(null);
  const dragActiveRef = useRef(false);
  const transformActiveRef = useRef(false);
  const barHalfRef = useRef({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Reactive view of the measured-footprint cache. The render layer publishes
  // footprints in a post-render effect (barcodes only after their async draw),
  // so reading the snapshot here is what makes the selection frame recompute once
  // they settle, e.g. after a group rotation swaps a barcode's footprint.
  const measuredSnapshot = useSyncExternalStore(subscribeMeasuredBounds, getMeasuredSnapshot);
  const rotateView = () => onViewRotationChange(nextRotation(viewRotation));
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  // Drag-snap guides live in group-local space (rendered inside the rotation
  // group) so they rotate with the view; line-endpoint guides stay in `guides`
  // (stage space, outside the group).
  const [dragGuides, setDragGuides] = useState<SnapGuide[]>([]);
  const [ghost, setGhost] = useState<LeafObject | null>(null);
  // While dragging, object positions live on the Konva nodes (the store only
  // commits on drag-end), so the store-derived off-label outline would freeze at
  // the start position. Hide it during the drag; it recomputes correctly on drop.
  const [isDragging, setIsDragging] = useState(false);

  // Bypasses @dnd-kit scroll-adjusted delta; palette scroll momentum
  // would otherwise offset touch-device drops.
  const lastPointerRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  const colors = useColorScheme();
  // The programming position is media motion, not artwork: unlike the safe
  // area it constrains nothing on the label, so the guide stays contextual
  // (pick in progress or its settings tab open) instead of permanent chrome.
  const pickingRfidPosition = useLabelStore((st) => st.pickingRfidPosition);
  const endRfidPositionPick = useLabelStore((st) => st.endRfidPositionPick);
  const rfidGuideVisible = useLabelStore(
    (st) => st.printerSettingsTab === "rfid" || st.pickingRfidPosition,
  );
  const t = useT();

  const {
    selectedIds,
    pristineEmptyIds,
    addObject,
    updateObject,
    updateObjects,
    convertObjectType,
    selectObject,
    toggleSelectObject,
    selectObjects,
    removeSelectedObjects,
    setSelectionLocked,
    groupSelection,
    ungroup,
    copySelectedObjects,
    pasteObjectsAt,
    duplicateSelectedObjects,
    reorderSelection,
    clipboard,
    variables,
    pages,
  } = useLabelStore();
  // Everything on canvas is drawn in the current page's dot scale;
  // designLabel stays the MODEL's design scope for the whole-document emit.
  useSourceShadowSync();
  const label = useLabelStore(selectRenderPageLabel);
  const designLabel = useLabelStore((s) => s.label);
  const objects = useLabelStore(selectRenderObjects);
  const effDpmm = effectiveDpmm(label);
  const previewBinding = usePreviewBinding();
  // Raw dataset/mapping (not just the active row): markerValueFindings
  // validates marker values across ALL CSV rows, since any row prints.
  const dataset = useLabelStore((s) => s.dataset);
  const columnMapping = useLabelStore(selectRenderColumnMapping);
  const paletteRows = useLabelStore((s) => s.paletteRows);
  const previewMode = useLabelStore((s) => s.previewMode);
  const editorFrozen = useLabelStore(selectEditorFrozen);
  // Overlay question, not freeze question: source-edit freezes the model but
  // the objects stay on canvas; only a preview replaces them with its render.
  const previewCoversCanvas = useLabelStore(selectPreviewLocksEditor);

  useEffect(() => {
    if (!pickingRfidPosition) return;
    // Frozen editor: a preview covers the canvas, or a source buffer owns the
    // input; either way the pick cannot land.
    if (editorFrozen) {
      endRfidPositionPick();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endRfidPositionPick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingRfidPosition, editorFrozen, endRfidPositionPick]);
  const exitPreviewMode = useLabelStore((s) => s.exitPreviewMode);
  // Entering preview unmounts the dragged node, so a mid-drag dragend may never
  // fire; clear the flag so off-label marks aren't stranded hidden afterwards.
  useEffect(() => {
    if (editorFrozen) setIsDragging(false);
  }, [editorFrozen]);

  // Pre-decode so toggling preview on doesn't flash a frame of empty space.
  const [previewImg, setPreviewImg] = useState<HTMLImageElement | null>(null);
  const previewUrl = previewMode.status === 'active' ? previewMode.url : null;
  useEffect(() => {
    if (!previewUrl) {
      setPreviewImg(null);
      return;
    }
    let active = true;
    void loadImage(previewUrl)
      .then((img) => {
        if (active) setPreviewImg(img);
      })
      .catch(() => {
        // A preview that fails to decode just stays hidden.
      });
    return () => {
      active = false;
    };
  }, [previewUrl]);

  // Loaded independently so a tile failure can't block the preview render.
  const [hatchImg, setHatchImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let active = true;
    void loadHatchTile()
      .then((img) => {
        if (active) setHatchImg(img);
      })
      .catch(() => {
        // No tile -> no hatch.
      });
    return () => {
      active = false;
    };
  }, []);

  // Leaves only; group lock/visible cascades down so per-leaf checks see one value.
  const visibleLeaves = useMemo(() => {
    const out: LeafObject[] = [];
    const walk = (nodes: LabelObject[], inheritedLocked: boolean) => {
      for (const n of nodes) {
        if (n.visible === false) continue;
        const locked = inheritedLocked || !!n.locked;
        if (isGroup(n)) {
          walk(n.children, locked);
        } else {
          out.push(locked && !n.locked ? ({ ...n, locked: true } as LeafObject) : n);
        }
      }
    };
    walk(objects, false);
    return out;
  }, [objects]);

  // Expand selection so group-click feels like Figma multi-drag.
  const attachableIds = useMemo(
    () => expandSelection(objects, selectedIds),
    [objects, selectedIds],
  );
  // Gate the trash glyph on the same predicate removeSelectedObjects uses, so
  // a locked-only selection gets no dead affordance.
  const hasDeletable = canDeleteSelection(objects, selectedIds);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);


  // Global binding so user can exit preview from anywhere. Preview-specific
  // on purpose: Escape must not silently discard a source-edit buffer.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      if (!selectPreviewLocksEditor(useLabelStore.getState())) return;
      e.preventDefault();
      useLabelStore.getState().exitPreviewMode();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Delete/Backspace removes all selected objects; ignored when focus is inside an input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Delete" && e.code !== "Backspace") return;
      if (isEditableTarget(e.target as HTMLElement)) return;
      // The frozen model must not change under the preview snapshot or an
      // open source buffer.
      if (selectEditorFrozen(useLabelStore.getState())) return;
      // Deleting mid-resize would destroy the nodes under the active gesture.
      if (transformActiveRef.current) return;
      const { selectedIds: ids } = useLabelStore.getState();
      if (ids.length === 0) return;
      e.preventDefault();
      useLabelStore.getState().removeSelectedObjects();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // arrow keys move the selected object; ignored when focus is inside an input
  useEffect(() => {
    const ARROW = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (!ARROW.has(e.code)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const state = useLabelStore.getState();
      if (selectEditorFrozen(state)) return;
      const ids = state.selectedIds;
      const objs = currentObjects(state);
      if (ids.length === 0) return;
      e.preventDefault();

      // shift = 10 mm, normal = snapSize when snap on, 1 dot when snap off
      const step = e.shiftKey
        ? effDpmm * 10
        : snapEnabled
          ? Math.round(snapSizeMm * effDpmm)
          : 1;
      const screenDx = e.code === "ArrowRight" ? step : e.code === "ArrowLeft" ? -step : 0;
      const screenDy = e.code === "ArrowDown" ? step : e.code === "ArrowUp" ? -step : 0;
      // Inverse-rotate so arrow direction matches visual.
      const [dx, dy] = inverseRotateDelta(screenDx, screenDy, viewRotation);

      // Expand so a selected group moves its leaves (group x/y is conventionally 0).
      const expanded = expandSelection(objs, ids);
      updateObjects(
        expanded.flatMap((sid) => {
          const obj = findObjectById(objs, sid);
          if (!obj || obj.locked) return [];
          return [{ id: sid, changes: { x: obj.x + dx, y: obj.y + dy } }];
        }),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [snapEnabled, snapSizeMm, effDpmm, updateObjects, viewRotation]);

  // usable area after reserving space for the ruler
  const usableWidth = containerSize.width - RULER_SIZE;
  const usableHeight = containerSize.height - RULER_SIZE;

  // ^LS shifts content LEFT by labelShift (spec/Labelary): model x=0 sits at the
  // viewport left, the physical label rect sits labelShift dots to its right. The
  // viewport is widened by labelShift so off-label-left content stays visible.
  const labelShiftMm = (label.labelShift ?? 0) / effDpmm;
  const effectiveWidthMm = label.widthMm + labelShiftMm;

  // zoom=1 = 100% (96 dpi CSS); fitZoom swaps axes at 90/270.
  const axisSwapped = isAxisSwapped(viewRotation);
  const fitWidthMm = axisSwapped ? label.heightMm : effectiveWidthMm;
  const fitHeightMm = axisSwapped ? effectiveWidthMm : label.heightMm;
  const fitZoom = usableWidth > 0 && usableHeight > 0
    ? Math.min(
        (usableWidth - PADDING * 2) / (fitWidthMm * SCREEN_PX_PER_MM),
        (usableHeight - PADDING * 2) / (fitHeightMm * SCREEN_PX_PER_MM),
      )
    : 1;

  // Init zoom to fit once container is sized so label is immediately visible.
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current || usableWidth <= 0) return;
    didInitRef.current = true;
    onZoomChange(fitZoom);
  }, [usableWidth, fitZoom, onZoomChange]);

  const {
    panOffset,
    spaceDown,
    isPanningRef,
    consumeDidPan,
    zoomIn,
    zoomOut,
    zoomFit,
    onMouseDown: onPanMouseDown,
    onMouseMove: onPanMouseMove,
    onMouseUp: onPanMouseUp,
    cursor,
  } = useCanvasPanZoom({ zoom, onZoomChange, fitZoom, containerRef });

  const scale = SCREEN_PX_PER_MM * zoom;
  // Probes variable DEFAULTS, not the previewed row, so a preview toggle cannot move the persisted anchor x.
  useEffect(() => {
    const { variables: vars, clock } = previewBinding;
    const probe = (o: LabelObject) => {
      if (isGroup(o)) return null;
      const resolved = resolveForMeasure(o, vars, clock);
      return measureBarcodeFootprintDots(resolved as LeafObject, scale, effDpmm);
    };
    registerBarcodeWidthProber(probe);
    return () => unregisterBarcodeWidthProber(probe);
  }, [scale, effDpmm, previewBinding]);
  const labelWidthPx = effectiveWidthMm * scale;
  const physicalWidthPx = label.widthMm * scale;
  const labelHeightPx = label.heightMm * scale;
  // Printer bitmap is physical head-raster dots: the preview stream carries
  // ^JMB, but ^PW/^LL stay physical (ZD230-verified), so this projection uses
  // physical dpmm, not effective.
  const toPreviewPx = (dots: number) => dotsToPx(dots, scale, label.dpmm);
  const printerLayout =
    previewMode.status === 'active' && previewMode.printerDims
      ? printerPreviewLayout(previewMode.printerDims, {
          width: mmToDots(label.widthMm, label.dpmm),
          height: mmToDots(label.heightMm, label.dpmm),
        })
      : null;
  const previewSize = printerLayout
    ? {
        width: toPreviewPx(printerLayout.crop.width),
        height: toPreviewPx(printerLayout.crop.height),
      }
    : { width: physicalWidthPx, height: labelHeightPx };
  const labelOffsetX = RULER_SIZE + (usableWidth - labelWidthPx) / 2 + panOffset.x;
  const labelShiftPx = labelShiftMm * scale;
  // model x=0 at the viewport left; the physical label rect sits labelShift right.
  const objectsOffsetX = labelOffsetX;
  const physicalLabelX = labelOffsetX + labelShiftPx;
  const labelOffsetY = RULER_SIZE + (usableHeight - labelHeightPx) / 2 + panOffset.y;

  // Visual label geometry after view rotation (axes swap at 90°/270°).
  // The Konva Group rotates around the label center, so the visual size
  // swaps width/height while the center stays put. Uses the effective (model)
  // width so the ruler stays aligned to model x=0 under ^LS; the white paper
  // rect inside it is the physical label (physicalLabelX/physicalWidthPx).
  const labelCenterX = labelOffsetX + labelWidthPx / 2;
  const labelCenterY = labelOffsetY + labelHeightPx / 2;
  const visualLabelWidthPx = axisSwapped ? labelHeightPx : labelWidthPx;
  const visualLabelHeightPx = axisSwapped ? labelWidthPx : labelHeightPx;
  const visualLabelX = labelCenterX - visualLabelWidthPx / 2;
  const visualLabelY = labelCenterY - visualLabelHeightPx / 2;
  // Resize / line-endpoint snap targets the PHYSICAL paper (model x=labelShift),
  // matching move-snap and the out-of-bounds rect, so every "snap to label edge"
  // agrees under ^LS. Rotation-aware like visualLabel*; identical when labelShift=0.
  const physicalCenterX = physicalLabelX + physicalWidthPx / 2;
  const physicalVisualWidthPx = axisSwapped ? labelHeightPx : physicalWidthPx;
  const physicalVisualHeightPx = axisSwapped ? physicalWidthPx : labelHeightPx;
  const physicalVisualX = physicalCenterX - physicalVisualWidthPx / 2;
  const physicalVisualY = labelCenterY - physicalVisualHeightPx / 2;
  const rulerWidthMm = axisSwapped ? label.heightMm : effectiveWidthMm;
  const rulerHeightMm = axisSwapped ? effectiveWidthMm : label.heightMm;
  const rulerReversal = axisReversal(viewRotation);

  // Safe-area guide rect in screen px (dots scaled, object-offset aligned).
  const safeAreaDots = safeAreaRectDots(label);
  const safeAreaPx = safeAreaDots && {
    x: objectsOffsetX + (safeAreaDots.x / effDpmm) * scale,
    y: labelOffsetY + (safeAreaDots.y / effDpmm) * scale,
    width: (safeAreaDots.width / effDpmm) * scale,
    height: (safeAreaDots.height / effDpmm) * scale,
  };

  const snapUnit = Math.round(snapSizeMm * effDpmm);
  const snap = (dots: number) =>
    snapEnabled ? Math.round(dots / snapUnit) * snapUnit : dots;

  // Shared gate: resize transformer and line-endpoint snap read this too.
  const smartSnapActive = !snapEnabled && smartSnapEnabled;
  // Held Ctrl/Cmd suspends smart snap per-gesture, one source for all paths.
  const snapBypassRef = useSnapBypassRef();

  // One stable closure to avoid 60Hz churning N per-object closures.
  const getOthersSnapshot = useCallback((excludeId: string) => {
    const stage = stageRef.current;
    if (!stage) return [];
    const rects = [];
    for (const o of getCurrentObjects()) {
      if (o.id === excludeId) continue;
      const n = stage.findOne<Konva.Node>(`#${o.id}`);
      if (!n) continue;
      const r = n.getClientRect({ relativeTo: stage });
      rects.push({ id: o.id, x: r.x, y: r.y, width: r.width, height: r.height });
    }
    return rects;
  }, []);

  const {
    lasso: lassoRect,
    consumeDidLasso,
    cancelLasso,
    onMouseMove: onLassoMouseMove,
    onMouseUp: onLassoMouseUp,
    onStageMouseDown,
  } = useCanvasLasso({ containerRef, stageRef, spaceDown, selectObjects });

  // Snap math operates in stage-screen space, so the label rect must
  // reflect the rotation-aware visual bounds, not layout coords.
  const transformerSnapLabelRect = useMemo(
    () => ({
      id: "_lbl",
      x: physicalVisualX,
      y: physicalVisualY,
      width: physicalVisualWidthPx,
      height: physicalVisualHeightPx,
    }),
    [physicalVisualX, physicalVisualY, physicalVisualWidthPx, physicalVisualHeightPx],
  );

  // Group frame from selectionUnionDots so it matches the snap borders.
  // Positioned imperatively (no x/y props) so a mid-drag re-render can't reset
  // the live position the controller's onDelta applies. Split into a movable
  // part (follows the drag) and a static part (locked, stays put) so the chrome
  // reflects the real union, not a rigid translate.
  const selectionFrameRef = useRef<Konva.Rect>(null);
  const multiResizeProxyRef = useRef<Konva.Rect>(null);
  // Movable group sub-outlines share one drag offset.
  const subOutlineGroupRef = useRef<Konva.Group>(null);
  const isMultiFrame = attachableIds.length > 1;
  // One selected group = solid frame (persistent); several picks = dashed (ad-hoc).
  const isMultiSelection = selectedIds.length > 1;
  // Snapshot (not the live map) so the frame derivations recompute when a
  // settled footprint changes; the changing snapshot reference is the signal.
  const frameCtx = { label, measured: measuredSnapshot, variables };
  // Hidden leaves never render, so the old client-rect path ignored them; keep
  // them out of the model-based bounds too.
  // visibleLeaves carries the cascaded (effective) lock; read it, not the raw
  // leaf in `objects`, so a locked group's children count as static here just
  // like the controller skips them.
  const visibleLeafById = new Map(visibleLeaves.map((l) => [l.id, l]));
  const visibleSelIds = attachableIds.filter((id) => visibleLeafById.has(id));
  const movableSelIds = visibleSelIds.filter((id) => !visibleLeafById.get(id)?.locked);
  const staticSelIds = visibleSelIds.filter((id) => !movableSelIds.includes(id));
  const toFramePx = (b: { x: number; y: number; width: number; height: number } | null) =>
    b && {
      x: objectsOffsetX + dotsToPx(b.x, scale, effDpmm),
      y: labelOffsetY + dotsToPx(b.y, scale, effDpmm),
      width: dotsToPx(b.width, scale, effDpmm),
      height: dotsToPx(b.height, scale, effDpmm),
    };
  // Frame Rect is multi-only; the movable/static bases also drive the action bar
  // (single drags too), so compute them for any selection.
  const hasSelection = visibleSelIds.length > 0;
  const selectionFrameBase = isMultiFrame ? toFramePx(selectionUnionDots(objects, visibleSelIds, frameCtx)) : null;
  const movableUnionDots = hasSelection ? selectionUnionDots(objects, movableSelIds, frameCtx) : null;
  // Needs >1 visible movable leaf (attachableIds counts hidden ones) and no
  // locked member; either would break the projected union.
  const multiResizeBboxDots =
    movableSelIds.length > 1 && staticSelIds.length === 0 && !editorFrozen
      ? movableUnionDots
      : null;
  const movableFrameBase = toFramePx(movableUnionDots);
  const staticFrameBase = hasSelection ? toFramePx(selectionUnionDots(objects, staticSelIds, frameCtx)) : null;
  // Preflight runs over the EXPORTABLE leaves (includeInExport), not the visible
  // ones, so a hidden-but-exported object is still warned and a visible-but-not-
  // exported one isn't falsely flagged: the warnings track what prints. Suppressed
  // during drag/preview-lock; the source-edit shadow keeps them, so the draft
  // validates in real time.
  const preflightSuppressed = previewCoversCanvas || isDragging;
  const preflightLeaves = preflightSuppressed ? [] : exportableLeaves(objects);
  const preflightFindings = preflightSuppressed
    ? []
    : suppressPristineEmpty(
        [
          ...computePreflight(preflightLeaves, frameCtx, unit),
          ...barcodeEncodeFindings(preflightLeaves, scale, effDpmm, previewBinding),
          ...markerValueFindings(preflightLeaves, {
            variables: previewBinding.variables,
            dataset,
            columnMapping,
          }),
        ],
        pristineEmptyIds,
      );
  // Off-label marks pair each off-label finding with its on-screen bbox: a
  // clipped object gets a solid amber outline, a fully-outside one a dashed red
  // outline with a faint fill. Keyed on the off-label kind (not severity) so a
  // future non-off-label finding won't borrow the off-label treatment. A hidden
  // exported object has no on-canvas node (absent from visibleLeafById), so it
  // gets a badge entry but no outline.
  const outOfBoundsMarks = preflightFindings.flatMap((f) => {
    if (f.kind !== "offLabelOutside" && f.kind !== "offLabelClipped") return [];
    const leaf = visibleLeafById.get(f.objectId);
    if (!leaf) return [];
    const rect = toFramePx(objectBoundsDots(leaf, frameCtx));
    return rect ? [{ id: f.objectId, kind: f.kind, rect }] : [];
  });
  // Sub-outlines mark group members; per group, split visible leaves
  // movable/static (mirrors the main frame).
  const movableGroupRects: { x: number; y: number; width: number; height: number }[] = [];
  const staticGroupRects: typeof movableGroupRects = [];
  if (isMultiSelection) {
    for (const id of selectedIds) {
      const o = findObjectById(objects, id);
      if (!o || !isGroup(o) || o.visible === false) continue;
      const leaves = getAllLeaves(o.children).filter((l) => visibleLeafById.has(l.id));
      const movable = toFramePx(selectionUnionDots(objects, leaves.filter((l) => !visibleLeafById.get(l.id)?.locked).map((l) => l.id), frameCtx));
      const fixed = toFramePx(selectionUnionDots(objects, leaves.filter((l) => visibleLeafById.get(l.id)?.locked).map((l) => l.id), frameCtx));
      if (movable) movableGroupRects.push(movable);
      if (fixed) staticGroupRects.push(fixed);
    }
  }
  // Action-bar bounds: live client-rects during a transformer resize (model
  // commits only at the end), else optical model bounds (matches the drag center).
  // Map group-local bounds into stage coords (identity when unrotated). Single
  // source for the rest position (getBarBounds) and on-drag position (onDelta).
  const barBoundsToStage = (b: BarBounds): BarBounds => {
    const rg = rotationGroupRef.current;
    if (!rg || viewRotation === 0) return b;
    const tf = rg.getAbsoluteTransform();
    const pts = [
      tf.point({ x: b.minX, y: b.minY }),
      tf.point({ x: b.maxX, y: b.minY }),
      tf.point({ x: b.minX, y: b.maxY }),
      tf.point({ x: b.maxX, y: b.maxY }),
    ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  };

  const getBarBounds = (): BarBounds | null => {
    const stage = stageRef.current;
    if (transformActiveRef.current && stage) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of visibleSelIds) {
        const node = stage.findOne(`#${id}`);
        if (!node) continue;
        const r = node.getClientRect({ relativeTo: stage, skipStroke: true });
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }
      return minX === Infinity ? null : { minX, minY, maxX, maxY };
    }
    const u = toFramePx(selectionUnionDots(getCurrentObjects(), visibleSelIds, frameCtx));
    return u
      ? barBoundsToStage({ minX: u.x, minY: u.y, maxX: u.x + u.width, maxY: u.y + u.height })
      : null;
  };
  useLayoutEffect(() => {
    const r = selectionFrameRef.current;
    if (!r || !selectionFrameBase) return;
    r.position({ x: selectionFrameBase.x, y: selectionFrameBase.y });
    r.size({ width: selectionFrameBase.width, height: selectionFrameBase.height });
    // Depend on the geometry primitives, not the freshly-built object, so a
    // mid-drag re-render can't reset the frame the onDelta handler moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectionFrameBase?.x,
    selectionFrameBase?.y,
    selectionFrameBase?.width,
    selectionFrameBase?.height,
  ]);

  // Whole-object drag controller; nodes spread its handlers, Stage captures start.
  const dragController = useKonvaDragController({
    stageRef,
    transformerRef,
    scale,
    dpmm: effDpmm,
    objectsOffsetX,
    labelOffsetY,
    snapEnabled,
    snapUnitDots: snapUnit,
    smartSnapEnabled,
    snapBypassRef,
    setGuides: setDragGuides,
    onDelta: (dx, dy) => {
      // Live union: movable part shifted by the drag, locked part where it sits.
      const moved = movableFrameBase && {
        x: movableFrameBase.x + dx,
        y: movableFrameBase.y + dy,
        width: movableFrameBase.width,
        height: movableFrameBase.height,
      };
      const live = unionPx(moved, staticFrameBase);
      if (!live) return;
      selectionFrameRef.current?.position({ x: live.x, y: live.y });
      selectionFrameRef.current?.size({ width: live.width, height: live.height });
      // Proxy follows the drag so the transformer chrome tracks live (the
      // controller already forceUpdates the transformer each tick).
      if (multiResizeBboxDots && moved) {
        multiResizeProxyRef.current?.position({ x: moved.x, y: moved.y });
      }
      // Movable sub-outlines follow the drag (reset to 0 on end).
      subOutlineGroupRef.current?.position({ x: dx, y: dy });
      // Shared clamp/flip policy; measure the bar lazily since a drag that selects
      // a new object renders it only after selectObject (absent at drag start).
      const bar = actionBarRef.current;
      const stage = stageRef.current;
      if (bar && stage && dragActiveRef.current && (dx !== 0 || dy !== 0)) {
        if (barHalfRef.current.h === 0) {
          const r = bar.getClientRect({ relativeTo: stage, skipShadow: true });
          barHalfRef.current = { w: r.width / 2, h: r.height / 2 };
        }
        bar.position(
          actionBarPosition(
            // `live` is group-local (the drag delta is in model space); map it to
            // stage coords so the bar tracks the rotated selection on-drag too.
            barBoundsToStage({
              minX: live.x,
              minY: live.y,
              maxX: live.x + live.width,
              maxY: live.y + live.height,
            }),
            barHalfRef.current.w,
            barHalfRef.current.h,
            stage.width(),
            stage.height(),
          ),
        );
      }
    },
  });

  useImperativeHandle(
    ref,
    () => {
      // All in DOTS, so align/distribute is zoom- and view-rotation-independent.
      // A group is one bbox; its delta shifts every leaf (absolute coordinates).
      const buildSelection = (alignRef: AlignRef): {
        boxes: AlignBox[];
        ref: ReturnType<typeof selectionUnionDots>;
        container: NonNullable<ReturnType<typeof selectionUnionDots>>;
        apply: (delta: { id: string; dx: number; dy: number }) => { id: string; changes: { x: number; y: number } }[];
      } | null => {
        const state = useLabelStore.getState();
        const ids = state.selectedIds;
        if (ids.length === 0) return null;
        const objs = currentObjects(state);
        const measured = measuredBoundsMap();
        const ctx = { label: currentPageLabel(state), measured };

        // Locked/hidden objects are non-participants (like drag/nudge/lasso).
        const movable = ids
          .map((id) => findObjectById(objs, id))
          .filter((o): o is LabelObject => o !== undefined && !o.locked && o.visible !== false);
        if (movable.length === 0) return null;

        const printable = printableRectDots(currentPageLabel(state));
        // Exclude structural primitives (full-label frame, spanning dividers) so
        // they neither inflate the reference nor get rearranged; content only,
        // consistent with tidy. Falls back to all when fewer than 2 content.
        const items = movable.map((o) => ({
          id: o.id,
          type: isGroup(o) ? "group" : o.type,
          box: objectBoundsDots(o, ctx),
        }));
        const contentIds = new Set(selectTidyTargets(items, printable.width, printable.height));
        const content = movable.filter((o) => contentIds.has(o.id));
        const contentIdList = content.map((o) => o.id);
        const boxes: AlignBox[] = items
          .filter((it) => contentIds.has(it.id))
          .map((it) => ({ id: it.id, ...it.box }));

        // Align-to-label pins to the safe-area inset when configured, so the
        // 6-edge buttons keep a uniform margin; otherwise the printable rect.
        const labelBox = safeAreaRectDots(currentPageLabel(state)) ?? printable;
        let refBox: ReturnType<typeof selectionUnionDots>;
        // A single unit (one object or one group) has no meaningful "selection"
        // or "key" frame of its own, so it aligns to the label (Figma: a single
        // element aligns to its parent). Multi-select honors the chosen ref.
        if (alignRef === "label" || content.length === 1) {
          refBox = labelBox;
        } else if (alignRef === "key") {
          const keyObj = content[content.length - 1];
          refBox = keyObj ? objectBoundsDots(keyObj, ctx) : selectionUnionDots(objs, contentIdList, ctx);
        } else {
          refBox = selectionUnionDots(objs, contentIdList, ctx);
        }

        const byId = new Map(content.map((o) => [o.id, o]));
        const apply = (delta: { id: string; dx: number; dy: number }) => {
          const dx = Math.round(delta.dx);
          const dy = Math.round(delta.dy);
          if (dx === 0 && dy === 0) return [];
          const node = byId.get(delta.id);
          if (!node) return [];
          // A group has no own x/y; shift each leaf by the same delta.
          const targets = isGroup(node) ? getAllLeaves(node.children) : [node];
          return targets.map((leaf) => ({
            id: leaf.id,
            changes: { x: leaf.x + dx, y: leaf.y + dy },
          }));
        };

        return { boxes, ref: refBox, container: labelBox, apply };
      };

      return {
        alignSelection: (op: AlignOp, ref: AlignRef) => {
          const sel = buildSelection(ref);
          if (!sel || !sel.ref || sel.boxes.length === 0) return;
          const deltas = computeAlignDeltas(sel.boxes, sel.ref, op);
          const updates = deltas.flatMap(sel.apply);
          if (updates.length > 0) updateObjects(updates);
        },
        // Distribute is inherently selection-relative; ref is fixed.
        distributeSelection: (axis: DistributeAxis) => {
          const sel = buildSelection("selection");
          if (!sel || sel.boxes.length < 3) return;
          const deltas = computeDistribute(sel.boxes, axis, { kind: "equalGap" });
          const updates = deltas.flatMap(sel.apply);
          if (updates.length > 0) updateObjects(updates);
        },
        // Tidy spreads the content across the safe area (else label) and centers
        // it. buildSelection already excludes structural frame/divider primitives.
        tidySelection: () => {
          const sel = buildSelection("selection");
          if (!sel || sel.boxes.length < 2) return;
          const deltas = computeTidy(sel.boxes, sel.container);
          const updates = deltas.flatMap(sel.apply);
          if (updates.length > 0) updateObjects(updates);
        },
        // ^FO<->^FT re-anchor: owned here so the measured-footprint read stays in
        // the layer that publishes it, like align/distribute. Pure conversion,
        // one undo step; no-op on groups and unsupported types. Barcodes need
        // their published footprint for the anchor delta, so an unmeasured one
        // (hidden/unmounted, or a failed render) refuses instead of converting
        // on fallback dims that would shift the real position.
        convertObjectPositionType: (id: string, target: "FO" | "FT") => {
          const state = useLabelStore.getState();
          const obj = findObjectById(currentObjects(state), id);
          if (!obj || isGroup(obj)) return;
          const measured = measuredBoundsMap();
          if (isBarcode(obj) && !measured.has(id)) return;
          const patch = convertPositionType(obj, target, {
            label: currentPageLabel(state),
            measured,
          });
          if (patch) updateObject(id, patch);
        },
      };
    },
    [updateObjects, updateObject],
  );

  const {
    rotateEnabled,
    resizeEnabled,
    enabledAnchors,
    centeredScaling,
    centeredResizeArmed,
    onTransformStart,
    onTransform,
    boundBoxFunc,
    onTransformEnd,
  } = useKonvaTransformer({
    transformerRef,
    stageRef,
    selectedIds: attachableIds,
    // Cascade-aware leaves so a child of a locked group reads as locked and the
    // transformer detaches (raw leaves would show dead resize handles).
    objects: visibleLeaves,
    scale,
    dpmm: effDpmm,
    objectsOffsetX,
    labelOffsetY,
    snap,
    updateObject,
    updateObjects,
    multiResizeBboxDots,
    labelRect: transformerSnapLabelRect,
    objectSnapEnabled: smartSnapActive,
    snapBypassRef,
    setGuides,
    viewRotation,
    editorFrozen,
  });

  // After useKonvaTransformer: reuses its centeredResizeArmed so the Alt-handle
  // bypass matches the reflow arming's resolved leaf selection exactly.
  useAltClickCycle({ containerRef, stageRef, selectObject, resizeArmed: centeredResizeArmed });

  // Step-rotation only (text/barcodes); box/ellipse/line/image use Transformer.
  const singleSelected = selectedIds.length === 1
    ? objects.find((o) => o.id === selectedIds[0]) ?? null
    : null;
  // Gate the image rotate button on isImageRotatable, not on a rotation prop:
  // pre-feature saves omit it, and objectRotation defaults a rotatable image to
  // 'N' so the button still shows.
  const stepRotation = !singleSelected
    ? null
    : singleSelected.type === "image"
      ? (isImageRotatable(singleSelected.props as ImageProps) ? objectRotation(singleSelected.props) : null)
      : getStepRotation(singleSelected);
  // Shape primitives get the single-rotate button too, not only via a group.
  const singleShapeRotatable =
    !!singleSelected && !isGroup(singleSelected) && SHAPE_PRIMITIVE_TYPES.has(singleSelected.type);
  const allSelectedLocked = isSelectionLocked(objects, selectedIds);

  // Selected leaves whose effective (cascaded) lock is on; each gets an amber
  // outline since the transformer skips locked nodes.
  const lockedLeafIds = useMemo(() => {
    const locked = new Set(
      visibleLeaves.flatMap((l) => (l.locked ? [l.id] : [])),
    );
    return attachableIds.filter((id) => locked.has(id));
  }, [visibleLeaves, attachableIds]);

  useSelectionActionBar({
    stageRef,
    attachableIds,
    lockedLeafIds,
    editorFrozen,
    dragActiveRef,
    actionBarRef,
    lockedFrameRef,
    getBarBounds,
  });

  const handleRotateStep = () => {
    if (!singleSelected || singleSelected.locked) return;
    if (stepRotation) {
      // Types with a rotation prop (text/barcode/symbol): step it in place.
      updateObject(singleSelected.id, {
        props: { rotation: nextZplRotation(stepRotation) },
      });
      return;
    }
    // Shapes without a rotation prop (box/ellipse/line): quarter-turn about the
    // object's own centre via the shared geometry (w/h swap or angle step).
    const changes = rotateSelectionChanges(objects, [singleSelected.id], frameCtx, 1);
    if (changes.size > 0) updateObjects([...changes].map(([id, c]) => ({ id, changes: c })));
  };

  // Group / multi-select rotate: one clockwise quarter turn about the union
  // centre, applied as a single batch so undo treats it as one step.
  const canRotateGroup =
    !allSelectedLocked &&
    (selectedIds.length > 1 || (!!singleSelected && isGroup(singleSelected)));
  const handleRotateGroup = () => {
    if (!canRotateGroup) return;
    const changes = rotateSelectionChanges(objects, selectedIds, frameCtx, 1);
    if (changes.size === 0) return;
    updateObjects([...changes].map(([id, c]) => ({ id, changes: c })));
    // Frame recomputes via subscribeMeasuredBounds once children republish.
  };

  // Group when 2+ top-level objects are selectable; ungroup when the selection
  // holds at least one top-level group. Both can be true at once (a group plus
  // a loose object), so both buttons can show.
  const canGroup = selectedIds.length > 1 && canGroupSelection(objects, selectedIds);
  const canUngroup = canUngroupSelection(objects, selectedIds);

  // Contextual action bar. Rotate is a 90-degree step (ZPL only stores N/R/I/B,
  // so a button beats the free-rotation drag handle other tools use). Icons rest
  // neutral and accent on hover; delete is set apart (divider) and destructive
  // (red). The bar itself is gated on !editorFrozen at the render site.
  const actionButtons: {
    key: string;
    iconPath: string;
    tone: ButtonTone;
    onClick: () => void;
    disabled?: boolean;
  }[] = [];
  // Line | Box mode toggle: same ^GB primitive, different handles. The icon
  // shows the target mode; a diagonal line can't become a box losslessly, so
  // that direction is disabled (still shown, greyed, to hint the affordance).
  if (singleSelected && isShapeToggleable(singleSelected) && !singleSelected.locked) {
    const toBox = oppositeShapeMode(singleSelected) === "box";
    actionButtons.push({
      key: "shape-mode",
      iconPath: toBox ? BOX_ICON : LINE_ICON,
      tone: "neutral",
      disabled: !canToggleShapeMode(singleSelected),
      onClick: () => convertObjectType(singleSelected.id, toggleShapeMode),
    });
  }
  if (singleSelected && (stepRotation || singleShapeRotatable) && !singleSelected.locked) {
    actionButtons.push({
      key: "rotate",
      iconPath: ROTATE_ICON,
      tone: "neutral",
      onClick: handleRotateStep,
    });
  }
  if (canRotateGroup) {
    actionButtons.push({
      key: "rotate-group",
      iconPath: ROTATE_ICON,
      tone: "neutral",
      onClick: handleRotateGroup,
    });
  }
  if (canGroup) {
    actionButtons.push({
      key: "group",
      iconPath: GROUP_ICON,
      tone: "neutral",
      onClick: groupSelection,
    });
  }
  if (canUngroup) {
    actionButtons.push({
      key: "ungroup",
      iconPath: UNGROUP_ICON,
      tone: "neutral",
      onClick: ungroup,
    });
  }
  if (selectedIds.length > 0) {
    actionButtons.push({
      key: "lock",
      iconPath: allSelectedLocked ? UNLOCK_ICON : LOCK_ICON,
      // Amber while locked to match the locked-state frame.
      tone: allSelectedLocked ? "active" : "neutral",
      onClick: () => setSelectionLocked(!allSelectedLocked),
    });
  }
  if (hasDeletable) {
    actionButtons.push({
      key: "delete",
      iconPath: TRASH_ICON,
      tone: "destructive",
      onClick: removeSelectedObjects,
    });
  }

  const handleObjectChange = (
    id: string,
    changes: Parameters<typeof updateObject>[1],
  ) => {
    const finalChanges = {
      ...changes,
      ...(changes.x !== undefined && { x: snap(changes.x) }),
      ...(changes.y !== undefined && { y: snap(changes.y) }),
    };
    // Fresh getState() guards stale closure across simultaneous DragEnd
    // events; expandSelection propagates the delta to group leaves.
    const state = useLabelStore.getState();
    const currentObjs = currentObjects(state);
    const selIds = expandSelection(currentObjs, state.selectedIds);
    if (
      selIds.length > 1 &&
      selIds.includes(id) &&
      (finalChanges.x !== undefined || finalChanges.y !== undefined)
    ) {
      const srcObj = findObjectById(currentObjs, id);
      if (srcObj) {
        const ddx = finalChanges.x !== undefined ? finalChanges.x - srcObj.x : 0;
        const ddy = finalChanges.y !== undefined ? finalChanges.y - srcObj.y : 0;
        updateObjects([
          { id, changes: finalChanges },
          ...selIds
            .filter((sid) => sid !== id)
            .flatMap((sid) => {
              const other = findObjectById(currentObjs, sid);
              return other
                ? [{ id: sid, changes: { x: other.x + ddx, y: other.y + ddy } }]
                : [];
            }),
        ]);
        return;
      }
    }
    updateObject(id, finalChanges);
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (editorFrozen) return;
    if (consumeDidPan()) return;
    if (consumeDidLasso()) return;
    if (e.target === e.target.getStage()) selectObjects([]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (editorFrozen) return;
    onPanMouseMove(e);
    onLassoMouseMove(e);
  };
  const handleMouseUp = () => {
    if (editorFrozen) return;
    onPanMouseUp();
    onLassoMouseUp();
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    if (editorFrozen) return;
    onPanMouseDown(e);
  };

  const pointerToLabelDots = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    // Inverse-rotate around label center to map screen -> un-rotated frame.
    const [rx, ry] = inverseRotateDelta(
      clientX - rect.left - labelCenterX,
      clientY - rect.top - labelCenterY,
      viewRotation,
    );
    const px = labelCenterX + rx;
    const py = labelCenterY + ry;
    return {
      x: snap(pxToDots(px - objectsOffsetX, scale, effDpmm)),
      y: snap(pxToDots(py - labelOffsetY, scale, effDpmm)),
    };
  };

  // PNG of the label paper and its objects only: hide editor chrome (grid,
  // safe-area, selection frames) and drop the view rotation so the image is the
  // canonical label, not the rotated viewport. Restore both afterwards.
  const captureLabelImage = async (): Promise<Blob | null> => {
    const group = rotationGroupRef.current;
    if (!group) return null;
    const chrome = group.find(`.${CAPTURE_CHROME}`);
    const rotation = group.rotation();
    const paper = labelPaperRef.current;
    chrome.forEach((n) => n.visible(false));
    // The paper shadow pads the node bbox; drop it so the PNG crops to the label.
    paper?.shadowEnabled(false);
    group.rotation(0);
    try {
      return await nodeToPngBlob(group);
    } finally {
      chrome.forEach((n) => n.visible(true));
      paper?.shadowEnabled(true);
      group.rotation(rotation);
    }
  };

  const openContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    // No menu while the editor is frozen; every action would be disabled anyway and
    // we must not mutate the selection behind it.
    if (editorFrozen) return;
    const stage = stageRef.current;
    if (!stage) return;
    // Find the object under the click by walking up to the first node whose id
    // is a known object; the white label Rect / stage count as empty.
    let targetId: string | null = null;
    let hitLeafId: string | null = null;
    let node: Konva.Node | null = e.target;
    while (node && node !== stage) {
      const id = node.id?.();
      if (id && findObjectById(objects, id)) {
        hitLeafId = id;
        // Resolve a grouped child to its outermost group, like the drag handler.
        targetId = selectionTargetId(objects, id);
        break;
      }
      node = node.getParent();
    }
    const onObject = targetId !== null;
    // Right-clicking an unselected object selects just it; an already-selected
    // one keeps the (possibly multi) selection.
    if (onObject && targetId && !selectedIds.includes(targetId)) selectObject(targetId);
    const sel =
      targetId && !selectedIds.includes(targetId) ? [targetId] : selectedIds;
    const click = pointerToLabelDots(e.evt.clientX, e.evt.clientY) ?? { x: 0, y: 0 };
    // Symbology switch acts on the barcode under the cursor: the leaf that was
    // actually hit (selection may have promoted to its group), else a single
    // selected object (e.g. drilled in via the layers panel).
    const singleForSwitch =
      (hitLeafId ? findObjectById(objects, hitLeafId) : null) ??
      (sel.length === 1 ? findObjectById(objects, sel[0] ?? "") : null);
    const switchTypeLocked =
      !!singleForSwitch &&
      (!!singleForSwitch.locked || hasLockedAncestor(objects, singleForSwitch.id));
    const dispatch = {
      copy: copySelectedObjects,
      cut: () => {
        copySelectedObjects();
        removeSelectedObjects();
      },
      duplicate: duplicateSelectedObjects,
      remove: removeSelectedObjects,
      pasteHere: () => pasteObjectsAt(click.x, click.y),
      reorder: reorderSelection,
      group: groupSelection,
      ungroup,
      toggleLock: () => setSelectionLocked(!isSelectionLocked(objects, sel)),
      addHere: (type: string, propsOverride?: object) => addObject(type, click, propsOverride),
      copyZplSelected: () => {
        void copyText(zplForSelection(label, objects, sel, variables));
      },
      copyZplLabel: () => {
        void copyText(generateMultiPageZPL(designLabel, pages, variables));
      },
      copyImage: () => {
        // Call write synchronously with the pending blob so the user activation
        // survives the async capture. Unsupported / failure stays a silent no-op.
        const blob = captureLabelImage().then((b) => {
          if (!b) throw new Error("capture-failed");
          return b;
        });
        void copyPngToClipboard(blob).catch(() => undefined);
      },
      exportImage: async () => {
        const blob = await captureLabelImage();
        if (blob) downloadBlob(blob, "label.png");
      },
      selectAll: () => selectObjects(objects.map((o) => o.id)),
      switchType: (type: string) => {
        if (singleForSwitch) {
          convertObjectType(singleForSwitch.id, convertSymbologyMapper(type as LeafType));
        }
      },
    };
    const switchTargets = singleForSwitch ? symbologyTargets(singleForSwitch) : [];
    // The menu offers only real moves; the current type stays in the panel select.
    const switchTypeGroups = symbologyGroupsFor(
      switchTargets.filter((s) => s.type !== singleForSwitch?.type),
      t,
    ).map((g) => ({ id: g.key as string, label: g.label, types: g.types }));
    // Add-here mirrors the palette: the curated quick list first, then the
    // registry groups in palette order, presets included. Empty groups drop out.
    const toAddable = (e: AddableEntry) => ({ id: e.id, type: e.type, label: e.label, propsOverride: e.propsOverride });
    const quickTypes = paletteRows
      .map((r) => resolveAddable(r.entryId, t))
      .filter((e): e is AddableEntry => e !== null)
      .map(toAddable);
    const addableGroups = [
      ...(quickTypes.length ? [{ id: "favorites", label: t.palette.favorites, types: quickTypes }] : []),
      ...addableGroupsFor(t).map((g) => ({ id: g.key, label: g.label, types: g.entries.map(toAddable) })),
    ].filter((g) => g.types.length > 0);
    const sections = buildContextMenu({
      onObject,
      hasSelection: sel.length > 0,
      canGroup: sel.length > 1 && canGroupSelection(objects, sel),
      canUngroup: canUngroupSelection(objects, sel),
      canDelete: canDeleteSelection(objects, sel),
      locked: isSelectionLocked(objects, sel),
      hasClipboard: clipboard.length > 0,
      hasObjects: objects.length > 0,
      editorFrozen,
      addableGroups,
      switchTypeGroups,
      switchTypeLocked,
      dispatch,
    });
    ctxMenu.openAtPointer(e.evt, sections);
  };

  const ghostLiveRef = useRef(false);
  useDndMonitor(
    paletteGhostHandlers({
      live: ghostLiveRef,
      locked: editorFrozen,
      pointerPos: () => pointerToLabelDots(lastPointerRef.current.x, lastPointerRef.current.y),
      setGhost,
      addObject,
      viewRotation: () => viewRotation,
      label: () => label,
      measured: () => getMeasuredSnapshot(),
    }),
  );

  const { setNodeRef: setDropRef } = useDroppable({ id: CANVAS_DROPPABLE_ID });

  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      setDropRef(el);
    },
    [setDropRef],
  );

  return (
    <div
      ref={mergedRef}
      className="w-full h-full relative"
      style={{
        background: colors.canvasBg,
        backgroundImage: `radial-gradient(circle, ${colors.canvasDot} 1px, transparent 1px)`,
        backgroundSize: "24px 24px",
        // Locus-of-attention feedback for the frozen editor.
        cursor: editorFrozen ? 'not-allowed' : pickingRfidPosition ? 'crosshair' : cursor,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Loading is DOM (Konva can't render before decode); error is in-canvas. */}
      {previewMode.status === 'loading' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg/40 pointer-events-none">
          <span className="font-mono text-[10px] text-muted animate-pulse">
            {t.output.loading}
          </span>
        </div>
      )}
      {previewMode.status === 'error' && (
        <div className="absolute inset-x-0 top-3 z-20 flex justify-center px-3 pointer-events-none">
          <div className="bg-surface border border-amber-500/60 rounded px-3 py-1.5 max-w-md flex items-center gap-3 pointer-events-auto">
            <span className="font-mono text-[10px] text-amber-400 leading-relaxed flex-1">
              {previewMode.error}
            </span>
            <button
              onClick={exitPreviewMode}
              className="font-mono text-[10px] text-muted hover:text-text transition-colors shrink-0"
            >
              {t.app.close}
            </button>
          </div>
        </div>
      )}

      {pickingRfidPosition && (
        <div className="absolute inset-x-0 top-3 z-20 flex justify-center px-3 pointer-events-none">
          <div className="bg-surface border border-border rounded px-3 py-1.5 flex items-center gap-3 pointer-events-auto">
            <span className="font-mono text-[10px] text-muted leading-relaxed">
              {t.printerSettings.rfid.pickHint}
            </span>
            <button
              onClick={endRfidPositionPick}
              className="font-mono text-[10px] text-text hover:text-accent transition-colors shrink-0"
            >
              {t.printerSettings.rfid.pickDone}
            </button>
          </div>
        </div>
      )}

      <PaginationControl />

      <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1">
        {label.printOrientation === "I" && (
          <div className="bg-surface border border-border rounded px-2 py-0.5 text-[10px] font-mono text-muted">
            {t.label.printOrientationIndicator}
          </div>
        )}
        {/* Remount on the empty<->active transition so the popover's open state
            resets and can't auto-reopen after findings briefly drain (e.g. a
            keyboard nudge fixes then re-breaks an object). */}
        <PreflightOverlay
          key={preflightFindings.length > 0 ? "active" : "empty"}
          findings={preflightFindings}
          objects={preflightLeaves}
          onSelect={(id) => selectObject(selectionTargetId(objects, id))}
        />
      </div>

      {/* Bottom-right controls: view options + zoom */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 bg-surface border border-border rounded px-1 py-0.5">
        <Tooltip content={`${t.app.toggleGrid} (G)`}>
          <button
            onClick={onGridToggle}
            className={`px-2 h-6 rounded text-xs font-mono transition-colors ${showGrid ? "text-accent bg-[--color-accent-dim]" : "text-muted hover:text-text hover:bg-surface-2"}`}
          >
            {t.app.toggleGrid}
          </button>
        </Tooltip>
        <Tooltip content={`${t.app.toggleSnap} (S)`}>
          <button
            onClick={onSnapToggle}
            className={`px-2 h-6 rounded text-xs font-mono transition-colors ${snapEnabled ? "text-accent bg-[--color-accent-dim]" : "text-muted hover:text-text hover:bg-surface-2"}`}
          >
            {t.app.toggleSnap}
          </button>
        </Tooltip>
        <div className="w-28">
          <Select<number>
            value={snapSizeMm}
            onChange={(value) => onSnapSizeChange(value)}
            disabled={!snapEnabled}
            groups={[
              {
                options: SNAP_OPTIONS[unit].map((o) => ({ value: o.mm, label: o.label })),
              },
            ]}
          />
        </div>
        <div className="w-px h-3.5 bg-border mx-0.5" />
        <button
          onClick={zoomOut}
          className="w-6 h-6 flex items-center justify-center text-muted hover:text-text font-mono text-sm transition-colors"
        >
          −
        </button>
        <button
          onClick={zoomFit}
          className="font-mono text-[10px] text-muted hover:text-accent w-10 text-center transition-colors"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={zoomIn}
          className="w-6 h-6 flex items-center justify-center text-muted hover:text-text font-mono text-sm transition-colors"
        >
          +
        </button>
        <div className="w-px h-3.5 bg-border mx-0.5" />
        <Tooltip content={`${t.app.rotateView} (R)`}>
          {/* Degree readout lives inside the button so the whole chip is one
              click target, not just the arrow with a separate label beside it. */}
          <button
            onClick={rotateView}
            aria-label={t.app.rotateView}
            className={`h-6 px-1.5 flex items-center justify-center gap-1 text-sm transition-colors ${viewRotation !== 0 ? "text-accent" : "text-muted hover:text-text"}`}
          >
            <span>↻</span>
            {viewRotation !== 0 && (
              <span className="font-mono text-[10px]">{viewRotation}°</span>
            )}
          </button>
        </Tooltip>
      </div>
      {containerSize.width > 0 && (
        <Stage
          ref={stageRef}
          width={containerSize.width}
          height={containerSize.height}
          onClick={handleStageClick}
          onContextMenu={openContextMenu}
          onMouseDown={onStageMouseDown}
          onDragStart={(e) => {
            cancelLasso();
            if (isPanningRef.current) {
              e.target.stopDrag();
              return;
            }
            // Dragging a non-selected object selects it first, so the chrome
            // (group frame, action bar) tracks what actually moves instead of
            // sticking to the prior selection.
            const id = e.target.id();
            const objs = getCurrentObjects();
            if (id && findObjectById(objs, id)) {
              const target = selectionTargetId(objs, id);
              if (!useLabelStore.getState().selectedIds.includes(target)) selectObject(target);
            }
            dragController.onDragStart(e);
            // onDelta drives/measures the bar (its beforeDraw lags); reset its
            // size so onDelta re-measures fresh for this selection.
            dragActiveRef.current = !!id && !!findObjectById(getCurrentObjects(), id);
            barHalfRef.current = { w: 0, h: 0 };
            setIsDragging(true);
          }}
          onDragEnd={() => {
            dragActiveRef.current = false;
            setIsDragging(false);
          }}
        >
          {/* Object layer */}
          <Layer>
            {/* Pivot at labelCenter; node.x()/y() stays group-local during drags. */}
            <Group
              ref={rotationGroupRef}
              x={labelCenterX}
              y={labelCenterY}
              rotation={viewRotation}
              offsetX={labelCenterX}
              offsetY={labelCenterY}
            >
              <Rect
                ref={labelPaperRef}
                x={physicalLabelX}
                y={labelOffsetY}
                width={physicalWidthPx}
                height={labelHeightPx}
                fill="white"
                // Two freeze reasons, two glows: preview amber, source edit the panel's cyan.
                shadowColor={
                  editorFrozen
                    ? previewCoversCanvas
                      ? 'rgba(251, 191, 36, 0.55)'
                      : 'rgba(34, 184, 212, 0.55)'
                    : 'rgba(0,0,0,0.4)'
                }
                shadowBlur={editorFrozen ? 28 : 12}
                shadowOffsetY={editorFrozen ? 0 : 2}
                onClick={() => selectObjects([])}
              />

              {/* Safe-area guide: non-interactive dashed inset, accent like the ^FB wrap-guide. */}
              {!editorFrozen && safeAreaPx && (
                <Rect
                  name={CAPTURE_CHROME}
                  x={safeAreaPx.x}
                  y={safeAreaPx.y}
                  width={safeAreaPx.width}
                  height={safeAreaPx.height}
                  stroke={colors.accent}
                  strokeWidth={1}
                  dash={[4, 3]}
                  listening={false}
                />
              )}

              {/* ^RS programming position: label-config guide, drawn with
                  the safe area rather than as an object. */}
              {!editorFrozen && rfidGuideVisible && (
                <RfidPositionGuide
                  labelX={physicalLabelX}
                  labelY={labelOffsetY}
                  labelWidthPx={physicalWidthPx}
                  labelHeightPx={labelHeightPx}
                  scale={scale}
                  picking={pickingRfidPosition}
                  onPicked={endRfidPositionPick}
                  color={colors.accent}
                  mutedColor={colors.muted}
                />
              )}

              {showGrid && (
                <Group name={CAPTURE_CHROME} listening={false}>
                  <Grid
                    labelOffsetX={labelOffsetX}
                    labelOffsetY={labelOffsetY}
                    labelWidthPx={labelWidthPx}
                    labelHeightPx={labelHeightPx}
                    scale={scale}
                    snapSizeMm={snapSizeMm}
                    colors={colors}
                  />
                </Group>
              )}

              {previewCoversCanvas ? (
                previewImg && (
                  <>
                    <KImage
                      image={previewImg}
                      x={physicalLabelX}
                      y={labelOffsetY}
                      width={previewSize.width}
                      height={previewSize.height}
                      crop={printerLayout?.crop}
                      listening={false}
                    />
                    {hatchImg &&
                      printerLayout?.hatches.map((h) => (
                        <Rect
                          key={`${h.x}:${h.y}`}
                          x={physicalLabelX + toPreviewPx(h.x)}
                          y={labelOffsetY + toPreviewPx(h.y)}
                          width={toPreviewPx(h.width)}
                          height={toPreviewPx(h.height)}
                          fillPatternImage={hatchImg}
                          fillPatternRepeat="repeat"
                          listening={false}
                        />
                      ))}
                  </>
                )
              ) : (
                visibleLeaves.map((obj) => (
                  <KonvaObject
                    key={obj.id}
                    obj={obj}
                    scale={scale}
                    dpmm={effDpmm}
                    offsetX={objectsOffsetX}
                    offsetY={labelOffsetY}
                    isSelected={attachableIds.includes(obj.id)}
                    onSelect={(add) => {
                      // Click child -> select outermost group. Locked objects
                      // are selectable so the action bar's unlock is reachable;
                      // the lock guard still blocks any move/transform.
                      const target = selectionTargetId(objects, obj.id);
                      if (add) toggleSelectObject(target);
                      else selectObject(target);
                    }}
                    onChange={(changes) => handleObjectChange(obj.id, changes)}
                    snap={snap}
                    dragHandlers={dragController.nodeDragHandlers}
                    registerMover={dragController.registerMover}
                    getOthersSnapshot={smartSnapActive ? getOthersSnapshot : undefined}
                    labelRect={transformerSnapLabelRect}
                    setGuides={setGuides}
                    snapBypassRef={snapBypassRef}
                  />
                ))
              )}

              {/* Off-label preflight, two severities: clipped = solid amber
                  outline; fully outside = dashed red outline + faint red fill.
                  Non-interactive chrome. */}
              {outOfBoundsMarks.map((m) => {
                const outside = m.kind === "offLabelOutside";
                const color = outside ? colors.error : colors.accent;
                return (
                  <Group key={`oob-${m.id}`} listening={false}>
                    {outside && (
                      <Rect
                        name={CAPTURE_CHROME}
                        x={m.rect.x}
                        y={m.rect.y}
                        width={m.rect.width}
                        height={m.rect.height}
                        fill={color}
                        opacity={0.1}
                      />
                    )}
                    <Rect
                      name={CAPTURE_CHROME}
                      x={m.rect.x}
                      y={m.rect.y}
                      width={m.rect.width}
                      height={m.rect.height}
                      stroke={color}
                      strokeWidth={1.5}
                      dash={outside ? [6, 4] : undefined}
                    />
                  </Group>
                );
              })}

              {!editorFrozen && ghost && (
                <Group opacity={0.5} listening={false}>
                  <KonvaObject
                    obj={ghost}
                    scale={scale}
                    offsetX={objectsOffsetX}
                    offsetY={labelOffsetY}
                    isSelected={false}
                    onSelect={() => { /* ghost */ }}
                    onChange={() => { /* ghost */ }}
                    snap={snap}
                    dpmm={effDpmm}
                  />
                </Group>
              )}

              {/* Multi-select/group frame from model bounds (matches snap borders);
                  positioned imperatively in useLayoutEffect + the drag onDelta. */}
              {!editorFrozen && selectionFrameBase && !multiResizeBboxDots && (
                <Rect
                  ref={selectionFrameRef}
                  name={CAPTURE_CHROME}
                  stroke={allSelectedLocked ? colors.accent : colors.selection}
                  strokeWidth={1.5}
                  dash={isMultiSelection || allSelectedLocked ? [6, 4] : undefined}
                  listening={false}
                />
              )}

              {/* Multi-resize proxy; geometry synced by the transformer hook. */}
              {!editorFrozen && multiResizeBboxDots && (
                <Rect
                  ref={multiResizeProxyRef}
                  id={MULTI_RESIZE_PROXY_ID}
                  name={CAPTURE_CHROME}
                  listening={false}
                  fillEnabled={false}
                  strokeEnabled={false}
                />
              )}

              {/* Box per group member: movable parts (blue) drag; locked parts
                  (amber, the locked convention) stay put. */}
              {!editorFrozen && movableGroupRects.length > 0 && (
                <Group ref={subOutlineGroupRef} name={CAPTURE_CHROME} listening={false}>
                  {movableGroupRects.map((r, i) => (
                    <Rect
                      key={i}
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      stroke={colors.selection}
                      strokeWidth={1}
                      listening={false}
                    />
                  ))}
                </Group>
              )}
              {!editorFrozen && staticGroupRects.length > 0 && (
                <Group name={CAPTURE_CHROME} listening={false}>
                  {staticGroupRects.map((r, i) => (
                    <Rect
                      key={i}
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      stroke={colors.accent}
                      strokeWidth={1}
                      dash={[6, 4]}
                      listening={false}
                    />
                  ))}
                </Group>
              )}

              {/* Drag-snap guides: group-local, so they rotate with the view. */}
              {!editorFrozen && <GuideLines guides={dragGuides} />}
            </Group>

            {/* Outside the rotation Group; clientRect/Transformer respect parent transforms. */}
            {!editorFrozen && lassoRect && (
              <Rect
                x={lassoRect.x}
                y={lassoRect.y}
                width={lassoRect.w}
                height={lassoRect.h}
                fill="rgba(99,102,241,0.08)"
                stroke="#6366f1"
                strokeWidth={1}
                dash={[4, 3]}
                listening={false}
              />
            )}

            {!editorFrozen && <GuideLines guides={guides} />}

            {!editorFrozen && (
              <Transformer
                ref={transformerRef}
                borderDash={isMultiSelection && multiResizeBboxDots ? [6, 4] : undefined}
                rotateEnabled={rotateEnabled}
                resizeEnabled={resizeEnabled}
                enabledAnchors={enabledAnchors}
                centeredScaling={centeredScaling}
                onTransformStart={() => {
                  transformActiveRef.current = true;
                  onTransformStart();
                }}
                onTransform={onTransform}
                boundBoxFunc={boundBoxFunc}
                onTransformEnd={() => {
                  try {
                    onTransformEnd();
                  } finally {
                    transformActiveRef.current = false;
                  }
                }}
                borderStroke={colors.selection}
                anchorStroke={colors.selection}
                anchorFill="#ffffff"
                anchorSize={7}
                anchorStrokeWidth={1}
                // Stroke-padding drift would surface as 1-dot ZPL jumps.
                ignoreStroke
              />
            )}

            {!editorFrozen && lockedLeafIds.length > 0 && (
              <Group ref={lockedFrameRef}>
                {lockedLeafIds.map((id) => (
                  <Rect
                    key={id}
                    stroke={colors.accent}
                    strokeWidth={1.5}
                    dash={[4, 3]}
                    listening={false}
                  />
                ))}
              </Group>
            )}

            {!editorFrozen && attachableIds.length > 0 && actionButtons.length > 0 && (
              <Group ref={actionBarRef}>
                {(() => {
                  const n = actionButtons.length;
                  const w = (n - 1) * BUTTON_STEP_PX + 2 * BUTTON_RADIUS + 16;
                  const h = 2 * BUTTON_RADIUS + 8;
                  // Divider sits just left of the delete button to set it apart.
                  const deleteIndex = actionButtons.findIndex((b) => b.key === "delete");
                  const dividerX =
                    deleteIndex > 0
                      ? (deleteIndex - (n - 1) / 2) * BUTTON_STEP_PX - BUTTON_STEP_PX / 2
                      : null;
                  return (
                    <>
                      {/* Opaque pill (not alpha) so icons stay legible over busy
                          content; flat hairline matches the rest of the canvas
                          chrome (no shadow). Amber while the selection is locked. */}
                      <Rect
                        x={-w / 2}
                        y={-h / 2}
                        width={w}
                        height={h}
                        cornerRadius={h / 2}
                        fill={colors.surface}
                        stroke={allSelectedLocked ? colors.accent : colors.selection}
                        strokeWidth={1}
                      />
                      {dividerX !== null && (
                        <Rect
                          x={dividerX}
                          y={-h / 2 + 5}
                          width={1}
                          height={h - 10}
                          fill={colors.border}
                        />
                      )}
                    </>
                  );
                })()}
                {actionButtons.map((b, i) => (
                  <Group
                    key={b.key}
                    x={(i - (actionButtons.length - 1) / 2) * BUTTON_STEP_PX}
                  >
                    <FloatingCanvasButton
                      tone={b.tone}
                      onClick={b.onClick}
                      iconPath={b.iconPath}
                      disabled={b.disabled}
                    />
                  </Group>
                ))}
              </Group>
            )}
          </Layer>

          {/* Ruler tracks visual edges; labels reverse when axis flips. */}
          <Layer listening={false}>
            <Ruler
              labelOffsetX={visualLabelX}
              labelOffsetY={visualLabelY}
              labelWidthMm={rulerWidthMm}
              labelHeightMm={rulerHeightMm}
              scale={scale}
              canvasWidth={containerSize.width}
              canvasHeight={containerSize.height}
              unit={unit}
              colors={colors}
              horizontalReversed={rulerReversal.horizontal}
              verticalReversed={rulerReversal.vertical}
            />
          </Layer>
        </Stage>
      )}
      {ctxMenu.menu && (
        <CanvasContextMenu
          sections={ctxMenu.menu.data}
          x={ctxMenu.menu.x}
          y={ctxMenu.menu.y}
          labels={t.contextMenu as unknown as Record<string, string>}
          onClose={ctxMenu.close}
        />
      )}
    </div>
  );
});
