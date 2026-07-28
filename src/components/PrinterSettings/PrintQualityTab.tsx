import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { DARKNESS_INSTANT_RANGE, DARKNESS_PERMANENT_RANGE, MU_DPI_VALUES, PRINT_ORIENTATION_VALUES, SPEED_RANGE, composeMuResampling, type MuDpi, type PrintOrientation } from "@zplab/core/types/LabelConfig";
import { HEAD_TEST_INTERVAL_RANGE, TEAR_OFF_ADJUST_RANGE } from "@zplab/core/types/PrinterProfile";
import { RegionFocus } from "./printerIllustration";
import {
  BoundedIntControl,
  ZplBoundedIntInput,
  ZplCheckbox,
  ZplCommandLabel,
  ZplEnumSegmented,
  ZplEnumSubCustomSelect,
  ZplField,
  ZplSubField,
} from "./zplFieldPrimitives";
import { fieldGridCols, fieldGridCell } from "../ui/formStyles";

const MU_DPI_STRINGS = MU_DPI_VALUES.map(String);
// ^MU wire tokens name nominal densities (200 = a 203 dpi head); display
// the physical dpi so an 8 dpmm printer isn't labelled "200 dpi".
const MU_PHYSICAL_DPI: Record<string, string> = { '150': '152', '200': '203', '300': '300', '600': '600' };

type LocPrintQuality = ReturnType<typeof useT>["printerSettings"]["printQuality"];

const ORIENTATION_LABEL_KEYS = {
  N: "printOrientationN",
  I: "printOrientationI",
} as const satisfies Record<PrintOrientation, keyof LocPrintQuality>;

/** Tab 2 of the Printer Settings Modal. Per-label print quality
 *  (orientation, mirror, map clear, speed, darkness, ^MU resampling)
 *  plus setup-script-only ^JZ / ^JT / ~TA / ^CV provisioned once. */
