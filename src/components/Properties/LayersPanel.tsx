import { Fragment, useMemo, useState } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { FolderPlusIcon } from '@heroicons/react/16/solid';
import { useLabelStore, useCurrentObjects } from '../../store/labelStore';
import { canGroupSelection, dragBlockIds, effectiveSelection, findObjectById, isGroup, walkObjects } from '@zplab/core/types/Group';
import { getEntry } from '@zplab/core/registry';
import { useT } from '../../hooks/useT';
import { buildBulkToggleUpdates, type ToggleField } from '../../lib/bulkToggle';
import { buildFlatRows, useLayerDnd, type FlatRow } from './useLayerDnd';
import { LayerRow } from './LayerRow';
import { INDENT_STEP } from './layerLayout';
import { DragChip } from '../ui/DragChip';
import { Tooltip } from '../ui/Tooltip';

/** Open slot shown where the dragged block will land on release. Indented to the
 *  target depth, which tracks the cursor during an indent-climb, so the gap
 *  itself communicates the landing depth (no separate insertion line). */
function LayerDropGap({ depth }: { depth: number }) {
  const padLeft = depth > 0 ? depth * INDENT_STEP + 16 : 8;
  return (
    <div
      aria-hidden
      className="h-7 my-0.5 rounded border border-dashed border-accent/70 bg-accent/10"
      style={{ marginLeft: padLeft, marginRight: 8 }}
    />
  );
}

