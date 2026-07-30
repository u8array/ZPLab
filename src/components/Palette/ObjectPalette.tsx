import { useRef, useState } from 'react';
import { useDraggable, useDndMonitor, DragOverlay } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { MagnifyingGlassIcon, MinusIcon, PlusIcon } from '@heroicons/react/16/solid';
import { addableGroupsFor } from './paletteGroups';
import { StarGlyph } from './StarGlyph';
import { buildFavoritesAddMenu, buildPaletteRowMenu } from './paletteActions';
import { ContextMenu, type MenuSection } from '../ui/ContextMenu';
import { useContextMenu } from '../../hooks/useContextMenu';
import { resolveAddable, typeLabelFor, type AddableEntry } from '../../registry/palettePresets';
import { getEntry } from '@zplab/core/registry';
import { useT } from '../../hooks/useT';
import { useLabelStore, currentPageLabel } from '../../store/labelStore';
import { printableRectDots } from '@zplab/core/lib/objectBounds';
import { centeredSpawnAnchor } from '../../lib/spawn';
import { DragHandleIcon } from '../ui/DragHandleIcon';
import { DragChip } from '../ui/DragChip';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { inputCls } from '../ui/formStyles';
import { rowDragId, isRowDragId, ROW_PREFIX, CANVAS_DROPPABLE_ID, type PaletteDragData } from '../../dnd/types';
import type { Translations } from '../../locales';
import type { PaletteRow } from '../../store/slices/uiSlice';

/** Curated category label for an entry's subtitle: reuses the registry/group
 *  labels; image reads as its own "Bild" though it shares the `shape` group. */
function typeLabel(typeId: string, t: Translations): string {
  switch (typeId) {
    case 'shape': return t.palette.typeForm;
    case 'code-1d': return t.palette.groupCode1d;
    case 'code-2d': return t.palette.groupCode2d;
    case 'legacy': return t.palette.groupLegacy;
    default: return typeLabelFor(typeId, t);
  }
}

function entryCategory(entry: AddableEntry, t: Translations): string {
  if (entry.type === 'image') return typeLabel('image', t);
  return typeLabel(getEntry(entry.type)?.group ?? entry.type, t);
}

/** Drop an entry centred on the visible (printable) label area, which ^LS can
 *  shift off the physical center (double-click / "no drag" path). Shares
 *  centeredSpawnAnchor with the drag path, so both gestures land the same way
 *  and honour the spawn rotation of a rotated canvas view. */
function spawnCentered(entry: AddableEntry) {
  const state = useLabelStore.getState();
  // Current page's dot scale: addObject writes into it, so a jm-diverged page
  // must not size/place against the design label.
  const label = currentPageLabel(state);
  const r = printableRectDots(label);
  const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const pos = centeredSpawnAnchor(entry.type, entry.propsOverride, at, label, state.canvasSettings.viewRotation);
  if (pos) state.addObject(entry.type, pos, entry.propsOverride);
}

const rowBodyCls =
  'group flex items-center gap-2 px-1.5 py-1.5 rounded border border-transparent hover:border-border-2 hover:bg-surface-2 hover:-translate-y-px cursor-grab active:cursor-grabbing select-none transition';

function IconSlot({ entry }: { entry: AddableEntry }) {
  const showZpl = useLabelStore((s) => s.showZplCommands);
  // Fixed-width slot so toggling glyph vs command badge never shifts the label.
  return (
    <span className="w-8 shrink-0 flex justify-center">
      {showZpl && entry.zplCmd ? (
        <span className="bg-accent-dim text-accent font-mono text-[10px] leading-none rounded px-1 py-0.5">{entry.zplCmd}</span>
      ) : (
        <span className="font-mono text-[11px] text-muted group-hover:text-accent transition-colors">{entry.icon}</span>
      )}
    </span>
  );
}

/** Favorites pin toggle, only on search results (kept out of flat browse so the
 *  list stays calm). Subscribes per-row, so it lives behind the `pinnable` gate. */
function PinButton({ entryId }: { entryId: string }) {
  const t = useT();
  const pinned = useLabelStore((s) => s.paletteRows.some((r) => r.entryId === entryId));
  const toggleRow = useLabelStore((s) => s.togglePaletteRow);
  const label = pinned ? t.palette.unpinFromFavorites : t.palette.pinToFavorites;
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      // Stop the dblclick too, else a quick double-tap on the star bubbles to the
      // row's onDoubleClick and spawns a stray object on the canvas.
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); toggleRow(entryId); }}
      className={`ml-auto shrink-0 p-0.5 rounded ${pinned ? 'text-accent' : 'text-muted hover:text-text'}`}
    >
      <StarGlyph filled={pinned} className="w-3.5 h-3.5" />
    </button>
  );
}

/** Browse/search row: whole row drags onto the canvas (no grip). Search results
 *  show a pin star (`pinnable`); flat browse stays bare. */
