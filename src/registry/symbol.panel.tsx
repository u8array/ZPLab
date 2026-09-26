import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { useLabelStore } from '../store/labelStore';
import { UnitNumberInput } from '../components/Properties/UnitNumberInput';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { SectionCard } from '../components/Properties/SectionCard';
import { FieldLabel } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { fieldGridCols, fieldGridCell } from '../components/ui/formStyles';
import { type SymbolProps, type SymbolCode, DEFAULT_GS_SYMBOL_META, GS_SYMBOLS, CERTIFICATION_MARK_CODES, symbolCodeFromPayload } from '@zplab/core/registry/symbol';
import { lookupBoundVariable } from '@zplab/core/lib/variableField';
import type { LabelObject } from '@zplab/core/types/Group';

export const symbolPanel: ObjectTypeUi<SymbolProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const showZpl = useLabelStore((s) => s.showZplCommands);
    const variables = useLabelStore((s) => s.variables);
    const updateVariable = useLabelStore((s) => s.updateVariable);
    // A slot prints its default here, so the select edits that default, as the export reads it.
    // The marker lives beside the typed props, so the symbol has no `content` to satisfy the seam.
    const bound = lookupBoundVariable(obj as unknown as LabelObject, variables);
    const code = bound ? symbolCodeFromPayload(bound.defaultValue) : p.symbol;
    // Certification marks are power-user only, but an object already carrying
    // one (import, or toggled mode) must keep its current option visible.
    const symbols = GS_SYMBOLS.filter(
      (s) => showZpl || !CERTIFICATION_MARK_CODES.has(s.code) || s.code === code,
    );
    return (
      <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
        <div className="flex flex-col gap-1">
          <FieldLabel cmd="^GS">{t.registry.symbol.symbol}</FieldLabel>
          <Select<SymbolCode>
            value={code}
            onChange={(symbol) => (bound ? updateVariable(bound.id, { defaultValue: symbol }) : onChange({ symbol }))}
            aria-label={t.registry.symbol.symbol}
            groups={[{ options: symbols.map((s) => ({
              value: s.code,
              label: `${s.glyph}  ${t.registry.symbol[s.label as keyof typeof t.registry.symbol]}`,
            })) }]}
          />
          {bound && (
            <p className="font-mono text-[10px] text-zinc-400 leading-relaxed">
              {t.variables.badgeBoundFmt.replace('{name}', bound.name)}
            </p>
          )}
          {CERTIFICATION_MARK_CODES.has(code) && (
            <p className="font-mono text-[10px] text-amber-400 leading-relaxed">
              {t.registry.symbol.certMarkWarningFmt.replace(
                '{mark}',
                (GS_SYMBOLS.find((s) => s.code === code) ?? DEFAULT_GS_SYMBOL_META).glyph,
              )}
            </p>
          )}
        </div>
        <div className={`grid grid-cols-2 ${fieldGridCols}`}>
          <UnitNumberInput
            label={t.registry.symbol.height}
            scope="page"
            valueDots={p.height}
            minDots={1}
            onChangeDots={(height) => onChange({ height })}
            zplCmd="^GS"
            className={fieldGridCell}
          />
          <UnitNumberInput
            label={t.registry.symbol.width}
            scope="page"
            valueDots={p.width}
            minDots={1}
            onChangeDots={(width) => onChange({ width })}
            zplCmd="^GS"
            className={fieldGridCell}
          />
        </div>
        <RotationSelect
          value={p.rotation}
          onChange={(rotation) => onChange({ rotation })}
          zplCmd="^GS"
        />
      </SectionCard>
    );
  },
};
