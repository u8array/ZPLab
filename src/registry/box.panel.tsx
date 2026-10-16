import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { useLabelStore } from '../store/labelStore';
import { labelCls } from '../components/Properties/styles';
import { UnitNumberInput } from '../components/Properties/UnitNumberInput';
import { SectionCard } from '../components/Properties/SectionCard';
import { FieldLabel, ZplCmd } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { fieldGridCols, fieldGridCell } from '../components/ui/formStyles';
import { ShapeModeToggle } from '../components/Properties/ShapeModeToggle';
import { BOX_PROP_SPECS, type BoxProps } from '@zplab/core/registry/box';
import { boxCornerRadii } from '@zplab/core/lib/shapeGeometry';
import { editBounds } from '@zplab/core/types/propSpec';
import { effectiveDpmm } from '@zplab/core/types/LabelConfig';
import { dotsToUnit, unitLabel } from '@zplab/core/lib/units';
import { currentPageLabel } from '../store/labelStore.selectors';

const ROUNDING_BOUNDS = editBounds(BOX_PROP_SPECS.rounding);
const ROUNDING_STEPS = Array.from({ length: ROUNDING_BOUNDS.max - ROUNDING_BOUNDS.min + 1 }, (_, i) => ROUNDING_BOUNDS.min + i);
// An imported ^GB may carry an index past the spec range, so the list keeps it without a radius.
const roundingOptions = (current: number) => (ROUNDING_STEPS.includes(current) ? ROUNDING_STEPS : [...ROUNDING_STEPS, current]);

export const boxPanel: ObjectTypeUi<BoxProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const showZpl = useLabelStore((s) => s.showZplCommands);
    const unit = useLabelStore((s) => s.canvasSettings.unit);
    const dpmm = useLabelStore((s) => effectiveDpmm(currentPageLabel(s)));
    const setPropsPreview = useLabelStore((s) => s.setPropsPreview);
    const radiusLabel = (rounding: number) => `${dotsToUnit(boxCornerRadii(p.width, p.height, p.thickness, rounding).outer, dpmm, unit)} ${unitLabel(unit)}`;
    return (
      <SectionCard
        id={`${obj.type}-settings`}
        title={t.registry.shapeMode.label}
        headerAction={<ShapeModeToggle obj={obj} />}
      >
        <div className={`grid grid-cols-2 ${fieldGridCols}`}>
          <UnitNumberInput
            label={t.registry.box.width}
            scope="page"
            valueDots={p.width}
            minDots={1}
            onChangeDots={(width) => onChange({ width })}
            zplCmd="^GB"
            className={fieldGridCell}
          />
          <UnitNumberInput
            label={t.registry.box.height}
            scope="page"
            valueDots={p.height}
            minDots={1}
            onChangeDots={(height) => onChange({ height })}
            zplCmd="^GB"
            className={fieldGridCell}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent"
              checked={p.filled}
              onChange={(e) => onChange({ filled: e.target.checked })}
            />
            <span className={labelCls}>{t.registry.box.filled}</span>
          </label>
          <ZplCmd cmd="^GB" />
        </div>

        {!p.filled && (
          <UnitNumberInput
            label={t.registry.box.thickness}
            scope="page"
            valueDots={p.thickness}
            minDots={1}
            onChangeDots={(thickness) => onChange({ thickness })}
            zplCmd="^GB"
          />
        )}

        <div className={`grid grid-cols-2 ${fieldGridCols}`}>
          <div className={fieldGridCell}>
            <FieldLabel cmd="^GB">{t.registry.box.color}</FieldLabel>
            <Select<BoxProps['color']>
              value={p.color}
              onChange={(color) => onChange({ color })}
              aria-label={t.registry.box.color}
              groups={[{ options: [
                { value: 'B', label: t.registry.box.colorB, badge: showZpl ? 'B' : undefined },
                { value: 'W', label: t.registry.box.colorW, badge: showZpl ? 'W' : undefined },
              ] }]}
            />
          </div>
          <div className={fieldGridCell}>
            <FieldLabel cmd="^GB" hint={t.registry.box.roundingHint}>{t.registry.box.rounding}</FieldLabel>
            <Select<number>
              value={p.rounding}
              onChange={(rounding) => onChange({ rounding })}
              onHoverOption={(rounding) => setPropsPreview(rounding === null ? null : { id: obj.id, props: { rounding } })}
              aria-label={t.registry.box.rounding}
              groups={[{ options: roundingOptions(p.rounding).map((rounding) => ({ value: rounding, label: String(rounding), badge: ROUNDING_STEPS.includes(rounding) ? radiusLabel(rounding) : '' })) }]}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent"
              checked={p.reverse ?? false}
              onChange={(e) => onChange({ reverse: e.target.checked })}
            />
            <span className={labelCls}>{t.registry.box.reverse}</span>
          </label>
          <ZplCmd cmd="^FR" />
        </div>
      </SectionCard>
    );
  },
};
