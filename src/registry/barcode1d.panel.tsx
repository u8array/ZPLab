import type { ObjectTypeUi } from './panelTypes';
import type { Translations } from '../locales';
import { useT } from '../hooks/useT';
import { useLabelStore } from '../store/labelStore';
import { hasValidLength } from '@zplab/core/registry/contentSpec';
import { specForObject } from '@zplab/core/registry';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { NumberInput } from '../components/Properties/NumberInput';
import { UnitNumberInput } from '../components/Properties/UnitNumberInput';
import { ContentEditorButton } from '../components/Properties/ContentEditorButton';
import { fieldMode, boundDefaultOrContent, fieldVariableRefs, fieldHasVariable, asLabelObject } from '@zplab/core/lib/variableField';
import { gs1EnablePatch } from '@zplab/core/registry/gs1FieldSpec';
import { Gs1BuilderButton } from './gs1PanelControls';
import { CheckboxRow } from '../components/Properties/CheckboxRow';
import { extractClockTokens } from '@zplab/core/lib/fcTemplate';
import { SectionCard, StaticSectionCard } from '../components/Properties/SectionCard';
import { FieldLabel } from '../components/Properties/ZplCmd';
import { EanInlineStatus } from '../components/Properties/EanInlineStatus';
import { SerialModeCheckbox, SerialParts } from '../components/Properties/SerialModeSection';
import type { EanUpcType } from '../lib/eanUpcValidate';
import type { Barcode1DProps } from '@zplab/core/registry/barcode1d';

/** Per-symbology locale block: labels rendered by the panel. */
export interface BarcodeLocale {
  content: string;
  height: string;
  moduleWidth: string;
  printInterpretation: string;
  checkDigit?: string;
  placeholder?: string;
  /** GS1 mode toggle label; only needed by a `gs1Capable` symbology. */
  gs1Mode?: string;
}

export interface Barcode1DPanelConfig {
  locale: (t: Translations) => BarcodeLocale;
  hasCheckDigit: boolean;
  heightLocked?: boolean;
  interpretationLocked?: boolean;
  /** Symbology supports the HRI above/below toggle (ZPL g-param). */
  hriAboveConfigurable?: boolean;
  /** The symbology's ZPL command (e.g. `^BC`), shown as a per-field tag when
   *  showZplCommands is on. Height / HRI / check-digit / rotation are params
   *  of this command; module width is `^BY`, content is `^FD`. */
  zplCommand: string;
  /** Opt-in: show the inline EAN/UPC length + check-digit helper under the
   *  content field (fixed-digit symbologies only). */
  eanValidation?: EanUpcType;
  /** Symbology offers a GS1 mode: renders the toggle + builder and swaps in the
   *  GS1 charset while on. */
  gs1Capable?: boolean;
}

export function createBarcode1DPanel(config: Barcode1DPanelConfig): ObjectTypeUi<Barcode1DProps> {
  return {
    PropertiesPanel: ({ obj, onChange }) => {
      const t = useT();
      const loc = config.locale(t);
      const p = obj.props;
      const variables = useLabelStore((s) => s.variables);
      // Validate the literal value AND the single-bind default. Skip only for a
      // REAL template (resolvable variable or clock markers), whose content has
      // no fixed printable length. An orphan marker like «ghost» classifies as
      // template but resolves to nothing, so it still gets validated as literal
      // text. Serial seeds are not a fixed length either, so skip those too.
      const lo = asLabelObject(obj);
      // Builders write a literal string; disabled once the field carries a chip.
      const bound = fieldHasVariable(lo, variables);
      const realTemplate =
        fieldMode(lo, variables) === 'template' &&
        (fieldVariableRefs(lo, variables).length > 0 ||
          extractClockTokens(p.content).length > 0);
      const validate = !p.serial && !realTemplate;
      // Single-bind prints the variable's current default, not p.content (a
      // mirror that goes stale when the default is edited in the Variables panel).
      const validationContent = boundDefaultOrContent(lo, variables);
      return (
        <>
          <StaticSectionCard title={t.properties.contentSection}>
            {p.serial ? (
              <SerialParts obj={obj} onChange={onChange} />
            ) : (
              <div className="flex flex-col gap-1">
                <FieldLabel cmd="^FD">{loc.content}</FieldLabel>
                <ContentEditorButton obj={obj} />
                {config.gs1Capable && p.gs1 && <Gs1BuilderButton objId={obj.id} />}
                {validate && !config.eanValidation && !hasValidLength(validationContent, specForObject(obj)) && loc.placeholder && (
                  <p className="font-mono text-[10px] text-warning">{loc.placeholder}</p>
                )}
                {validate && config.eanValidation && (
                  <EanInlineStatus type={config.eanValidation} content={validationContent} />
                )}
              </div>
            )}
          </StaticSectionCard>

          <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
            <SerialModeCheckbox obj={obj} onChange={onChange} />
            {config.gs1Capable && !p.serial && (
              <CheckboxRow
                checked={p.gs1 ?? false}
                onChange={(c) => onChange(c ? gs1EnablePatch(p.content, bound) : { gs1: false })}
                label={loc.gs1Mode ?? ''}
                cmd={config.zplCommand}
              />
            )}

            <UnitNumberInput
              label={loc.height}
              scope="page"
              valueDots={p.height}
              minDots={1}
              disabled={config.heightLocked}
              onChangeDots={(height) => onChange({ height })}
              zplCmd={config.zplCommand}
            />

            <NumberInput
              label={loc.moduleWidth}
              value={p.moduleWidth}
              min={1}
              max={10}
              onChange={(moduleWidth) => onChange({ moduleWidth })}
              zplCmd="^BY"
            />

            {!config.interpretationLocked && (
              <CheckboxRow
                checked={p.printInterpretation}
                onChange={(printInterpretation) => onChange({ printInterpretation })}
                label={loc.printInterpretation}
                cmd={config.zplCommand}
              />
            )}

            {!config.interpretationLocked && config.hriAboveConfigurable && p.printInterpretation && (
              <CheckboxRow
                checked={p.printInterpretationAbove ?? false}
                onChange={(printInterpretationAbove) => onChange({ printInterpretationAbove })}
                label={t.registry.text.hriAbove}
                cmd={config.zplCommand}
              />
            )}

            {config.hasCheckDigit && (
              <CheckboxRow
                checked={p.checkDigit}
                // Toggling drops the imported ^BM extras (C/D mode, e2 HRI
                // digit): they would otherwise stick invisibly to the emit.
                onChange={(checkDigit) =>
                  onChange({ checkDigit, msiCheckMode: undefined, msiHriCheck: undefined })}
                label={loc.checkDigit ?? ''}
                cmd={config.zplCommand}
              />
            )}

            <RotationSelect
              value={p.rotation}
              onChange={(rotation) => onChange({ rotation })}
              zplCmd={config.zplCommand}
            />
          </SectionCard>
        </>
      );
    },
  };
}