export function LayersPanel() {
  const t = useT();
  const {
    selectedIds,
    selectObject,
    selectObjects,
    toggleSelectObject,
    updateObject,
    updateObjects,
    groupSelection,
    addGroup,
    ungroupIds,
    reparentObjects,
  } = useLabelStore();
  const objects = useCurrentObjects();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Anchor for shift-range selection over the flat display order.
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const allNodes = useMemo(() => [...walkObjects(objects)], [objects]);
  const rows = useMemo(() => buildFlatRows(objects, expandedIds), [objects, expandedIds]);
  const rowsById = useMemo(() => {
    const m = new Map<string, FlatRow>();
    for (const r of rows) m.set(r.obj.id, r);
    return m;
  }, [rows]);
  const allRowIds = useMemo(() => rows.map((r) => r.obj.id), [rows]);

  const effectiveSelected = useMemo(
    () => effectiveSelection(objects, selectedIds),
    [objects, selectedIds],
  );

  // Soft tint for descendants of an (effectively) selected group, signalling
  // which leaves move together. The group row itself keeps the stronger accent.
  const idsUnderSelectedGroup = useMemo(() => {
    const out = new Set<string>();
    for (const id of effectiveSelected) {
      const obj = findObjectById(objects, id);
      if (!obj || !isGroup(obj)) continue;
      for (const desc of walkObjects(obj.children)) out.add(desc.id);
    }
    return out;
  }, [objects, effectiveSelected]);

  // Click selection: shift = range over the flat display order from the anchor,
  // ctrl/meta = toggle one, plain = replace. Anchor follows non-range clicks.
  const handleRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchorId) {
      const a = allRowIds.indexOf(anchorId);
      const b = allRowIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        selectObjects(allRowIds.slice(lo, hi + 1));
        return;
      }
      // Stale/off-screen anchor (collapsed or deleted): fall through to a plain
      // select that re-anchors, instead of a dead no-op click.
    }
    if (e.ctrlKey || e.metaKey) toggleSelectObject(id);
    else selectObject(id);
    setAnchorId(id);
  };

  const getDragIds = (id: string) => dragBlockIds(objects, selectedIds, id);

  const {
    sensors,
    collisionDetection,
    panelRef,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
    preview,
    activeId,
  } = useLayerDnd({ objects, rows, rowsById, expandedIds, reparentObjects, getDragIds });

  // Cursor pill while dragging: shows the grabbed object (icon + name) and, when
  // it is part of a multi-selection that moves as a block, a `+N` badge. The
  // drop gap still shows where/at which depth it lands.
  const dragObj = activeId ? findObjectById(objects, activeId) : null;
  const dragName =
    dragObj?.name ||
    (dragObj && isGroup(dragObj) ? t.types.group : dragObj ? getEntry(dragObj.type)?.label ?? dragObj.type : '');
  // The block that actually moves (roots), computed once: the +N count and the
  // dimming of every moving row (roots + their descendants), so a block drag
  // doesn't look like a single-row drag where only the grabbed row dims.
  const dragBlock = activeId ? getDragIds(activeId) : null;
  const dragExtra = dragBlock ? dragBlock.length - 1 : 0;
  const draggingIds = (() => {
    if (!dragBlock || dragBlock.length === 0) return null;
    const s = new Set<string>();
    for (const id of dragBlock) {
      const node = findObjectById(objects, id);
      if (node) for (const d of walkObjects([node])) s.add(d.id);
    }
    return s;
  })();

  // Bulk eye/lock acts on the effective selection so it matches the row
  // highlight (an auto-selected group toggles with its members).
  const toggleField = (clickedId: string, field: ToggleField) => {
    const updates = buildBulkToggleUpdates(allNodes, [...effectiveSelected], clickedId, field);
    if (updates.length > 0) updateObjects(updates);
  };

  // Smart "New group" button: prefer grouping the current top-level
  // selection (matches the Ctrl+G shortcut), fall back to creating an
  // empty group at the top so the affordance is also useful before
  // any items exist or have been selected.
  const onNewGroup = () => {
    if (canGroupSelection(objects, selectedIds)) groupSelection();
    else addGroup();
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex items-center justify-end px-2 py-1.5 border-b border-border shrink-0">
        <Tooltip content={t.layers.newGroup}>
          <button
            type="button"
            onClick={onNewGroup}
            aria-label={t.layers.newGroup}
            className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
          >
            <FolderPlusIcon className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>
      {objects.length === 0 ? (
        <div className="p-4 text-center text-muted text-xs mt-6">
          {t.layers.empty}
        </div>
      ) : (
        <SortableContext items={allRowIds} strategy={verticalListSortingStrategy}>
          <div ref={panelRef} className="flex flex-col">
            {rows.map(({ obj, depth, guides, containerId }, i) => {
              const showGap = preview.insertionLineRowId === obj.id;
              const gapDepth = preview.insertionLineDepth ?? depth;
              return (
                <Fragment key={obj.id}>
                  {showGap && preview.insertionLineAbove && <LayerDropGap depth={gapDepth} />}
                  <LayerRow
                    obj={obj}
                    guides={guides}
                    containerId={containerId}
                    isSelected={effectiveSelected.has(obj.id)}
                    isInSelectedGroup={idsUnderSelectedGroup.has(obj.id)}
                    isExpanded={expandedIds.has(obj.id)}
                    isDropTarget={preview.dropIntoTargetId === obj.id}
                    isDimmed={draggingIds?.has(obj.id) ?? false}
                    // The next row leaving a deeper container marks the
                    // boundary: add a small bottom gap so the user sees the
                    // group "close" before the next sibling at the parent
                    // level begins.
                    isContainerEnd={
                      depth > 0 && (rows[i + 1]?.depth ?? -1) < depth
                    }
                    onClick={(e) => handleRowClick(e, obj.id)}
                    onToggleLock={() => toggleField(obj.id, 'locked')}
                    onToggleVisible={() => toggleField(obj.id, 'visible')}
                    onToggleExpand={() => toggleExpand(obj.id)}
                    onUngroup={() => ungroupIds([obj.id])}
                    onRename={(name) => updateObject(obj.id, { name })}
                  />
                  {showGap && !preview.insertionLineAbove && <LayerDropGap depth={gapDepth} />}
                </Fragment>
              );
            })}
          </div>
        </SortableContext>
      )}
      <DragOverlay dropAnimation={null}>
        {dragObj ? (
          <DragChip
            icon={isGroup(dragObj) ? '⊞' : getEntry(dragObj.type)?.icon}
            label={dragName}
            count={dragExtra || undefined}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
