import type { ObjectTypeUi } from "./panelTypes";
import { useT } from "../hooks/useT";
import { ContentEditorButton } from "../components/Properties/ContentEditorButton";
import { RotationSelect } from "../components/Properties/RotationSelect";
import { NumberInput } from "../components/Properties/NumberInput";
import { UnitNumberInput } from "../components/Properties/UnitNumberInput";
import { SectionCard, StaticSectionCard } from "../components/Properties/SectionCard";
import { fieldGridCols, fieldGridCell } from "../components/ui/formStyles";
import type { Tlc39Props } from "@zplab/core/registry/tlc39";

export const tlc39Panel: ObjectTypeUi<Tlc39Props> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.tlc39;
    return (
      <>
        <StaticSectionCard title={t.properties.contentSection} cmd="^FD">
          <ContentEditorButton obj={obj} />
        </StaticSectionCard>

        <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
          <div className={`grid grid-cols-2 ${fieldGridCols}`}>
            <UnitNumberInput
              label={loc.height}
              scope="page"
              valueDots={p.height}
              minDots={1}
              onChangeDots={(height) => onChange({ height })}
              zplCmd="^BT"
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

          <div className={`grid grid-cols-2 ${fieldGridCols}`}>
            <UnitNumberInput
              label={loc.microPdfRowHeight}
              scope="page"
              valueDots={p.microPdfRowHeight}
              minDots={1}
              maxDots={255}
              onChangeDots={(microPdfRowHeight) => onChange({ microPdfRowHeight })}
              zplCmd="^BT"
              className={fieldGridCell}
            />
            <NumberInput
              label={loc.microPdfRows}
              value={p.microPdfRows}
              min={1}
              max={10}
              onChange={(microPdfRows) => onChange({ microPdfRows })}
              zplCmd="^BT"
              className={fieldGridCell}
            />
          </div>

          <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} zplCmd="^BT" />
        </SectionCard>
      </>
    );
  },
};