function BrowseRow({ entry, dragId, cat, pinnable, onOpenMenu }: {
  entry: AddableEntry;
  dragId: string;
  cat?: string;
  pinnable?: boolean;
  onOpenMenu: (e: React.MouseEvent, entry: AddableEntry) => void;
}) {
  // Only the pointer `listeners` go on the row, not dnd-kit `attributes`: those
  // set role="button"/tabIndex on the row, which would wrap the nested pin button
  // in a button (invalid) and promise keyboard drag we don't wire (PointerSensor).
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `pal-${dragId}`,
    data: { type: entry.type, propsOverride: entry.propsOverride, entryId: entry.id } satisfies PaletteDragData,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      onDoubleClick={() => spawnCentered(entry)}
      onContextMenu={(e) => onOpenMenu(e, entry)}
      style={{ touchAction: 'pan-y' }}
      className={`${rowBodyCls} ${isDragging ? 'opacity-40' : ''}`}
    >
      <IconSlot entry={entry} />
      <span className="flex flex-col min-w-0 leading-tight">
        <span className="text-xs text-text truncate">{entry.label}</span>
        {cat && <span className="font-mono text-[9px] text-muted truncate">{cat}</span>}
      </span>
      {pinnable && <PinButton entryId={entry.id} />}
    </div>
  );
}

/** Favorites row: one concrete object. Normal mode the whole row drags onto the
 *  canvas; edit mode shows a left grip (reorder handle) and a right remove button. */
function FavoriteRow({ row, index, editing, onOpenMenu }: {
  row: PaletteRow;
  index: number;
  editing: boolean;
  onOpenMenu: (e: React.MouseEvent, entry: AddableEntry) => void;
}) {
  const t = useT();
  const removeRow = useLabelStore((s) => s.removePaletteRow);
  const entry = resolveAddable(row.entryId, t);
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: rowDragId(row.id),
    data: { type: entry?.type ?? row.entryId, propsOverride: entry?.propsOverride, entryId: row.entryId } satisfies PaletteDragData,
  });
  if (!entry) return null;
  // Keep the active row in place (only neighbours shift); a pointer-following
  // transform would overflow the scroll container and add an x-scrollbar.
  const style = {
    transform: isDragging || !transform ? undefined : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-40' : ''}>
      {/* The whole row is the drag handle in both modes: normal spawns on the
          canvas, edit reorders. The edit-mode grip is just a visual affordance,
          so grabbing the text reorders too. */}
      <div
        ref={setActivatorNodeRef}
        {...listeners}
        onDoubleClick={editing ? undefined : () => spawnCentered(entry)}
        onContextMenu={editing ? undefined : (e) => onOpenMenu(e, entry)}
        style={{ touchAction: 'pan-y' }}
        className={`${rowBodyCls} ${editing ? 'bg-surface-2 border-border-2 hover:-translate-y-0' : ''}`}
      >
        {editing && (
          <span aria-hidden className="-mr-1 shrink-0 text-muted">
            <DragHandleIcon className="w-2 h-3.5" />
          </span>
        )}
        <IconSlot entry={entry} />
        <span className="flex flex-col min-w-0 leading-tight">
          <span className="text-xs text-text truncate">{entry.label}</span>
          <span className="font-mono text-[9px] text-muted truncate">{entryCategory(entry, t)}</span>
        </span>
        {editing && (
          <button
            type="button"
            aria-label={t.palette.removeRow}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); removeRow(index); }}
            className="ml-auto shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded-full bg-error text-white hover:opacity-80 transition-opacity"
          >
            <MinusIcon className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Entry-count badge shown beside a group title. */
function GroupTitle({ label, count }: { label: string; count: number }) {
  return (
    <>
      {label}
      <span className="ml-1.5 normal-case font-normal text-muted">{count}</span>
    </>
  );
}

