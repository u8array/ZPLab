import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { useLabelStore } from '../store/labelStore';
import { UnitNumberInput } from '../components/Properties/UnitNumberInput';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { SectionCard } from '../components/Properties/SectionCard';
import { FieldLabel } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { fieldGridCols, fieldGridCell } from '../components/ui/formStyles';
import { type SymbolProps, type SymbolCode, DEFAULT_GS_SYMBOL_META, GS_SYMBOLS, CERTIFICATION_MARK_CODES } from '@zplab/core/registry/symbol';

export const symbolPanel: ObjectTypeUi<SymbolProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const showZpl = useLabelStore((s) => s.showZplCommands);
    // Certification marks are power-user only, but an object already carrying
    // one (import, or toggled mode) must keep its current option visible.
    const symbols = GS_SYMBOLS.filter(
      (s) => showZpl || !CERTIFICATION_MARK_CODES.has(s.code) || s.code === p.symbol,
    );
    return (
      <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
        <div className="flex flex-col gap-1">
          <FieldLabel cmd="^GS">{t.registry.symbol.symbol}</FieldLabel>
          <Select<SymbolCode>
            value={p.symbol}
            onChange={(symbol) => onChange({ symbol })}
            aria-label={t.registry.symbol.symbol}
            groups={[{ options: symbols.map((s) => ({
              value: s.code,
              label: `${s.glyph}  ${t.registry.symbol[s.label as keyof typeof t.registry.symbol]}`,
            })) }]}
          />
          {CERTIFICATION_MARK_CODES.has(p.symbol) && (
            <p className="font-mono text-[10px] text-amber-400 leading-relaxed">
              {t.registry.symbol.certMarkWarningFmt.replace(
                '{mark}',
                (GS_SYMBOLS.find((s) => s.code === p.symbol) ?? DEFAULT_GS_SYMBOL_META).glyph,
              )}
            </p>
          )}
        </div>
        <div className={`grid grid-cols-2 ${fieldGridCols}`}>
          <UnitNumberInput
            label={t.registry.symbol.height}
            valueDots={p.height}
            minDots={1}
            onChangeDots={(height) => onChange({ height })}
            zplCmd="^GS"
            className={fieldGridCell}
          />
          <UnitNumberInput
            label={t.registry.symbol.width}
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
