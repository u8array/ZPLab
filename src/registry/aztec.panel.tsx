import type { ObjectTypeUi } from "./panelTypes";
import { useT } from "../hooks/useT";
import { RotationSelect } from "../components/Properties/RotationSelect";
import { NumberInput } from "../components/Properties/NumberInput";
import { SectionCard } from "../components/Properties/SectionCard";
import { TypedContentSection } from "./typedContentSection";
import { AZTEC_PROP_SPECS, type AztecProps } from '@zplab/core/registry/aztec';

export const aztecPanel: ObjectTypeUi<AztecProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.aztec;
    return (
      <>
        <TypedContentSection obj={obj} />

        <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
          <NumberInput
            label={loc.magnification}
            value={p.magnification}
            min={AZTEC_PROP_SPECS.magnification.min}
            max={AZTEC_PROP_SPECS.magnification.max}
            onChange={(magnification) => onChange({ magnification })}
            zplCmd="^B0"
          />

          <NumberInput
            label={loc.ecLevel}
            value={p.ecLevel}
            min={AZTEC_PROP_SPECS.ecLevel.min}
            max={AZTEC_PROP_SPECS.ecLevel.max}
            onChange={(ecLevel) => onChange({ ecLevel })}
            zplCmd="^B0"
          />

          <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} zplCmd="^B0" />
        </SectionCard>
      </>
    );
  },
};
