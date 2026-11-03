import type { ReactNode } from 'react';
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
import { CheckboxRow } from '../components/Properties/CheckboxRow';
import { HriAboveRow } from '../components/Properties/HriAboveRow';
import { extractClockTokens } from '@zplab/core/lib/fcTemplate';
import { SectionCard, StaticSectionCard } from '../components/Properties/SectionCard';
import { FieldLabel } from '../components/Properties/ZplCmd';
import { EanInlineStatus } from '../components/Properties/EanInlineStatus';
import { SerialModeCheckbox, SerialParts } from '../components/Properties/SerialModeSection';
import type { EanUpcType } from '../lib/eanUpcValidate';
import { BARCODE_1D_PROP_SPECS, type Barcode1DProps } from '@zplab/core/registry/barcode1d';
import type { LabelObjectBase } from '@zplab/core/types/LabelObject';

/** Per-symbology locale block: labels rendered by the panel. */
export interface BarcodeLocale {
  content: string;
  height: string;
  moduleWidth: string;
  printInterpretation: string;
  checkDigit?: string;
  placeholder?: string;
}

/** What the rows for a symbology's own props render from. */
export interface SymbologyRowsContext<P extends Barcode1DProps> {
  obj: LabelObjectBase & { props: P };
  onChange: (props: Partial<P>) => void;
  t: Translations;
  /** The field carries a chip, so a builder writing a literal is off. */
  bound: boolean;
}

export interface Barcode1DPanelConfig<P extends Barcode1DProps = Barcode1DProps> {
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
  /** Under the content editor. */
  contentRows?: (rows: SymbologyRowsContext<P>) => ReactNode;
  /** First in the settings section. */
  settingsRows?: (rows: SymbologyRowsContext<P>) => ReactNode;
  /** What the check-digit toggle writes besides `checkDigit`. */
  checkDigitPatch?: (checkDigit: boolean) => Partial<P>;
}

export function createBarcode1DPanel<P extends Barcode1DProps = Barcode1DProps>(
  config: Barcode1DPanelConfig<P>,
): ObjectTypeUi<P> {
  return {
    PropertiesPanel: ({ obj, onChange }) => {
      const t = useT();
      const loc = config.locale(t);
      const p = obj.props;
      // A base-prop patch fits every P, which the generic cannot express.
      const set = onChange as (props: Partial<Barcode1DProps>) => void;
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
              <SerialParts obj={obj} onChange={set} />
            ) : (
              <div className="flex flex-col gap-1">
                <FieldLabel cmd="^FD">{loc.content}</FieldLabel>
                <ContentEditorButton obj={obj} />
                {config.contentRows?.({ obj, onChange, t, bound })}
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
            <SerialModeCheckbox obj={obj} onChange={set} />
            {config.settingsRows?.({ obj, onChange, t, bound })}

            <UnitNumberInput
              label={loc.height}
              scope="page"
              valueDots={p.height}
              minDots={1}
              disabled={config.heightLocked}
              onChangeDots={(height) => set({ height })}
              zplCmd={config.zplCommand}
            />

            <NumberInput
              label={loc.moduleWidth}
              value={p.moduleWidth}
              min={BARCODE_1D_PROP_SPECS.moduleWidth.min}
              max={BARCODE_1D_PROP_SPECS.moduleWidth.max}
              onChange={(moduleWidth) => set({ moduleWidth })}
              zplCmd="^BY"
            />

            {!config.interpretationLocked && (
              <CheckboxRow
                checked={p.printInterpretation}
                onChange={(printInterpretation) => set({ printInterpretation })}
                label={loc.printInterpretation}
                cmd={config.zplCommand}
              />
            )}

            {!config.interpretationLocked && config.hriAboveConfigurable && p.printInterpretation && (
              <HriAboveRow
                checked={p.printInterpretationAbove}
                onChange={(printInterpretationAbove) => set({ printInterpretationAbove })}
                cmd={config.zplCommand}
              />
            )}

            {config.hasCheckDigit && (
              <CheckboxRow
                checked={p.checkDigit}
                onChange={(checkDigit) =>
                  config.checkDigitPatch ? onChange(config.checkDigitPatch(checkDigit)) : set({ checkDigit })}
                label={loc.checkDigit ?? ''}
                cmd={config.zplCommand}
              />
            )}

            <RotationSelect
              value={p.rotation}
              onChange={(rotation) => set({ rotation })}
              zplCmd={config.zplCommand}
            />
          </SectionCard>
        </>
      );
    },
  };
}
