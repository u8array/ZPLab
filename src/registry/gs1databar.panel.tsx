import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { useLabelStore } from '../store/labelStore';
import { inputCls } from '../components/Properties/styles';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { NumberInput } from '../components/Properties/NumberInput';
import {
  GS1_DATABAR_DEFAULT_SEGMENTS,
  GS1_DATABAR_EXPANDED_SYMBOLOGIES,
  gtinBodyFromContent,
} from '@zplab/core/lib/gs1';
import { SectionCard, StaticSectionCard } from '../components/Properties/SectionCard';
import { ContentEditorButton } from "../components/Properties/ContentEditorButton";
import { FieldLabel } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { builderButtonCls } from '../components/ui/formStyles';
import { fieldHasVariable, asLabelObject } from '@zplab/core/lib/variableField';
import { GS1DATABAR_PROP_SPECS, type Gs1DatabarProps, SYMBOLOGY_LABELS } from '@zplab/core/registry/gs1databar';

export const gs1databarPanel: ObjectTypeUi<Gs1DatabarProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.gs1databar;
    const openGs1Builder = useLabelStore((s) => s.openGs1Builder);
    const variables = useLabelStore((s) => s.variables);
    const isExpanded = GS1_DATABAR_EXPANDED_SYMBOLOGIES.has(p.symbology);
    const bound = fieldHasVariable(asLabelObject(obj), variables);
    return (
      <>
        <StaticSectionCard title={t.properties.contentSection} cmd="^FD">
          <ContentEditorButton obj={obj} />
          {isExpanded ? (
            <button type="button" onClick={() => openGs1Builder(obj.id)} className={builderButtonCls}>
              {t.gs1builder.button}
            </button>
          ) : (
            // Sym 1-5 carry only a GTIN; the multi-AI builder needs Expanded.
            <span className="text-[10px] text-muted">{loc.multiAiHint}</span>
          )}
        </StaticSectionCard>

        <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
          <NumberInput
            label={loc.magnification}
            value={p.magnification}
            min={GS1DATABAR_PROP_SPECS.magnification.min}
            max={GS1DATABAR_PROP_SPECS.magnification.max}
            onChange={(magnification) => onChange({ magnification })}
            zplCmd="^BR"
          />

          <div className="flex flex-col gap-1">
            <FieldLabel cmd="^BR">{loc.symbology}</FieldLabel>
            <Select<Gs1DatabarProps['symbology']>
              value={p.symbology}
              aria-label={loc.symbology}
              onChange={(symbology) => {
                // Leaving Expanded: reduce multi-AI content to a bare GTIN so the
                // preview (derived GTIN) and the emitted ZPL stay in sync.
                const leavingExpanded = isExpanded && !GS1_DATABAR_EXPANDED_SYMBOLOGIES.has(symbology);
                // Don't rewrite a bound field's content: the variable owns it.
                onChange(leavingExpanded && !bound ? { symbology, content: gtinBodyFromContent(p.content) } : { symbology });
              }}
              groups={[{ options: Object.entries(SYMBOLOGY_LABELS).map(([val, name]) => ({
                value: Number(val) as Gs1DatabarProps['symbology'],
                label: name,
              })) }]}
            />
          </div>

          {p.symbology === 7 && (
            <div className="flex flex-col gap-1">
              <FieldLabel cmd="^BR">{loc.segments}</FieldLabel>
              <input
                type="number"
                className={inputCls}
                value={p.segments ?? GS1_DATABAR_DEFAULT_SEGMENTS}
                min={GS1DATABAR_PROP_SPECS.segments.min}
                max={GS1DATABAR_PROP_SPECS.segments.max}
                step={2}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const even = v % 2 === 0 ? v : v + 1;
                  onChange({ segments: Math.max(2, Math.min(22, even)) });
                }}
              />
            </div>
          )}

          <RotationSelect
            value={p.rotation}
            onChange={(rotation) => onChange({ rotation })}
            zplCmd="^BR"
          />
        </SectionCard>
      </>
    );
  },
};
