import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import {
  Listbox,
  ListboxButton,
  ListboxOptions,
  ListboxOption,
} from '@headlessui/react';
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/16/solid';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  /** Mono value shown right of the label (e.g. a font id or `~DY`). The real
   *  parameter that goes into the ZPL command, not the command name. */
  badge?: string;
  /** Optional leading glyph (e.g. a file icon for uploaded fonts). */
  icon?: ReactNode;
  /** Not selectable in the current state (e.g. a symbol size too small for
   *  the content); still listed so the choice space stays visible. */
  disabled?: boolean;
  /** Why the option is disabled, shown as a native title on hover (mirrors
   *  SegmentedControl's per-option tooltip). */
  tooltip?: string;
}

export interface SelectGroup<T extends string | number> {
  /** Section header; omit for an ungrouped list. */
  label?: string;
  options: SelectOption<T>[];
}

interface SelectProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  groups: SelectGroup<T>[];
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
  /** The focused option, or null once the list closes. */
  onHoverOption?: (value: T | null) => void;
}

const triggerCls =
  'flex items-center gap-2 w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs font-mono text-text text-left data-[focus]:border-accent focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed';
const badgeCls = 'font-mono text-[10px] shrink-0';

/**
 * Custom listbox select with two-column options (label left, mono value badge
 * right) and optional section headers. Closed trigger matches the native
 * `inputCls` fields; the open list uses theme tokens (native `<option>` can't).
 * Accessibility (keyboard, type-ahead, focus, ARIA) comes from Headless UI.
 */
export function Select<T extends string | number>({
  value,
  onChange,
  groups,
  id,
  disabled,
  'aria-label': ariaLabel,
  onHoverOption,
}: SelectProps<T>) {
  const selected = groups.flatMap((g) => g.options).find((o) => o.value === value);
  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <ListboxButton id={id} className={triggerCls} aria-label={ariaLabel}>
        <span className="truncate flex-1">{selected?.label ?? ''}</span>
        {selected?.badge && <span className={`${badgeCls} text-muted`}>{selected.badge}</span>}
        <ChevronDownIcon className="w-3 h-3 shrink-0 text-muted" />
      </ListboxButton>
      <ListboxOptions
        anchor="bottom start"
        className="w-(--button-width) [--anchor-gap:4px] max-h-60 overflow-auto rounded border border-border-2 bg-surface shadow-lg z-50 py-1 focus:outline-none"
        onMouseLeave={() => onHoverOption?.(null)}
      >
        {onHoverOption && <HoverEnd onEnd={onHoverOption} />}
        {groups.map((group, gi) => (
          <Fragment key={group.label ?? gi}>
            {group.label && (
              <div className="px-2 pt-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                {group.label}
              </div>
            )}
            {group.options.map((opt) => (
              <ListboxOption
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                title={opt.tooltip}
                className="flex items-center gap-2 px-2 py-1 cursor-pointer text-xs text-text data-[focus]:bg-surface-2 data-[selected]:bg-accent-dim data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
              >
                {({ selected: isSel, focus }) => (
                  <>
                    {onHoverOption && <HoverStart active={focus} onStart={() => onHoverOption(opt.value)} />}
                    <CheckIcon
                      className={`w-3 h-3 shrink-0 ${isSel ? 'text-accent' : 'invisible'}`}
                    />
                    {opt.icon}
                    <span className="truncate flex-1">{opt.label}</span>
                    {opt.badge && (
                      <span className={`${badgeCls} ${isSel ? 'text-accent' : 'text-muted'}`}>
                        {opt.badge}
                      </span>
                    )}
                  </>
                )}
              </ListboxOption>
            ))}
          </Fragment>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}

// Headless UI marks the option under the pointer or the arrow keys as focused, so one signal serves both.
function HoverStart({ active, onStart }: { active: boolean; onStart: () => void }) {
  const latest = useRef(onStart);
  useEffect(() => {
    latest.current = onStart;
  });
  useEffect(() => {
    if (active) latest.current();
  }, [active]);
  return null;
}

// The options unmount when the list closes, with or without a choice.
function HoverEnd<T extends string | number>({ onEnd }: { onEnd: (value: T | null) => void }) {
  const latest = useRef(onEnd);
  useEffect(() => {
    latest.current = onEnd;
  });
  useEffect(() => () => latest.current(null), []);
  return null;
}