export function PrintQualityTab() {
  const t = useT();
  const label = useLabelStore((s) => s.label);
  const setLabelConfig = useLabelStore((s) => s.setLabelConfig);
  const profile = useLabelStore((s) => s.printerProfile);
  const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
  const setMuSlot = (slot: 'formatDpi' | 'outputDpi', v: string | undefined) => {
    setLabelConfig({
      muResampling:
        v === undefined
          ? undefined
          : composeMuResampling(label.muResampling, slot, Number(v) as MuDpi),
    });
  };
  const loc = t.printerSettings.printQuality;

  return (
    <div className="flex flex-col gap-4">
      <RegionFocus region="label">
        <ZplEnumSegmented
          label={loc.printOrientation}
          command="^PO"
          values={PRINT_ORIENTATION_VALUES}
          value={label.printOrientation}
          onChange={(v) => setLabelConfig({ printOrientation: v })}
          defaultLabel={t.printerSettings.defaultOption}
          optionLabel={(m) => loc[ORIENTATION_LABEL_KEYS[m]]}
        />
      </RegionFocus>

      <RegionFocus region="label">
        <ZplCheckbox
          text={loc.mirror}
          command="^PM"
          checked={label.mirror === "Y"}
          onChange={(v) => setLabelConfig({ mirror: v ? "Y" : undefined })}
        />
      </RegionFocus>

      {/* Tri-state so an imported explicit ^MCY stays visible and editable. */}
      <RegionFocus region="label">
        <ZplEnumSegmented
          label={loc.mapClear}
          command="^MC"
          values={['Y', 'N'] as const}
          value={label.mapClear}
          onChange={(mapClear) => setLabelConfig({ mapClear })}
          defaultLabel={t.printerSettings.defaultOption}
          optionLabel={(v) => v === 'Y' ? loc.mapClearOptionClear : loc.mapClearOptionRetain}
          hint={loc.mapClearHint}
        />
      </RegionFocus>

      {/* Speed triple: ^PR a,b,c; print / slew / backfeed. All
          three share the same 2..14 ips range and one ^PR command,
          so group them under one ZplField + tag header. */}
      <RegionFocus region="exit">
      <ZplField>
        <ZplCommandLabel text={loc.printSpeedHeading} command="^PR" />
        <div className={`grid grid-cols-3 ${fieldGridCols}`}>
          <ZplSubField label={loc.printSpeed} className={fieldGridCell}>
            {(id) => (
              <BoundedIntControl
                id={id}
                min={SPEED_RANGE.min}
                max={SPEED_RANGE.max}
                value={label.printSpeed}
                onChange={(v) => setLabelConfig({ printSpeed: v })}
              />
            )}
          </ZplSubField>
          <ZplSubField label={loc.slewSpeed} className={fieldGridCell}>
            {(id) => (
              <BoundedIntControl
                id={id}
                min={SPEED_RANGE.min}
                max={SPEED_RANGE.max}
                value={label.slewSpeed}
                onChange={(v) => setLabelConfig({ slewSpeed: v })}
              />
            )}
          </ZplSubField>
          <ZplSubField label={loc.backfeedSpeed} className={fieldGridCell}>
            {(id) => (
              <BoundedIntControl
                id={id}
                min={SPEED_RANGE.min}
                max={SPEED_RANGE.max}
                value={label.backfeedSpeed}
                onChange={(v) => setLabelConfig({ backfeedSpeed: v })}
              />
            )}
          </ZplSubField>
        </div>
      </ZplField>
      </RegionFocus>

      {/* ^MD permanent darkness; the EEPROM-persistent set value. */}
      <RegionFocus region="printhead">
        <ZplBoundedIntInput
          label={loc.darknessPermanent}
          command="^MD"
          min={DARKNESS_PERMANENT_RANGE.min}
          max={DARKNESS_PERMANENT_RANGE.max}
          value={label.darkness}
          onChange={(v) => setLabelConfig({ darkness: v })}
        />
      </RegionFocus>

      {/* ~SD instant darkness override. Separate row from ^MD so
          each command keeps its own tag (the earlier shared-^MD
          grid mis-labelled the ~SD slot as ^MD). */}
      <RegionFocus region="printhead">
        <ZplBoundedIntInput
          label={loc.darknessInstant}
          command="~SD"
          min={DARKNESS_INSTANT_RANGE.min}
          max={DARKNESS_INSTANT_RANGE.max}
          value={label.instantDarkness}
          onChange={(v) => setLabelConfig({ instantDarkness: v })}
        />
      </RegionFocus>

      {/* ^MU b,c: both-or-neither pair; picking one slot seeds the other. */}
      <RegionFocus region="printhead">
        <ZplField>
          <ZplCommandLabel text={loc.muHeading} command="^MU" />
          <div className={`grid grid-cols-2 ${fieldGridCols}`}>
            <ZplEnumSubCustomSelect
              label={loc.muFormatDpi}
              values={MU_DPI_STRINGS}
              value={label.muResampling ? String(label.muResampling.formatDpi) : undefined}
              onChange={(v) => setMuSlot('formatDpi', v)}
              defaultLabel={t.printerSettings.defaultOption}
              optionLabel={(d) => `${MU_PHYSICAL_DPI[d] ?? d} dpi`}
              className={fieldGridCell}
            />
            <ZplEnumSubCustomSelect
              label={loc.muOutputDpi}
              values={MU_DPI_STRINGS}
              value={label.muResampling ? String(label.muResampling.outputDpi) : undefined}
              onChange={(v) => setMuSlot('outputDpi', v)}
              defaultLabel={t.printerSettings.defaultOption}
              optionLabel={(d) => `${MU_PHYSICAL_DPI[d] ?? d} dpi`}
              className={fieldGridCell}
            />
          </div>
        </ZplField>
      </RegionFocus>

      {/* Printer default for ^JZ is "Y" (reprint enabled). The
          unchecked state must explicitly emit "N", otherwise the
          printer falls back to its default and the user cannot
          actually disable reprint from this UI. */}
      <RegionFocus region="stack">
        <ZplCheckbox
          text={loc.reprintAfterError}
          command="^JZ"
          checked={profile.reprintAfterError !== "N"}
          onChange={(v) => patchPrinterProfile({ reprintAfterError: v ? "Y" : "N" })}
        />
      </RegionFocus>

      <RegionFocus region="printhead">
        <ZplBoundedIntInput
          label={loc.headTestInterval}
          command="^JT"
          min={HEAD_TEST_INTERVAL_RANGE.min}
          max={HEAD_TEST_INTERVAL_RANGE.max}
          value={profile.headTestInterval}
          onChange={(v) => patchPrinterProfile({ headTestInterval: v })}
        />
      </RegionFocus>

      <RegionFocus region="exit">
        <ZplBoundedIntInput
          label={loc.tearOffAdjust}
          command="~TA"
          min={TEAR_OFF_ADJUST_RANGE.min}
          max={TEAR_OFF_ADJUST_RANGE.max}
          value={profile.tearOffAdjust}
          onChange={(v) => patchPrinterProfile({ tearOffAdjust: v })}
          unit={t.printerSettings.dotsUnit}
        />
      </RegionFocus>

      <RegionFocus region="label">
        <ZplEnumSegmented
          label={loc.codeValidation}
          command="^CV"
          values={['Y', 'N'] as const}
          value={profile.codeValidation}
          onChange={(codeValidation) => patchPrinterProfile({ codeValidation })}
          defaultLabel={t.printerSettings.defaultOption}
          optionLabel={(v) => v === 'Y' ? loc.codeValidationOn : loc.codeValidationOff}
        />
      </RegionFocus>
    </div>
  );
}
