import { useT } from "../../hooks/useT";
import { Tooltip } from "../ui/Tooltip";
import { JUSTIFY_ICONS, type Justify } from "./justifyIcons";

interface Props {
  value: Justify;
  onChange: (next: Justify) => void;
}

/** ^FB text-justification toggle: 4 icon buttons (left / centre /
 *  right / justified); same MS Word pattern users already know.
 *  Replaces the legacy `<select>` so picking takes a single click
 *  and the active mode is visually obvious at a glance. */
export function JustifyButtons({ value, onChange }: Props) {
  const t = useT();
  const items: { v: Justify; title: string }[] = [
    { v: "L", title: t.registry.text.justifyL },
    { v: "C", title: t.registry.text.justifyC },
    { v: "R", title: t.registry.text.justifyR },
    { v: "J", title: t.registry.text.justifyJ },
  ];
  return (
    <div className="flex gap-1" role="group" aria-label={t.registry.text.blockJustify}>
      {items.map(({ v, title }) => {
        const active = value === v;
        return (
          <Tooltip key={v} content={title}>
            <button
              type="button"
              aria-label={title}
              aria-pressed={active}
              onClick={() => onChange(v)}
              className={`w-7 h-6 flex items-center justify-center rounded border transition-colors ${
                active
                  ? "border-accent bg-accent-dim text-accent"
                  : "border-border text-muted hover:text-text hover:bg-surface-2"
              }`}
            >
              {JUSTIFY_ICONS[v]}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
