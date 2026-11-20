import { useRef, useState } from "react";
import type { StageRulerGuide } from "../../lib/rulerGuides";
import { guideBadgeOrigin } from "./rulerGuideLayout";

interface Props {
  at: StageRulerGuide;
  value: number;
  unit: string;
  label: string;
  /** Called with the typed value, or null when the edit is dropped. */
  onEnd: (value: number | null) => void;
}

/** The typed position of a guide, shown in place of its badge. */
export function RulerGuideInput({ at, value, unit, label, onEnd }: Props) {
  const shown = String(value);
  const [draft, setDraft] = useState(shown);
  // Escape and Enter unmount the field, and the browser may still fire a blur after that.
  const endedRef = useRef(false);

  const end = (keep: boolean) => {
    if (endedRef.current) return;
    endedRef.current = true;
    const typed = Number(draft);
    // The shown value is rounded, so taking it back unchanged would move the guide.
    onEnd(keep && draft !== shown && draft.trim() !== "" && Number.isFinite(typed) ? typed : null);
  };

  const { x, y } = guideBadgeOrigin(at);
  return (
    <label
      className="absolute z-20 flex items-center gap-1 rounded border border-accent bg-surface-2 px-1 font-mono text-[10px] text-muted"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        type="number"
        step="any"
        aria-label={`${label} (${unit})`}
        autoFocus
        className="w-14 bg-transparent py-0.5 text-text outline-none"
        value={draft}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => end(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") end(true);
          if (e.key === "Escape") end(false);
        }}
      />
      {unit}
    </label>
  );
}
