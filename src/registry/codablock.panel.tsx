import type { ObjectTypeUi } from "./panelTypes";
import { useT } from "../hooks/useT";
import { RotationSelect } from "../components/Properties/RotationSelect";
import { NumberInput } from "../components/Properties/NumberInput";
import { UnitNumberInput } from "../components/Properties/UnitNumberInput";
import { SectionCard, StaticSectionCard } from "../components/Properties/SectionCard";
import { ContentEditorButton } from "../components/Properties/ContentEditorButton";
import { CheckboxRow } from "../components/Properties/CheckboxRow";
import { fieldGridCols, fieldGridCell } from "../components/ui/formStyles";
import {
  CODABLOCK_COLUMNS_MAX,
  CODABLOCK_DEFAULT_COLUMNS,
  CODABLOCK_PREVIEW_COLUMNS_MIN,
  type CodablockProps,
} from "@zplab/core/registry/codablock";

export const codablockPanel: ObjectTypeUi<CodablockProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.codablock;
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
              zplCmd="^BB"
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
            <NumberInput
              label={loc.columns}
              value={p.columns ?? CODABLOCK_DEFAULT_COLUMNS}
              min={CODABLOCK_PREVIEW_COLUMNS_MIN}
              max={CODABLOCK_COLUMNS_MAX}
              onChange={(columns) => onChange({ columns })}
              zplCmd="^BB"
              className={fieldGridCell}
            />
          </div>

          <CheckboxRow
            checked={p.securityLevel === "Y"}
            onChange={(checked) => onChange({ securityLevel: checked ? "Y" : "N" })}
            label={loc.security}
            cmd="^BB"
          />

          <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} zplCmd="^BB" />
        </SectionCard>
      </>
    );
  },
};
