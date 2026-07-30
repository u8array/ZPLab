import type { ObjectTypeUi } from "./panelTypes";
import { useT } from "../hooks/useT";
import { ContentEditorButton } from "../components/Properties/ContentEditorButton";
import { RotationSelect } from "../components/Properties/RotationSelect";
import { NumberInput } from "../components/Properties/NumberInput";
import { UnitNumberInput } from "../components/Properties/UnitNumberInput";
import { SectionCard, StaticSectionCard } from "../components/Properties/SectionCard";
import { fieldGridCols, fieldGridCell } from "../components/ui/formStyles";
import type { MicroPdf417Props } from "@zplab/core/registry/micropdf417";

export const micropdf417Panel: ObjectTypeUi<MicroPdf417Props> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.micropdf417;
    return (
      <>
        <StaticSectionCard title={t.properties.contentSection} cmd="^FD">
          <ContentEditorButton obj={obj} />
        </StaticSectionCard>

        <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
          <div className={`grid grid-cols-2 ${fieldGridCols}`}>
            <UnitNumberInput
              label={loc.rowHeight}
              scope="page"
              valueDots={p.rowHeight}
              minDots={1}
              onChangeDots={(rowHeight) => onChange({ rowHeight })}
              zplCmd="^BF"
              className={fieldGridCell}
            />
            <NumberInput
              label={loc.moduleWidth}
              value={p.moduleWidth}
              min={1}
              max={10}
              onChange={(moduleWidth) => onChange({ moduleWidth })}
              zplCmd="^BY"
              className={fieldGridCell}
            />
          </div>

          <NumberInput
            label={loc.mode}
            value={p.mode}
            min={0}
            max={33}
            onChange={(mode) => onChange({ mode })}
            zplCmd="^BF"
          />

          <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} zplCmd="^BF" />
        </SectionCard>
      </>
    );
  },
};
