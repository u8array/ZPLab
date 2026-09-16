import { editBounds } from '@zplab/core/types/propSpec';
import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { dataMatrixMinFitIndex } from '../components/Canvas/bwipHelpers';
import { useLabelStore } from '../store/labelStore';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { NumberInput } from '../components/Properties/NumberInput';
import { SectionCard } from '../components/Properties/SectionCard';
import { TypedContentSection } from './typedContentSection';
import { FieldLabel } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { fieldHasVariable, asLabelObject } from '@zplab/core/lib/variableField';
import { gs1EnablePatch } from '@zplab/core/registry/gs1FieldSpec';
import { CheckboxRow } from '../components/Properties/CheckboxRow';
import { DATAMATRIX_PROP_SPECS, type DataMatrixProps, dmSizePairs, isRectangular, qualityPatch } from '@zplab/core/registry/datamatrix';

/** ^BX c/r symbol-size options: firmware-valid ECC 200 sizes for the shape,
 *  plus a verbatim entry for an imported pair outside the list so it
 *  round-trips untouched. Sizes below `minFit` can't hold the content. */
function symbolSizeOptions(p: DataMatrixProps, autoLabel: string, minFit: number) {
  const pairs = dmSizePairs(p);
  // A partial import (only c or only r) still forces that dimension on the
  // printer; surface it verbatim instead of masquerading as Auto.
  const value = p.columns || p.rows ? `${p.rows ?? '?'}x${p.columns ?? '?'}` : 'auto';
  const known = value === 'auto' || pairs.some(([r, c]) => `${r}x${c}` === value);
  const options = [
    { value: 'auto', label: autoLabel },
    // Display-only: selecting it would parse `?` to NaN; Auto clears it.
    ...(known ? [] : [{ value, label: value.replace('x', '×'), disabled: true }]),
    ...pairs.map(([r, c], i) => ({ value: `${r}x${c}`, label: `${r}×${c}`, disabled: i < minFit })),
  ];
  return { value, options };
}

export const datamatrixPanel: ObjectTypeUi<DataMatrixProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.datamatrix;
    const showZpl = useLabelStore((s) => s.showZplCommands);
    const variables = useLabelStore((s) => s.variables);
    // Only the GS1 enable-patch cares about a bound field (it must not clobber
    // the variable's content with the GS1 seed); the builders take markers.
    const bound = fieldHasVariable(asLabelObject(obj), variables);
    // One auto dry-run encode ranks all forceable sizes (React Compiler
    // memoizes the call from the props it reads).
    const minFit = dataMatrixMinFitIndex(p, dmSizePairs(p));
    const size = symbolSizeOptions(p, loc.sizeAuto, minFit);
    return (
      <>
        <TypedContentSection obj={obj} />

        <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
          <CheckboxRow
            checked={p.gs1}
            // GS1 requires ECC 200, so force it on alongside the enable patch.
            onChange={(c) => onChange(c ? { ...gs1EnablePatch(p.content, bound), ...qualityPatch(p, 200) } : { gs1: false })}
            label={loc.gs1Mode}
            cmd="^BX"
          />

          <NumberInput
            label={loc.dimension}
            value={p.dimension}
            {...editBounds(DATAMATRIX_PROP_SPECS.dimension)}
            onChange={(dimension) => onChange({ dimension })}
            zplCmd="^BX"
          />

          {/* Legacy convolution ECC is a closed-system niche (the spec says
              use 200 for anything new), so the picker is power-user only —
              but it must surface for an imported label that deviates, else
              the disabled rectangular/size controls would be unexplainable. */}
          {(showZpl || p.quality !== 200) && (
            <div className="flex flex-col gap-1">
              <FieldLabel cmd="^BX">{loc.quality}</FieldLabel>
              <Select<DataMatrixProps['quality']>
                value={p.quality}
                disabled={p.gs1}
                onChange={(quality) => onChange(qualityPatch(p, quality))}
                aria-label={loc.quality}
                groups={[{ options: [
                  { value: 0, label: loc.qualityAuto, badge: showZpl ? '0' : undefined },
                  { value: 50, label: loc.quality50, badge: showZpl ? '50' : undefined },
                  { value: 80, label: loc.quality80, badge: showZpl ? '80' : undefined },
                  { value: 100, label: loc.quality100, badge: showZpl ? '100' : undefined },
                  { value: 140, label: loc.quality140, badge: showZpl ? '140' : undefined },
                  { value: 200, label: loc.quality200, badge: showZpl ? '200' : undefined },
                ] }]}
              />
            </div>
          )}

          <CheckboxRow
            checked={isRectangular(p)}
            // Square and rectangular size lists don't overlap; reset to auto.
            onChange={(c) => onChange({ aspectRatio: c ? 2 : undefined, columns: undefined, rows: undefined })}
            label={loc.rectangular}
            cmd="^BX"
            disabled={p.quality !== 200}
          />

          <div className="flex flex-col gap-1">
            <FieldLabel cmd="^BX">{loc.symbolSize}</FieldLabel>
            <Select<string>
              value={size.value}
              disabled={p.quality !== 200}
              onChange={(v) => {
                if (v === 'auto') return onChange({ columns: undefined, rows: undefined });
                const [rows, columns] = v.split('x').map(Number);
                onChange({ rows, columns });
              }}
              aria-label={loc.symbolSize}
              groups={[{ options: size.options }]}
            />
          </div>

          <RotationSelect value={p.rotation} onChange={(rotation) => onChange({ rotation })} zplCmd="^BX" />
        </SectionCard>
      </>
    );
  },
};
