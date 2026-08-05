import { useRef, useState } from 'react';
import { clampMin } from '@zplab/core/lib/inputParse';
import { inputCls } from './styles';
import { FieldLabel } from './ZplCmd';

interface NumberInputProps {
  label: string;
  value: number;
  /** When set, the change handler receives a value clamped to at least `min`,
   *  guarding against the empty/0 input collapse that bare Number() invites. */
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  readOnly?: boolean;
  /** Optional ZPL command this field emits; shown as a tag when the
   *  showZplCommands preference is on. */
  zplCmd?: string;
  /** Replaces the cell layout entirely (not merged), e.g. `fieldGridCell` for
   *  subgrid; omit for the default flex column. */
  className?: string;
}

/**
 * Standard label + number input pair used by registry properties panels.
 * Centralises the layout, the labelCls/inputCls coupling, and the
 * empty-or-NaN-to-min sanitisation so individual registries don't repeat
 * the boilerplate.
 */
export function NumberInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  readOnly,
  zplCmd,
  className,
}: NumberInputProps) {
  // Raw keystrokes stay in `draft` while focused so an intermediate "2." or
  // out-of-range "25" is not snapped mid-typing; only changed in-range values
  // commit live, blur clamp-commits the canonical value.
  const [draft, setDraft] = useState<string | null>(null);
  // Last value this input itself put into the store; a differing prop at
  // blur time means an external update (undo, rescale) raced the draft,
  // which must then be discarded instead of clobbering the newer state.
  const selfValue = useRef<number | null>(null);
  const clampFull = (n: number): number => {
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  };
  return (
    <div className={className ?? 'flex flex-col gap-1'}>
      <FieldLabel cmd={zplCmd}>{label}</FieldLabel>
      <input
        type="number"
        className={inputCls}
        value={draft ?? value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => {
          const raw = e.target.value;
          if (draft === null) selfValue.current = value;
          setDraft(raw);
          const next = Number(raw);
          if (raw.trim() === '' || isNaN(next)) return;
          if (clampFull(next) === next && next !== value) {
            selfValue.current = next;
            onChange(next);
          }
        }}
        onBlur={() => {
          if (draft !== null && selfValue.current === value) {
            const next = min !== undefined ? clampMin(draft, min) : Number(draft);
            // Skip the no-op re-commit: the store snapshots every write, so
            // an equal value would land a duplicate undo step.
            if (!isNaN(next) && clampFull(next) !== value) onChange(clampFull(next));
          }
          setDraft(null);
          selfValue.current = null;
        }}
      />
    </div>
  );
}
