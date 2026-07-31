import { useState } from 'react';
import { useLabelStore, currentPageLabel } from '../../store/labelStore';
import { inputCls } from './styles';
import { FieldLabel } from './ZplCmd';
import { mmToUnit, unitToMm, unitLabel, unitStep } from '@zplab/core/lib/units';
import { dotsToMm, mmToDots } from '@zplab/core/lib/coordinates';
import { effectiveDpmm } from '@zplab/core/types/LabelConfig';

interface UnitNumberInputProps {
  label: string;
  /** Stored value, in dots; undefined renders an empty field when allowUnset. */
  valueDots: number | undefined;
  onChangeDots: (next: number | undefined) => void;
  /** Minimum, in dots (clamped after conversion). */
  minDots?: number;
  /** Maximum, in dots (clamped after conversion). */
  maxDots?: number;
  /** Allow clearing the field to emit undefined (optional props). */
  allowUnset?: boolean;
  disabled?: boolean;
  zplCmd?: string;
  /** Replaces the cell layout (e.g. fieldGridCell); omit for the default column. */
  className?: string;
  /** Density scope for the dots: 'page' object props (page ^JM-scaled), 'design'
   *  the label's own scale (a page ^JM must not reinterpret it), 'physical' raw
   *  head dots (^PW/^LL, never ^JM-scaled). Required so every call site decides. */
  scope: 'page' | 'design' | 'physical';
}

/**
 * Number input for a length stored in dots but shown/edited in the active unit
 * (mm/cm/in); the `(unit)` suffix is appended to the label, the store stays dots.
 *
 * While focused it holds a raw draft string; clamp/round happens on blur. Without
 * this, sub-display-step fields (e.g. line thickness) snapped back each keystroke.
 */
export function UnitNumberInput({
  label,
  valueDots,
  onChangeDots,
  minDots,
  maxDots,
  allowUnset,
  disabled,
  zplCmd,
  className,
  scope,
}: UnitNumberInputProps) {
  const unit = useLabelStore((s) => s.canvasSettings.unit);
  const dpmm = useLabelStore((s) => {
    // physical: raw head dpmm, never ^JM-halved effective scale.
    if (scope === 'physical') return s.label.dpmm;
    return effectiveDpmm(scope === 'design' ? s.label : currentPageLabel(s));
  });
  const toUnit = (dots: number) => mmToUnit(dotsToMm(dots, dpmm), unit);
  // null = not editing; show the canonical store value. Otherwise show the raw
  // keystrokes verbatim so the input never fights the user mid-entry.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    if (raw.trim() === '') {
      if (allowUnset) onChangeDots(undefined);
      return;
    }
    let dots = mmToDots(unitToMm(Number(raw), unit), dpmm);
    if (isNaN(dots)) return;
    if (minDots !== undefined && dots < minDots) dots = minDots;
    if (maxDots !== undefined && dots > maxDots) dots = maxDots;
    onChangeDots(Math.round(dots));
  };

  // Canonical (not-editing) display: the store value in the active unit.
  const canonical = valueDots === undefined ? '' : String(toUnit(valueDots));
  const display = draft !== null ? draft : canonical;

  return (
    <div className={className ?? 'flex flex-col gap-1'}>
      <FieldLabel cmd={zplCmd}>{`${label} (${unitLabel(unit)})`}</FieldLabel>
      <input
        type="number"
        className={inputCls}
        value={display}
        min={minDots !== undefined ? toUnit(minDots) : undefined}
        max={maxDots !== undefined ? toUnit(maxDots) : undefined}
        step={unitStep(unit)}
        disabled={disabled}
        onFocus={() => setDraft(canonical)}
        onChange={(e) => {
          // Keep raw keystrokes in `draft` (no snap-back) but commit live so the
          // canvas tracks; commit clamps without touching `draft`.
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        // Drop the draft on blur so the field re-renders the canonical, clamped
        // value in the active unit.
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}
