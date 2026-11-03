import { createBarcode1DPanel } from './barcode1d.panel';
import type { Code128Props } from '@zplab/core/registry/code128';
import { gs1EnablePatch } from '@zplab/core/registry/gs1FieldSpec';
import { Gs1BuilderButton } from './gs1PanelControls';
import { CheckboxRow } from '../components/Properties/CheckboxRow';

export const code128Panel = createBarcode1DPanel<Code128Props>({
  zplCommand: '^BC',
  locale: (t) => t.registry.code128,
  hasCheckDigit: true,
  hriAboveConfigurable: true,
  contentRows: ({ obj }) => obj.props.gs1 === true && <Gs1BuilderButton objId={obj.id} />,
  settingsRows: ({ obj, onChange, t, bound }) => {
    const gs1 = obj.props.gs1 === true;
    return (
      <>
        {/* A serial seed is no GS1 element string. */}
        {!obj.props.serial && (
          <CheckboxRow
            checked={gs1}
            onChange={(c) => onChange(c ? gs1EnablePatch(obj.props.content, bound) : { gs1: false })}
            label={t.registry.code128.gs1Mode}
            cmd="^BC"
          />
        )}
        {!gs1 && (
          <CheckboxRow
            checked={obj.props.mode === 'A'}
            onChange={(c) => onChange({ mode: c ? 'A' : undefined })}
            label={t.registry.code128.autoMode}
            cmd="^BC"
          />
        )}
      </>
    );
  },
});
