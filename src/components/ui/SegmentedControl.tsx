import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';

/**
 * Segmented button group for small enums (the three-tier rule's "≤3-4 options"
 * tier). Replaces a `<select>` so the choice is one click and the active value
 * is obvious. `defaultLabel`, when set, adds a leading segment that selects
 * `undefined` (the "use printer default / unset" state).
 */
interface SegmentedControlProps<T extends string> {
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  /** `icon`, when set, renders in place of the text; `label` is then the
   *  accessible name (aria-label) so the button stays announceable. */
  options: { value: T; label: string; disabled?: boolean; tooltip?: string; icon?: ReactNode }[];
  /** When provided, a leading segment selects `undefined` (unset/default). */
  defaultLabel?: string;
  'aria-label'?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  defaultLabel,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const segments: { value: T | undefined; label: string; disabled?: boolean; tooltip?: string; icon?: ReactNode }[] =
    defaultLabel !== undefined
      ? [{ value: undefined, label: defaultLabel }, ...options]
      : options;
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-1">
      {segments.map((seg) => {
        const active = value === seg.value;
        // Tooltip is a no-op for falsy content, so unflagged segments stay bare
        // buttons; flex-1 sits on the wrapper so widths match either way.
        return (
          <Tooltip key={seg.value ?? '__default'} content={seg.tooltip} className="flex-1">
            <button
              type="button"
              aria-pressed={active}
              aria-label={seg.icon ? seg.label : undefined}
              disabled={seg.disabled}
              onClick={() => onChange(seg.value)}
              className={`flex-1 whitespace-nowrap px-2 py-1 rounded border text-xs transition-colors ${
                seg.icon ? 'flex items-center justify-center' : ''
              } ${
                seg.disabled
                  ? 'border-border text-muted opacity-50 cursor-not-allowed'
                  : active
                    ? 'border-accent bg-accent-dim text-accent'
                    : 'border-border text-muted hover:text-text hover:bg-surface-2'
              }`}
            >
              {seg.icon ?? seg.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
