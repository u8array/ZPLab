import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { useLabelStore } from '../store/labelStore';
import { labelCls } from '../components/Properties/styles';
import { UnitNumberInput } from '../components/Properties/UnitNumberInput';
import { SectionCard } from '../components/Properties/SectionCard';
import { FieldLabel, ZplCmd } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { fieldGridCols, fieldGridCell } from '../components/ui/formStyles';
import type { EllipseProps } from '@zplab/core/registry/ellipse';

export const ellipsePanel: ObjectTypeUi<EllipseProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const showZpl = useLabelStore((s) => s.showZplCommands);
    // The generator emits ^GC when the axes are equal (a circle), else ^GE
    // (independent of the lockAspect editor toggle). Badge mirrors that.
    const cmd = p.width === p.height ? '^GC' : '^GE';
    return (
      <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
        {p.lockAspect ? (
          <UnitNumberInput
            label={t.registry.circle.diameter}
            scope="page"
            valueDots={p.width}
            minDots={1}
            onChangeDots={(d) => onChange({ width: d, height: d })}
            zplCmd={cmd}
          />
        ) : (
          <div className={`grid grid-cols-2 ${fieldGridCols}`}>
            <UnitNumberInput
              label={t.registry.ellipse.width}
              scope="page"
              valueDots={p.width}
              minDots={1}
              onChangeDots={(width) => onChange({ width })}
              zplCmd={cmd}
              className={fieldGridCell}
            />
            <UnitNumberInput
              label={t.registry.ellipse.height}
              scope="page"
              valueDots={p.height}
              minDots={1}
              onChangeDots={(height) => onChange({ height })}
              zplCmd={cmd}
              className={fieldGridCell}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent"
              checked={p.lockAspect ?? false}
              onChange={(e) => {
                if (e.target.checked) {
                  // Enabling lockAspect: collapse to the smaller axis so
                  // the resulting circle fits inside the current ellipse
                  // bbox. Picking max instead would push the shape past
                  // the user's prior visual extent on one axis, which is
                  // surprising; min keeps the move strictly inward.
                  const d = Math.min(p.width, p.height);
                  onChange({ lockAspect: true, width: d, height: d });
                } else {
                  // Disabling: drop the flag (undefined keeps the model
                  // shape parser-emitted props share; they never carry
                  // an explicit `false`). Dimensions stay put so the
                  // user can adjust them independently from here.
                  onChange({ lockAspect: undefined });
                }
              }}
            />
            <span className={labelCls}>{t.registry.ellipse.lockAspect}</span>
          </label>
          <ZplCmd cmd={cmd} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent"
              checked={p.filled}
              onChange={(e) => onChange({ filled: e.target.checked })}
            />
            <span className={labelCls}>{t.registry.ellipse.filled}</span>
          </label>
          <ZplCmd cmd={cmd} />
        </div>

        {!p.filled && (
          <UnitNumberInput
            label={t.registry.ellipse.thickness}
            scope="page"
            valueDots={p.thickness}
            minDots={1}
            onChangeDots={(thickness) => onChange({ thickness })}
            zplCmd={cmd}
          />
        )}

        <div className="flex flex-col gap-1">
          <FieldLabel cmd={cmd}>{t.registry.ellipse.color}</FieldLabel>
          <Select<EllipseProps['color']>
            value={p.color}
            onChange={(color) => onChange({ color })}
            aria-label={t.registry.ellipse.color}
            groups={[{ options: [
              { value: 'B', label: t.registry.ellipse.colorB, badge: showZpl ? 'B' : undefined },
              { value: 'W', label: t.registry.ellipse.colorW, badge: showZpl ? 'W' : undefined },
            ] }]}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent"
              checked={p.reverse ?? false}
              onChange={(e) => onChange({ reverse: e.target.checked })}
            />
            <span className={labelCls}>{t.registry.ellipse.reverse}</span>
          </label>
          <ZplCmd cmd="^FR" />
        </div>
      </SectionCard>
    );
  },
};
