import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import {
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
  LockOpenIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  LinkSlashIcon,
  ViewColumnsIcon,
  VariableIcon,
} from '@heroicons/react/16/solid';
import { getEntry } from '@zplab/core/registry';
import { isGroup, type LabelObject } from '@zplab/core/types/Group';
import { useT } from '../../hooks/useT';
import { useLabelStore } from '../../store/labelStore';
import { fieldVariableRefs } from '@zplab/core/lib/variableField';
import { DragHandleIcon } from '../ui/DragHandleIcon';
import { Tooltip } from '../ui/Tooltip';
import { INDENT_STEP } from './layerLayout';
import type { GuideKind } from './useLayerDnd';

export interface LayerRowProps {
  obj: LabelObject;
  containerId: string;
  /** Connector-guide columns, outermost-first (length === depth). */
  guides: GuideKind[];
  isSelected: boolean;
  /** True for any leaf or sub-group that lives under a currently-selected
   *  group. Drives the soft tint that signals "I move with the group". */
  isInSelectedGroup: boolean;
  isExpanded: boolean;
  /** Highlight the row body; used for "drop into this group". */
  isDropTarget: boolean;
  /** Dim the row because it (or its ancestor) is part of the dragged block. */
  isDimmed: boolean;
  /** Add a small bottom gap because the next row in display order leaves
   *  this row's container (depth drops). Visually closes the group. */
  isContainerEnd: boolean;
  /** Row click; the panel reads modifier keys for range/toggle/replace select. */
  onClick: (e: React.MouseEvent) => void;
  onToggleLock: () => void;
  onToggleVisible: () => void;
  onToggleExpand: () => void;
  onUngroup: () => void;
  /** Absent where the row has no repeat to show; without `onToggle` it only shows the mark. */
  repeat?: { active: boolean; onToggle?: () => void };
  /** Commit the new name; empty string clears it back to the default. */
  onRename: (name: string | undefined) => void;
}

