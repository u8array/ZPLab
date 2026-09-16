import type { ObjectTypeUi } from "./panelTypes";
import { useT } from "../hooks/useT";
import { ContentEditorButton } from "../components/Properties/ContentEditorButton";
import { RotationSelect } from "../components/Properties/RotationSelect";
import { NumberInput } from "../components/Properties/NumberInput";
import { UnitNumberInput } from "../components/Properties/UnitNumberInput";
import { SectionCard, StaticSectionCard } from "../components/Properties/SectionCard";
import { fieldGridCols, fieldGridCell } from "../components/ui/formStyles";
import { PDF417_PROP_SPECS, type Pdf417Props } from '@zplab/core/registry/pdf417';

export const pdf417Panel: ObjectTypeUi<Pdf417Props> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.pdf417;
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
              zplCmd="^B7"
              className={fieldGridCell}
            />
            <NumberInput
              label={loc.moduleWidth}
              value={p.moduleWidth}
              min={PDF417_PROP_SPECS.moduleWidth.min}
              max={PDF417_PROP_SPECS.moduleWidth.max}
              onChange={(moduleWidth) => onChange({ moduleWidth })}
              zplCmd="^BY"
              className={fieldGridCell}
            />
          </div>

          <div className={`grid grid-cols-2 ${fieldGridCols}`}>
            <NumberInput
              label={loc.securityLevel}
              value={p.securityLevel}
              min={PDF417_PROP_SPECS.securityLevel.min}
              max={PDF417_PROP_SPECS.securityLevel.max}
              onChange={(securityLevel) => onChange({ securityLevel })}
              zplCmd="^B7"
              className={fieldGridCell}
            />
            <NumberInput
              label={loc.columns}
              value={p.columns}
              min={PDF417_PROP_SPECS.columns.min}
              max={PDF417_PROP_SPECS.columns.max}
              onChange={(columns) => onChange({ columns })}
              zplCmd="^B7"
              className={fieldGridCell}
            />
          </div>

          <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} zplCmd="^B7" />
        </SectionCard>
      </>
    );
  },
};
