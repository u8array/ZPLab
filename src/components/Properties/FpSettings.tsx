import type { ReactNode } from "react";
import { useT } from "../../hooks/useT";
import { Tooltip } from "../ui/Tooltip";
import { labelCls } from "./styles";
import { UnitNumberInput } from "./UnitNumberInput";
import type { TextProps } from "@zplab/core/registry/text";

type FpDir = NonNullable<TextProps["fpDirection"]>;

interface Props {
  props: TextProps;
  onChange: (patch: Partial<TextProps>) => void;
}

/** Mirrors Material Symbols' `format_textdirection_*` idiom; strokes
 *  use `currentColor` so the active-state token drives them. */
const ICONS: Record<FpDir, ReactNode> = {
  H: (
    <svg viewBox="0 0 16 12" className="w-4 h-3 mx-auto" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" aria-hidden="true">
      <line x1="2" y1="2.5" x2="11" y2="2.5" />
      <line x1="2" y1="5.5" x2="9" y2="5.5" />
      <line x1="11" y1="9.5" x2="14.5" y2="9.5" />
      <polyline points="13,8 14.5,9.5 13,11" />
    </svg>
  ),
  V: (
    <svg viewBox="0 0 16 12" className="w-4 h-3 mx-auto" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" aria-hidden="true">
      <line x1="4.5" y1="2" x2="7.5" y2="2" />
      <line x1="4.5" y1="5" x2="7.5" y2="5" />
      <line x1="4.5" y1="8" x2="7.5" y2="8" />
      <line x1="11" y1="2" x2="11" y2="9" />
      <polyline points="9.5,7.5 11,9 12.5,7.5" />
    </svg>
  ),
  R: (
    <svg viewBox="0 0 16 12" className="w-4 h-3 mx-auto" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" aria-hidden="true">
      <line x1="5" y1="2.5" x2="14" y2="2.5" />
      <line x1="7" y1="5.5" x2="14" y2="5.5" />
      <line x1="1.5" y1="9.5" x2="5" y2="9.5" />
      <polyline points="3,8 1.5,9.5 3,11" />
    </svg>
  ),
};

/** ^FP direction + inter-character gap sub-panel. Normalising 'H'
 *  / gap=0 back to undefined is the registry's job, not the
 *  panel's. */
export function FpSettings({ props: p, onChange }: Props) {
  const t = useT();
  const dir = p.fpDirection ?? "H";
  const gapDisabled = dir === "V";
  const items: { v: FpDir; title: string }[] = [
    { v: "H", title: t.registry.text.fpDirH },
    { v: "V", title: t.registry.text.fpDirV },
    { v: "R", title: t.registry.text.fpDirR },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <label className={labelCls}>{t.registry.text.fpDirection}</label>
        <div className="flex gap-1" role="group" aria-label={t.registry.text.fpDirection}>
          {items.map(({ v, title }) => {
            const active = dir === v;
            return (
              <Tooltip key={v} content={title}>
                <button
                  type="button"
                  aria-label={title}
                  aria-pressed={active}
                  onClick={() => onChange({ fpDirection: v })}
                  className={`w-7 h-6 flex items-center justify-center rounded border transition-colors ${
                    active
                      ? "border-accent bg-accent-dim text-accent"
                      : "border-border text-muted hover:text-text hover:bg-surface-2"
                  }`}
                >
                  {ICONS[v]}
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <Tooltip content={gapDisabled ? t.registry.text.fpCharGapVHint : undefined} className="w-full">
        <div>
          <UnitNumberInput
            label={t.registry.text.fpCharGap}
            scope="page"
            valueDots={p.fpCharGap}
            minDots={0}
            allowUnset
            disabled={gapDisabled}
            onChangeDots={(fpCharGap) => onChange({ fpCharGap })}
          />
        </div>
      </Tooltip>
    </div>
  );
}