export function LayerRow({
  obj,
  guides,
  containerId,
  isSelected,
  isInSelectedGroup,
  isExpanded,
  isDropTarget,
  isDimmed,
  isContainerEnd,
  onClick,
  onToggleLock,
  onToggleVisible,
  onToggleExpand,
  onUngroup,
  repeat,
  onRename,
}: LayerRowProps) {
  const t = useT();
  const def = getEntry(obj.type);
  const groupRow = isGroup(obj);
  // Variable badge: small {x} glyph next to the type icon when the leaf
  // references a variable, single-bind or embedded in template content, with
  // the names as a tooltip. Lets the user scan the layers list for slot usage
  // without selecting each row. A joined-string selector keeps the subscription
  // stable (a fresh array every render would defeat the store's equality gate).
  const boundNames = useLabelStore((s) =>
    fieldVariableRefs(obj, s.variables).map((v) => v.name).join(', '),
  );
  // Inline-rename is exposed only for groups; leaves render their
  // registry label as a non-editable span. The single groupRow check at
  // the entry-point keeps the rest of the edit path free of guards.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Cancellation flag so the blur that fires when the input unmounts
  // on Escape doesn't sneak through commitEdit and persist the draft
  // the user wanted to discard.
  const cancellingRef = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const beginEdit = () => {
    cancellingRef.current = false;
    setDraft(obj.name ?? '');
    setEditing(true);
  };
  const commitEdit = () => {
    if (cancellingRef.current) return;
    const trimmed = draft.trim();
    if ((obj.name ?? '') !== trimmed) onRename(trimmed || undefined);
    setEditing(false);
  };
  const cancelEdit = () => {
    cancellingRef.current = true;
    setEditing(false);
  };
  const defaultLabel = groupRow ? t.types.group : (def?.label ?? obj.type);
  const displayName = obj.name ?? defaultLabel;
  // Show the child count next to a collapsed group's name so the user can
  // judge what's inside without expanding. Hidden while expanded (the
  // count is visible as actual rows) and while editing (the input would
  // otherwise prefill with the count too).
  const childCount = groupRow ? obj.children.length : 0;
  const showCount = groupRow && !isExpanded && childCount > 0 && !editing;
  const labelText = showCount ? `${displayName} · ${childCount}` : displayName;
  const isLocked = !!obj.locked;
  const isHidden = obj.visible === false;
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: obj.id,
    data: { containerId },
    disabled: isLocked,
  });
  const stopRowClick = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      ref={setNodeRef}
      style={{ touchAction: 'none' }}
      {...attributes}
      {...(isLocked ? {} : listeners)}
      onClick={onClick}
      className={`
        relative flex items-center gap-2 pr-2 py-1.5
        ${isLocked ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}
        group transition hover:bg-surface-2 hover:shadow-[inset_0_0_0_1px_var(--color-border-2)]
        ${isSelected ? 'bg-surface-2 border-l-2 border-l-accent' : 'border-l-2 border-l-transparent'}
        ${isInSelectedGroup && !isSelected ? 'bg-accent/5' : ''}
        ${isDragging || isDimmed ? 'opacity-40' : ''}
        ${isHidden ? 'opacity-50' : ''}
        ${isDropTarget ? 'bg-accent/15 outline outline-1 outline-accent/60' : ''}
        ${isContainerEnd ? 'mb-1' : ''}
      `}
    >
      <DragHandleIcon
        className={`ml-0.5 w-2 h-3.5 shrink-0 text-muted transition-opacity ${isLocked ? 'opacity-0' : 'opacity-0 group-hover:opacity-60'}`}
      />
      {groupRow ? (
        <Tooltip content={isExpanded ? t.app.collapse : t.app.expand}>
          <button
            type="button"
            onPointerDown={stopRowClick}
            onClick={(e) => { stopRowClick(e); onToggleExpand(); }}
            aria-label={isExpanded ? t.app.collapse : t.app.expand}
            aria-expanded={isExpanded}
            className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-text hover:bg-surface shrink-0"
          >
            {isExpanded
              ? <ChevronDownIcon className="w-3 h-3" />
              : <ChevronRightIcon className="w-3 h-3" />}
          </button>
        </Tooltip>
      ) : (
        <span className="w-4 h-4 shrink-0" />
      )}
      {/* Drawn after the grip+disclosure gutter so a child's elbow points at its
          parent's object icon, not the chevron. One 16px column per ancestor
          level; the kinds (line/tee/last/empty) are documented on GuideKind. */}
      {guides.length > 0 && (
        <div className="flex self-stretch shrink-0" aria-hidden>
          {guides.map((g, i) => (
            <span key={i} className="relative self-stretch shrink-0" style={{ width: INDENT_STEP }}>
              {(g === 'line' || g === 'tee') && (
                <span className="absolute top-0 bottom-0 border-l" style={{ left: 7, borderColor: 'var(--color-guide)' }} />
              )}
              {g === 'last' && (
                <span className="absolute top-0 border-l" style={{ left: 7, height: '51%', borderColor: 'var(--color-guide)' }} />
              )}
              {(g === 'tee' || g === 'last') && (
                <span className="absolute border-t" style={{ left: 7, right: 1, top: '50%', borderColor: 'var(--color-guide)' }} />
              )}
            </span>
          ))}
        </div>
      )}
      <span className="font-mono text-xs text-accent shrink-0 w-4 text-center whitespace-nowrap">
        {groupRow ? '⊞' : def?.icon}
      </span>
      {boundNames && (
        <Tooltip content={t.variables.badgeBoundFmt.replace('{name}', boundNames)}>
          <VariableIcon className="w-3 h-3 shrink-0 text-accent/70" />
        </Tooltip>
      )}
      <div className="flex flex-col flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              else if (e.key === 'Escape') cancelEdit();
            }}
            onClick={stopRowClick}
            onPointerDown={stopRowClick}
            placeholder={defaultLabel}
            className="text-xs text-text bg-surface-2 border border-border rounded px-1 py-0 -my-0.5 focus:border-accent focus:outline-none w-full"
          />
        ) : (
          <span
            className={`text-xs text-text truncate ${groupRow ? 'font-medium' : ''}`}
            onDoubleClick={groupRow ? (e) => { e.stopPropagation(); beginEdit(); } : undefined}
            title={groupRow ? t.layers.rename : undefined}
          >
            {labelText}
          </span>
        )}
      </div>
      {repeat && (
        <Tooltip content={repeat.active && repeat.onToggle ? t.layers.stopRepeating : t.layers.repeatOnLabels}>
          <button
            type="button"
            onPointerDown={stopRowClick}
            onClick={(e) => { stopRowClick(e); repeat.onToggle?.(); }}
            disabled={!repeat.onToggle}
            aria-label={t.layers.repeatOnLabels}
            aria-pressed={repeat.active}
            className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${repeat.active ? 'text-accent' : 'text-muted opacity-0 group-hover:opacity-100'} hover:text-text hover:bg-surface`}
          >
            <ViewColumnsIcon className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      )}
      {groupRow && (
        <Tooltip content={t.layers.ungroup}>
          <button
            type="button"
            onPointerDown={stopRowClick}
            onClick={(e) => { stopRowClick(e); onUngroup(); }}
            aria-label={t.layers.ungroup}
            className="w-5 h-5 flex items-center justify-center rounded transition-colors text-muted opacity-0 group-hover:opacity-100 hover:text-text hover:bg-surface"
          >
            <LinkSlashIcon className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      )}
      <Tooltip content={isHidden ? t.layers.show : t.layers.hide}>
        <button
          type="button"
          onPointerDown={stopRowClick}
          onClick={(e) => { stopRowClick(e); onToggleVisible(); }}
          aria-label={isHidden ? t.layers.show : t.layers.hide}
          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${isHidden ? 'text-accent' : 'text-muted opacity-0 group-hover:opacity-100'} hover:text-text hover:bg-surface`}
        >
          {isHidden ? <EyeSlashIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
        </button>
      </Tooltip>
      <Tooltip content={isLocked ? t.layers.unlock : t.layers.lock}>
        <button
          type="button"
          onPointerDown={stopRowClick}
          onClick={(e) => { stopRowClick(e); onToggleLock(); }}
          aria-label={isLocked ? t.layers.unlock : t.layers.lock}
          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${isLocked ? 'text-accent' : 'text-muted opacity-0 group-hover:opacity-100'} hover:text-text hover:bg-surface`}
        >
          {isLocked ? <LockClosedIcon className="w-3.5 h-3.5" /> : <LockOpenIcon className="w-3.5 h-3.5" />}
        </button>
      </Tooltip>
    </div>
  );
}
