import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { ContentEditorButton } from "../components/Properties/ContentEditorButton";
import { RotationSelect } from '../components/Properties/RotationSelect';
import { NumberInput } from '../components/Properties/NumberInput';
import { UnitNumberInput } from '../components/Properties/UnitNumberInput';
import { SectionCard, StaticSectionCard } from '../components/Properties/SectionCard';
import { CheckboxRow } from '../components/Properties/CheckboxRow';
import { HriAboveRow } from '../components/Properties/HriAboveRow';
import { FieldLabel } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { fieldGridCols, fieldGridCell } from '../components/ui/formStyles';
import {
  type Code49Props,
  type Code49Mode,
  CODE49_MODES,
  code49MinHeight,
  code49MaxHeight,
} from '@zplab/core/registry/code49';

export const code49Panel: ObjectTypeUi<Code49Props> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.code49;
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
              minDots={code49MinHeight(p.moduleWidth)}
              maxDots={code49MaxHeight(p.moduleWidth)}
              onChangeDots={(height) => onChange({ height })}
              zplCmd="^B4"
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

          <div className="flex flex-col gap-1">
            <FieldLabel cmd="^B4">{loc.mode}</FieldLabel>
            <Select<Code49Mode>
              value={p.mode}
              onChange={(mode) => onChange({ mode })}
              aria-label={loc.mode}
              groups={[{ options: CODE49_MODES.map((m) => ({
                value: m,
                label: m === 'A' ? `A - ${loc.modeAuto}` : m,
              })) }]}
            />
          </div>

          <CheckboxRow
            checked={p.printInterpretation}
            onChange={(printInterpretation) => onChange({ printInterpretation })}
            label={loc.printInterpretation}
            cmd="^B4"
          />

          {p.printInterpretation && (
            <HriAboveRow
              checked={p.printInterpretationAbove}
              onChange={(printInterpretationAbove) => onChange({ printInterpretationAbove })}
              cmd="^B4"
            />
          )}

          <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} zplCmd="^B4" />
        </SectionCard>
      </>
    );
  },
};
