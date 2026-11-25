import { LABELS_ACROSS_MAX, type LabelConfig } from "@zplab/core/types/LabelConfig";
import { acrossGapForWidthMm, acrossWidthMm, labelsAcrossWithCount } from "@zplab/core/lib/labelsAcross";
import { mmToUnit, unitLabel, unitStep, unitToMm, type Unit } from "@zplab/core/lib/units";
import { useT } from "../../hooks/useT";
import { fieldGridCols, fieldGridCell } from "../ui/formStyles";
import { NumberInput } from "./NumberInput";

interface Props {
  label: LabelConfig;
  onUpdate: (config: Partial<LabelConfig>) => void;
  unit: Unit;
}

/** The labels a liner carries side by side: their count and, from a count of two, gap and width. */
export function AcrossFields({ label, onUpdate, unit }: Props) {
  const t = useT();
  const across = label.labelsAcross;
  const active = across !== undefined && across.count > 1 ? across : null;
  const widthMm = acrossWidthMm(label);
  return (
    <div className="flex flex-col gap-1">
      <NumberInput
        label={t.label.labelsAcross}
        hint={t.label.labelsAcrossHint}
        value={across?.count ?? 1}
        min={1}
        max={LABELS_ACROSS_MAX}
        step={1}
        onChange={(count) => onUpdate({ labelsAcross: labelsAcrossWithCount(across, count) })}
      />
      {active && (
        // Only the gap is stored, so a typed width comes back as typed.
        <div className={`grid grid-cols-2 ${fieldGridCols}`}>
          <NumberInput
            label={`${t.label.labelsAcrossGap} (${unitLabel(unit)})`}
            value={mmToUnit(active.gapMm, unit)}
            min={0}
            step={unitStep(unit)}
            onChange={(gap) => onUpdate({ labelsAcross: { ...active, gapMm: unitToMm(gap, unit) } })}
            className={fieldGridCell}
          />
          <NumberInput
            label={`${t.label.labelsAcrossWidth} (${unitLabel(unit)})`}
            value={mmToUnit(widthMm ?? 0, unit)}
            min={0}
            step={unitStep(unit)}
            onChange={(width) => {
              // An emptied field reads as 0, which would spread the labels over the whole liner.
              if (width > 0) onUpdate({ labelsAcross: { ...active, gapMm: acrossGapForWidthMm(label, unitToMm(width, unit)) } });
            }}
            className={fieldGridCell}
          />
        </div>
      )}
      {active && widthMm === null && <p className="text-[10px] leading-snug text-error">{t.label.labelsAcrossTooNarrow}</p>}
    </div>
  );
}
