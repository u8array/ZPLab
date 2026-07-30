import { useRef } from "react";
import type Konva from "konva";
import { pxToDots, dotsToPx } from "@zplab/core/lib/coordinates";
import { gridSnapDelta, smartSnapDelta, labelSnapRectDots } from "../dragGeometry";
import { SNAP_THRESHOLD_PX } from "../../../lib/snapGuides";
import type { SnapGuide, SnapRect } from "../../../lib/snapGuides";
import {
  objectBoundsDots,
  selectionUnionDots,
  type BoundingBoxDots,
} from "@zplab/core/lib/objectBounds";
import { measuredBoundsMap } from "../measuredBoundsCache";
import { expandSelection, findObjectById, getAllLeaves } from "@zplab/core/types/Group";
import { useLabelStore, currentObjects, currentPageLabel, type ObjectChanges } from "../../../store/labelStore";

/** Everything the controller needs from LabelCanvas; mirrors the param style of
 *  useKonvaTransformer so move and resize sit at the same layer. */
interface DragControllerArgs {
  stageRef: React.RefObject<Konva.Stage | null>;
  transformerRef: React.RefObject<Konva.Transformer | null>;
  scale: number;
  dpmm: number;
  /** Group-local origin of the objects layer (px), to map dots <-> node space. */
  objectsOffsetX: number;
  labelOffsetY: number;
  snapEnabled: boolean;
  /** Grid step in dots; only consulted when snapEnabled. */
  snapUnitDots: number;
  /** Object-to-object (smart) snapping, active when grid snap is off. Disabled
   *  entirely when false; also bypassed per-gesture while Ctrl/Cmd is held. */
  smartSnapEnabled: boolean;
  /** Shared Ctrl/Cmd bypass state (useSnapBypassRef); all snap consumers read
   *  the same source so move, resize and line reshape bypass consistently. */
  snapBypassRef: React.RefObject<boolean>;
  /** Guides in group-local px (rendered inside the rotation group). */
  setGuides: (guides: SnapGuide[]) => void;
  /** Live group-local drag delta (px) each tick, (0,0) on end. Lets the
   *  selection frame follow the drag without reading node client-rects. */
  onDelta?: (localDx: number, localDy: number) => void;
}

/** Applies a live group-local pixel offset to one object during a drag.
 *  Shapes move their Konva node directly; line/state-driven renderers register
 *  a custom mover so the visible geometry follows. */
type LiveMover = (localDx: number, localDy: number) => void;

interface DragHandlers {
  /** Capture handler; wired to the Stage so it fires for every node via bubbling. */
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  /** Per-node handlers; spread onto each renderer's draggable node. */
  nodeDragHandlers: {
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  };
  /** Register/clear a custom live-mover for an object (state-driven renderers). */
  registerMover: (id: string, mover: LiveMover | null) => void;
}

interface DragState {
  /** Movable leaf ids moving together (single drag = one id). */
  ids: string[];
  primaryId: string;
  /** Group-local node position (px) per id at drag start. */
  startLocal: Map<string, { x: number; y: number }>;
  /** Stored model position (dots) per id at drag start, for the commit. */
  startModel: Map<string, { x: number; y: number }>;
  /** Selection union (dots) at drag start, for snapping. */
  startUnionDots: BoundingBoxDots;
  /** Non-dragged object bounds (dots) as smart-snap targets. */
  others: SnapRect[];
  /** Printable label rect (dots) as a smart-snap target. */
  labelDots: SnapRect;
  /** Latest model-space delta (dots), applied to all on commit. */
  lastDelta: { x: number; y: number };
}

/**
 * Centralizes whole-object drag (single + multi), the move counterpart to
 * useKonvaTransformer. Snaps in model dots off `objectBoundsDots` so it needs no
 * rotation math; multi-select moves by one delta. Lines follow via a registered
 * mover.
 */
