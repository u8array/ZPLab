import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { useLabelStore } from '../store/labelStore';
import { labelCls } from '../components/Properties/styles';
import { NumberInput } from '../components/Properties/NumberInput';
import { UnitNumberInput } from '../components/Properties/UnitNumberInput';
import { SectionCard } from '../components/Properties/SectionCard';
import { FieldLabel, ZplCmd } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { fieldGridCols, fieldGridCell } from '../components/ui/formStyles';
import { ShapeModeToggle } from '../components/Properties/ShapeModeToggle';
import { type LineProps, pickAngle, lineZplCmd } from '@zplab/core/registry/line';

/**
 * Quick-orientation picker.
 *
 *  - `screenAngles`: the two valid angles **as the user sees them on
 *    screen** for that orientation. Stored angles are then derived by
 *    subtracting the current `viewRotation`, so clicking `—` always
 *    yields a line that *looks* horizontal regardless of how the canvas
 *    is rotated.
 *  - `path`: SVG <line> endpoints (12×12 viewbox) used as the visible
 *    button icon. Avoids font-rendering quirks of ASCII glyphs and
 *    keeps the four buttons visually consistent.
 */
const ORIENTATION_PICKER: readonly {
  id: string;
  screenAngles: readonly [number, number];
  path: { x1: number; y1: number; x2: number; y2: number };
}[] = [
  { id: 'h',  screenAngles: [0, 180],    path: { x1: 1,  y1: 6,  x2: 11, y2: 6 } },
  { id: 'v',  screenAngles: [90, -90],   path: { x1: 6,  y1: 1,  x2: 6,  y2: 11 } },
  { id: '/',  screenAngles: [-45, 135],  path: { x1: 1,  y1: 11, x2: 11, y2: 1 } },
  { id: '\\', screenAngles: [45, -135],  path: { x1: 1,  y1: 1,  x2: 11, y2: 11 } },
];

export const linePanel: ObjectTypeUi<LineProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const viewRotation = useLabelStore((s) => s.canvasSettings.viewRotation);
    const showZpl = useLabelStore((s) => s.showZplCommands);
    // Badge reflects what the current angle produces (^GB axis-aligned, ^GD diagonal).
    const cmd = lineZplCmd(p.angle);
    return (
      <SectionCard
        id={`${obj.type}-settings`}
        title={t.registry.shapeMode.label}
        headerAction={<ShapeModeToggle obj={obj} />}
      >
        <div className={`grid grid-cols-2 ${fieldGridCols}`}>
          <UnitNumberInput
            label={t.registry.line.length}
            scope="page"
            valueDots={p.length}
            minDots={1}
            // Shrinking length below the current thickness would land
            // the model in the ^GB promotion regime where t > length
            // prints `t × t`; auto-clamp thickness down to match the
            // new length, mirroring the endpoint-handle drag.
            onChangeDots={(length) => {
              if (length === undefined) return;
              onChange(
                length < p.thickness
                  ? { length, thickness: length }
                  : { length },
              );
            }}
            zplCmd={cmd}
            className={fieldGridCell}
          />
          <NumberInput
            label={t.registry.line.angle}
            value={p.angle}
            min={-359}
            max={359}
            onChange={(angle) => onChange({ angle })}
            zplCmd={cmd}
            className={fieldGridCell}
          />
        </div>

        <UnitNumberInput
          label={t.registry.line.thickness}
          scope="page"
          valueDots={p.thickness}
          minDots={1}
          // Capped at length so the ZPL output stays out of the ^GB
          // promotion regime (max(w, t) × max(h, t)), where the printer
          // would extend the line beyond its declared length.
          maxDots={p.length}
          onChangeDots={(thickness) => onChange({ thickness })}
          zplCmd={cmd}
        />

        <div className="flex flex-col gap-1">
          <FieldLabel cmd={cmd}>{t.registry.line.color}</FieldLabel>
          <Select<LineProps['color']>
            value={p.color}
            onChange={(color) => onChange({ color })}
            aria-label={t.registry.line.color}
            groups={[{ options: [
              { value: 'B', label: t.registry.line.colorB, badge: showZpl ? 'B' : undefined },
              { value: 'W', label: t.registry.line.colorW, badge: showZpl ? 'W' : undefined },
            ] }]}
          />
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel cmd={cmd}>{t.registry.line.orientation}</FieldLabel>
          <div className="flex gap-1">
            {ORIENTATION_PICKER.map(({ id, screenAngles, path }) => (
              <button
                key={id}
                type="button"
                className="flex-1 flex items-center justify-center px-2 py-1.5 rounded border bg-surface-2 border-border text-text hover:bg-border transition-colors"
                onClick={() =>
                  onChange({ angle: pickAngle(p.angle, screenAngles, viewRotation) })
                }
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className="stroke-current"
                  fill="none"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                >
                  <line x1={path.x1} y1={path.y1} x2={path.x2} y2={path.y2} />
                </svg>
              </button>
            ))}
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
            <span className={labelCls}>{t.registry.line.reverse}</span>
          </label>
          <ZplCmd cmd="^FR" />
        </div>
      </SectionCard>
    );
  },
};