export function ObjectPalette() {
  const t = useT();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const rows = useLabelStore((s) => s.paletteRows);
  const view = useLabelStore((s) => s.paletteView);
  const editing = useLabelStore((s) => s.paletteEditing);
  const toggleRow = useLabelStore((s) => s.togglePaletteRow);
  const reorderRows = useLabelStore((s) => s.reorderPaletteRows);
  const [activeEntry, setActiveEntry] = useState<AddableEntry | null>(null);
  const [overCanvas, setOverCanvas] = useState(false);
  const { menu, openAtPointer, openBelowAnchor, close } = useContextMenu<MenuSection[]>();
  const q = query.trim().toLowerCase();

  const openRowMenu = (e: React.MouseEvent, entry: AddableEntry) => {
    e.preventDefault();
    const sections = buildPaletteRowMenu({
      pinned: rows.some((r) => r.entryId === entry.id),
      labels: {
        addToLabel: t.palette.addToLabel,
        pinToFavorites: t.palette.pinToFavorites,
        unpinFromFavorites: t.palette.unpinFromFavorites,
      },
      dispatch: {
        addToLabel: () => spawnCentered(entry),
        togglePin: () => toggleRow(entry.id),
      },
    });
    openAtPointer(e, sections);
  };

  const openAddMenu = (e: React.MouseEvent) => {
    const groups = addableGroupsFor(t).map((g) => ({
      id: g.key,
      label: g.label,
      entries: g.entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        pinned: rows.some((r) => r.entryId === entry.id),
      })),
    }));
    if (!groups.some((g) => g.entries.some((e) => !e.pinned))) return; // everything already pinned
    openBelowAnchor(e.currentTarget, buildFavoritesAddMenu(groups, toggleRow));
  };

  // Track the dragged entry for the overlay chip, and reorder favorites on drop.
  // Over the canvas the chip is hidden so the canvas's own ghost (the real
  // element at drop size) is the only preview. A favorites reorder still shows
  // the chip (like the layers tree) for tactile feedback while neighbours shift.
  // Normal-mode row drags spawn on canvas (LabelCanvas's monitor).
  useDndMonitor({
    onDragStart({ active }) {
      const data = active.data.current as PaletteDragData | undefined;
      setActiveEntry(data?.entryId ? resolveAddable(data.entryId, t) : null);
      setOverCanvas(false);
    },
    onDragOver({ over }) {
      setOverCanvas(over?.id === CANVAS_DROPPABLE_ID);
    },
    onDragCancel() { setActiveEntry(null); setOverCanvas(false); },
    onDragEnd({ active, over }) {
      setActiveEntry(null);
      setOverCanvas(false);
      if (!editing) return;
      const a = String(active.id);
      const o = over ? String(over.id) : '';
      if (!isRowDragId(a) || !isRowDragId(o) || a === o) return;
      reorderRows(a.slice(ROW_PREFIX.length), o.slice(ROW_PREFIX.length));
    },
  });

  // Flat list across every group (registry types + presets); the basis for both
  // flat mode and search.
  const flatGroups = addableGroupsFor(t)
    .map((g) => ({ ...g, entries: g.entries.filter((e) => !q || e.label.toLowerCase().includes(q)) }))
    .filter((g) => g.entries.length > 0);
  const resultCount = flatGroups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 bg-surface border-b border-border px-2 pt-3 pb-2 flex flex-col gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
          <input
            ref={searchRef}
            type="search"
            className={`${inputCls} pl-7`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.palette.searchPlaceholder}
            aria-label={t.palette.searchPlaceholder}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 pt-2 flex flex-col gap-3">
        {q ? (
          resultCount === 0 ? (
            <p className="text-xs text-muted px-1">{t.palette.noResults.replace('{q}', () => query.trim())}</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              <p className="px-1 pb-0.5 font-mono text-[9px] text-muted">{t.palette.resultsFmt.replace('{n}', String(resultCount))}</p>
              {flatGroups.flatMap(({ key, entries }) =>
                entries.map((e) => (
                  <BrowseRow key={`${key}-${e.id}`} entry={e} dragId={`search-${key}-${e.id}`} cat={entryCategory(e, t)} pinnable onOpenMenu={openRowMenu} />
                )),
              )}
            </div>
          )
        ) : view === 'favorites' ? (
          <>
            <SortableContext items={rows.map((r) => rowDragId(r.id))} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-0.5">
                {rows.map((r, i) => (
                  <FavoriteRow key={r.id} row={r} index={i} editing={editing} onOpenMenu={openRowMenu} />
                ))}
              </div>
            </SortableContext>
            {/* Edit mode only (plus the empty state, which otherwise has no
                entry point at all). */}
            {(editing || rows.length === 0) && (
              <button
                type="button"
                onClick={openAddMenu}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 w-full rounded text-xs font-mono border border-dashed border-border text-muted hover:text-text hover:border-border-2 transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                {t.palette.addObjectButton}
              </button>
            )}
          </>
        ) : (
          flatGroups.map(({ key, label, entries }) => (
            <CollapsibleSection
              key={key}
              id={`palette-${key}`}
              title={<GroupTitle label={label} count={entries.length} />}
            >
              {entries.map((e) => (
                <BrowseRow key={`${key}-${e.id}`} entry={e} dragId={`flat-${key}-${e.id}`} onOpenMenu={openRowMenu} />
              ))}
            </CollapsibleSection>
          ))
        )}
      </div>

      {/* Drag chip under the cursor, hidden only over the canvas (where the
          canvas renders its own full-size ghost). Shown for favorites reorder. */}
      <DragOverlay>{activeEntry && !overCanvas ? <DragChip icon={activeEntry.icon} label={activeEntry.label} /> : null}</DragOverlay>

      {menu && <ContextMenu sections={menu.data} x={menu.x} y={menu.y} onClose={close} />}
    </div>
  );
}
