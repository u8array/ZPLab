import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import {
  SENSOR_SLOT_RANGE,
  MEDIA_SENSOR_SELECT_VALUES,
  PRINTHEAD_RESISTANCE_RANGE,
  SENSOR_INTENSITY_RANGE,
  SENSOR_SLOTS,
  type SensorSlotField,
  XS_SLOTS,
} from "@zplab/core/types/PrinterProfile";
import { YES_NO_VALUES } from "@zplab/core/types/typeHelpers";
import {
  BoundedIntControl,
  ZplBoundedIntInput,
  ZplCommandLabel,
  ZplEnumCustomSelect,
  ZplEnumSegmented,
  ZplField,
  ZplFieldHint,
  ZplSubField,
} from "./zplFieldPrimitives";
import { fieldGridCols, fieldGridCell } from "../ui/formStyles";

type LocSensors = ReturnType<typeof useT>["printerSettings"]["sensors"];

const SLOT_LABEL_KEYS = {
  sensorWebThreshold: "web",
  sensorMediaThreshold: "media",
  sensorRibbonThreshold: "ribbon",
  sensorLabelLengthDots: "labelLength",
  sensorMediaLedIntensity: "mediaLed",
  sensorRibbonLedIntensity: "ribbonLed",
  sensorMarkThreshold: "mark",
  sensorMarkMediaThreshold: "markMedia",
  sensorMarkLedIntensity: "markLed",
} as const satisfies Record<SensorSlotField, keyof LocSensors>;
// The wire packs the slots by kind, the operator thinks per sensor.
const SENSOR_GROUPS = [
  ["gapGroup", ["sensorWebThreshold", "sensorMediaThreshold", "sensorMediaLedIntensity", "sensorLabelLengthDots"]],
  ["ribbonGroup", ["sensorRibbonThreshold", "sensorRibbonLedIntensity"]],
  ["markGroup", ["sensorMarkThreshold", "sensorMarkMediaThreshold", "sensorMarkLedIntensity"]],
] as const satisfies readonly (readonly [keyof LocSensors, readonly SensorSlotField[]])[];

/** Sensor and calibration values of the setup script (^JS, ^SS, ^SI, ^XS, ^SR). */
export function SensorsTab() {
  const t = useT();
  const profile = useLabelStore((s) => s.printerProfile);
  const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
  const loc = t.printerSettings.sensors;
  const onOffLabel = (v: "Y" | "N") => (v === "Y" ? loc.dynamicOn : loc.dynamicOff);
  const anySlotSet = SENSOR_SLOTS.some(([field]) => profile[field] !== undefined);
  // ^XS defaults to Y on every slot, spec p.374, so only an explicit N keeps typed values.
  const recalibrates = XS_SLOTS.some((field) => profile[field] !== "N");

  return (
    <div className="flex flex-col gap-4">
      <ZplEnumCustomSelect
        label={loc.sensorSelect}
        command="^JS"
        tooltip={loc.sensorSelectTip}
        values={MEDIA_SENSOR_SELECT_VALUES}
        value={profile.mediaSensorSelect}
        defaultLabel={t.printerSettings.defaultOption}
        optionLabel={(v) => loc[`sensorSelect${v}`]}
        onChange={(mediaSensorSelect) => patchPrinterProfile({ mediaSensorSelect })}
      />

      <ZplEnumSegmented
        label={loc.dynamicLength}
        command="^XS"
        tooltip={loc.dynamicLengthTip}
        values={YES_NO_VALUES}
        value={profile.dynamicCalibrationLength}
        defaultLabel={loc.dynamicDefaultOn}
        optionLabel={onOffLabel}
        onChange={(dynamicCalibrationLength) => patchPrinterProfile({ dynamicCalibrationLength })}
      />
      <ZplEnumSegmented
        label={loc.dynamicThreshold}
        command="^XS"
        tooltip={loc.dynamicThresholdTip}
        values={YES_NO_VALUES}
        value={profile.dynamicCalibrationThreshold}
        defaultLabel={loc.dynamicDefaultOn}
        optionLabel={onOffLabel}
        onChange={(dynamicCalibrationThreshold) => patchPrinterProfile({ dynamicCalibrationThreshold })}
      />
      <ZplEnumSegmented
        label={loc.dynamicGain}
        command="^XS"
        tooltip={loc.dynamicGainTip}
        values={YES_NO_VALUES}
        value={profile.dynamicCalibrationGain}
        defaultLabel={loc.dynamicDefaultOn}
        optionLabel={onOffLabel}
        onChange={(dynamicCalibrationGain) => patchPrinterProfile({ dynamicCalibrationGain })}
      />

      <ZplField>
        <ZplCommandLabel text={loc.mediaSensorsHeading} command="^SS" tooltip={loc.calibrationTip} />
        {SENSOR_GROUPS.map(([group, fields]) => (
          <div key={group} className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-muted/70">{loc[group]}</span>
            <div className={`grid grid-cols-3 ${fieldGridCols}`}>
              {fields.map((field) => (
                <ZplSubField key={field} label={loc[SLOT_LABEL_KEYS[field]]} tooltip={loc[`${SLOT_LABEL_KEYS[field]}Tip`]} className={fieldGridCell}>
                  {(id) => <BoundedIntControl id={id} min={SENSOR_SLOT_RANGE[field].min} max={SENSOR_SLOT_RANGE[field].max} value={profile[field]} onChange={(v) => patchPrinterProfile({ [field]: v })} />}
                </ZplSubField>
              ))}
            </div>
          </div>
        ))}
        {anySlotSet && recalibrates ? (
          <ZplFieldHint>
            <span className="text-warning">{loc.recalibrateWarning}</span>
          </ZplFieldHint>
        ) : null}
      </ZplField>

      <ZplField>
        <ZplCommandLabel text={loc.intensityHeading} command="^SI" tooltip={loc.intensityTip} />
        <div className={`grid grid-cols-2 ${fieldGridCols}`}>
          <ZplSubField label={loc.brightness} tooltip={loc.brightnessTip} className={fieldGridCell}>
            {(id) => <BoundedIntControl id={id} min={SENSOR_INTENSITY_RANGE.min} max={SENSOR_INTENSITY_RANGE.max} value={profile.sensorBrightness} onChange={(sensorBrightness) => patchPrinterProfile({ sensorBrightness })} />}
          </ZplSubField>
          <ZplSubField label={loc.baseline} tooltip={loc.baselineTip} className={fieldGridCell}>
            {(id) => <BoundedIntControl id={id} min={SENSOR_INTENSITY_RANGE.min} max={SENSOR_INTENSITY_RANGE.max} value={profile.sensorBaseline} onChange={(sensorBaseline) => patchPrinterProfile({ sensorBaseline })} />}
          </ZplSubField>
        </div>
      </ZplField>

      <ZplBoundedIntInput
        label={loc.resistance}
        command="^SR"
        tooltip={loc.resistanceTip}
        min={PRINTHEAD_RESISTANCE_RANGE.min}
        max={PRINTHEAD_RESISTANCE_RANGE.max}
        value={profile.printheadResistance}
        onChange={(printheadResistance) => patchPrinterProfile({ printheadResistance })}
        hint={<span className="text-warning">{loc.resistanceHint}</span>}
      />
    </div>
  );
}