export function useKonvaDragController(args: DragControllerArgs): DragHandlers {
  const dragRef = useRef<DragState | null>(null);
  const moversRef = useRef<Map<string, LiveMover>>(new Map());
  // Tracks whether guides are currently empty so grid drags don't re-render the
  // canvas every tick by setting an already-empty guide list.
  const guidesEmptyRef = useRef(true);

  const setGuides = (guides: SnapGuide[]) => {
    if (guides.length === 0 && guidesEmptyRef.current) return;
    guidesEmptyRef.current = guides.length === 0;
    args.setGuides(guides);
  };

  // Register effects only re-run between commits, never mid drag tick, so a
  // fresh reference each render can't drop a mover during a drag.
  const registerMover = (id: string, mover: LiveMover | null) => {
    if (mover) moversRef.current.set(id, mover);
    else moversRef.current.delete(id);
  };

  // Move one object by a group-local pixel offset, via its mover if registered.
  const applyOffset = (id: string, stage: Konva.Stage, localDx: number, localDy: number) => {
    const mover = moversRef.current.get(id);
    if (mover) {
      mover(localDx, localDy);
      return;
    }
    const node = stage.findOne<Konva.Node>(`#${id}`);
    const s = dragRef.current?.startLocal.get(id);
    if (node && s) node.position({ x: s.x + localDx, y: s.y + localDy });
  };

  // Convert a model-space (dots) guide to the group-local px space the guide
  // layer renders in. Axis stays the same; the parent Group applies rotation.
  const toLocalGuide = (g: SnapGuide): SnapGuide => {
    const posOff = g.orientation === "V" ? args.objectsOffsetX : args.labelOffsetY;
    const spanOff = g.orientation === "V" ? args.labelOffsetY : args.objectsOffsetX;
    return {
      ...g,
      pos: posOff + dotsToPx(g.pos, args.scale, args.dpmm),
      from: spanOff + dotsToPx(g.from, args.scale, args.dpmm),
      to: spanOff + dotsToPx(g.to, args.scale, args.dpmm),
    };
  };

  const onDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    dragRef.current = null;
    const stage = args.stageRef.current;
    const primaryId = e.target.id();
    if (!stage || !primaryId) return;

    const state = useLabelStore.getState();
    const objs = currentObjects(state);
    if (!findObjectById(objs, primaryId)) return;
    const ctx = { label: currentPageLabel(state), measured: measuredBoundsMap() };

    // Drag the whole movable selection when the grabbed node is part of a 2+
    // selection; otherwise just the grabbed object.
    const selection = expandSelection(objs, state.selectedIds);
    const set = selection.includes(primaryId) && selection.length > 1 ? selection : [primaryId];
    const startLocal = new Map<string, { x: number; y: number }>();
    const startModel = new Map<string, { x: number; y: number }>();
    const ids: string[] = [];
    for (const id of set) {
      const obj = findObjectById(objs, id);
      const node = stage.findOne<Konva.Node>(`#${id}`);
      // node.draggable() carries the cascaded lock (renderers set it), so a
      // locked group's children are skipped even though their raw leaf isn't.
      if (!obj || obj.visible === false || !node || !node.draggable()) continue;
      startLocal.set(id, { x: node.x(), y: node.y() });
      startModel.set(id, { x: obj.x, y: obj.y });
      ids.push(id);
    }
    if (!ids.includes(primaryId)) return;

    const startUnionDots = selectionUnionDots(objs, ids, ctx);
    if (!startUnionDots) return;

    const dragged = new Set(ids);
    const others: SnapRect[] = [];
    for (const leaf of getAllLeaves(objs)) {
      if (dragged.has(leaf.id)) continue;
      const b = objectBoundsDots(leaf, ctx);
      others.push({ id: leaf.id, ...b });
    }
    const labelDots = labelSnapRectDots(currentPageLabel(state));

    dragRef.current = {
      ids,
      primaryId,
      startLocal,
      startModel,
      startUnionDots,
      others,
      labelDots,
      lastDelta: { x: 0, y: 0 },
    };
  };

  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const drag = dragRef.current;
    const stage = args.stageRef.current;
    if (!drag || !stage || e.target.id() !== drag.primaryId) return;
    const primary = stage.findOne<Konva.Node>(`#${drag.primaryId}`);
    const primaryStart = drag.startLocal.get(drag.primaryId);
    const primaryModel = drag.startModel.get(drag.primaryId);
    if (!primary || !primaryStart || !primaryModel) return;

    // Raw drag delta in model dots (group-local px maps straight to model
    // orientation, so no rotation conversion is needed).
    const rawDx = pxToDots(primary.x() - primaryStart.x, args.scale, args.dpmm);
    const rawDy = pxToDots(primary.y() - primaryStart.y, args.scale, args.dpmm);

    // Hold Ctrl/Cmd to bypass smart snapping for this move (Figma/Sketch idiom;
    // Alt and Shift are already taken by resize-mode and axis-constrain).
    const bypassSmart = args.snapBypassRef.current;

    let deltaDots: { x: number; y: number };
    if (args.snapEnabled) {
      // Grid: snap the grabbed object's stored position to the grid, then move
      // the whole selection by that delta.
      const snap = gridSnapDelta(
        { x: primaryModel.x + rawDx, y: primaryModel.y + rawDy, width: 0, height: 0 },
        args.snapUnitDots,
      );
      deltaDots = { x: rawDx + snap.dx, y: rawDy + snap.dy };
      setGuides([]);
    } else if (!args.smartSnapEnabled || bypassSmart) {
      deltaDots = { x: rawDx, y: rawDy };
      setGuides([]);
    } else {
      // Smart: snap the dragged union (model bounds) against the other objects
      // and the label, then translate everything by that one delta.
      const cur: SnapRect = {
        id: "_sel",
        x: drag.startUnionDots.x + rawDx,
        y: drag.startUnionDots.y + rawDy,
        width: drag.startUnionDots.width,
        height: drag.startUnionDots.height,
      };
      const thresholdDots = pxToDots(SNAP_THRESHOLD_PX, args.scale, args.dpmm);
      const { dx, dy, guides } = smartSnapDelta(cur, drag.others, drag.labelDots, thresholdDots);
      deltaDots = { x: rawDx + dx, y: rawDy + dy };
      setGuides(guides.map(toLocalGuide));
    }

    drag.lastDelta = deltaDots;
    const localDx = dotsToPx(deltaDots.x, args.scale, args.dpmm);
    const localDy = dotsToPx(deltaDots.y, args.scale, args.dpmm);
    for (const id of drag.ids) applyOffset(id, stage, localDx, localDy);
    args.onDelta?.(localDx, localDy);
    args.transformerRef.current?.forceUpdate();
  };

  const onDragEnd = () => {
    const drag = dragRef.current;
    const stage = args.stageRef.current;
    dragRef.current = null;
    setGuides([]);
    args.onDelta?.(0, 0);
    if (!drag) return;
    // State-driven renderers (movers): clear the live offset and reset the node
    // to base, since the committed model position drives the final render. Plain
    // shape nodes already sit at start + delta, so resetting them would flicker.
    for (const id of drag.ids) {
      const mover = moversRef.current.get(id);
      if (!mover) continue;
      mover(0, 0);
      const start = drag.startLocal.get(id);
      if (stage && start) stage.findOne<Konva.Node>(`#${id}`)?.position(start);
    }
    const { x: dx, y: dy } = drag.lastDelta;
    if (dx === 0 && dy === 0) return;
    const changes: { id: string; changes: ObjectChanges }[] = [];
    for (const id of drag.ids) {
      const m = drag.startModel.get(id);
      if (m) changes.push({ id, changes: { x: m.x + dx, y: m.y + dy } });
    }
    if (changes.length > 0) useLabelStore.getState().updateObjects(changes);
  };

  return { onDragStart, nodeDragHandlers: { onDragMove, onDragEnd }, registerMover };
}
