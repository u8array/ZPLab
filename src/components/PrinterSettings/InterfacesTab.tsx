import { useId, useState } from "react";
import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import {
  AUX_PORT_SLOTS,
  AUX_PORT_END_PRINT_VALUES,
  AUX_PORT_ERROR_MODE_VALUES,
  AUX_PORT_MODE_VALUES,
  AUX_PORT_START_PRINT_VALUES,
  AUX_PORT_SWITCH_VALUES,
  SERIAL_BAUD_VALUES,
  SERIAL_DATA_BITS_VALUES,
  SERIAL_HANDSHAKE_VALUES,
  SERIAL_PARITY_VALUES,
  SERIAL_PORT_FIELDS,
  SERIAL_PROTOCOL_VALUES,
  SERIAL_STOP_BITS_VALUES,
  type PrinterProfile,
} from "@zplab/core/types/PrinterProfile";
import { ZplCommandLabel, ZplEnumSubCustomSelect, ZplField, ZplFieldHint } from "./zplFieldPrimitives";
import { fieldGridCols, fieldGridCell } from "../ui/formStyles";

type LocInterfaces = ReturnType<typeof useT>["printerSettings"]["interfaces"];
type SerialPort = NonNullable<PrinterProfile["serialPort"]>;

const PARITY_KEYS = { N: "parityN", E: "parityE", O: "parityO" } as const satisfies Record<(typeof SERIAL_PARITY_VALUES)[number], keyof LocInterfaces>;
const HANDSHAKE_KEYS = { X: "handshakeX", D: "handshakeD", R: "handshakeR", M: "handshakeM" } as const satisfies Record<(typeof SERIAL_HANDSHAKE_VALUES)[number], keyof LocInterfaces>;
const PROTOCOL_KEYS = { A: "protocolA", N: "protocolN", Z: "protocolZ" } as const satisfies Record<(typeof SERIAL_PROTOCOL_VALUES)[number], keyof LocInterfaces>;
const AUX_MODE_KEYS = { "0": "auxMode0", "1": "auxMode1", "2": "auxMode2" } as const satisfies Record<(typeof AUX_PORT_MODE_VALUES)[number], keyof LocInterfaces>;
const END_PRINT_KEYS = { "0": "endPrint0", "1": "endPrint1", "2": "endPrint2", "3": "endPrint3", "4": "endPrint4" } as const satisfies Record<(typeof AUX_PORT_END_PRINT_VALUES)[number], keyof LocInterfaces>;
const START_PRINT_KEYS = { p: "startPrintP", l: "startPrintL" } as const satisfies Record<(typeof AUX_PORT_START_PRINT_VALUES)[number], keyof LocInterfaces>;
const ERROR_MODE_KEYS = { e: "errorModeE", f: "errorModeF" } as const satisfies Record<(typeof AUX_PORT_ERROR_MODE_VALUES)[number], keyof LocInterfaces>;
const SWITCH_KEYS = { e: "enabled", d: "disabled" } as const satisfies Record<(typeof AUX_PORT_SWITCH_VALUES)[number], keyof LocInterfaces>;
// The three line settings a host is set up with in practice, 8N1 with XON/XOFF.
const SERIAL_PRESET_BAUDS = ["9600", "19200", "115200"] as const;
const serialPreset = (baud: (typeof SERIAL_PRESET_BAUDS)[number]): SerialPort => ({ baud, dataBits: "8", parity: "N", stopBits: "1", handshake: "X", protocol: "N" });
const noBadge = () => "";

/** Serial port and applicator port of the setup script (^SC, ^JJ). */
export function InterfacesTab() {
  const t = useT();
  const profile = useLabelStore((s) => s.printerProfile);
  const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
  const loc = t.printerSettings.interfaces;
  const serial: SerialPort = profile.serialPort ?? {};
  const serialSlotsSet = SERIAL_PORT_FIELDS.filter((f) => serial[f] !== undefined).length;
  const activePreset = SERIAL_PRESET_BAUDS.find((baud) => SERIAL_PORT_FIELDS.every((f) => serial[f] === serialPreset(baud)[f]));
  const anyAuxSet = AUX_PORT_SLOTS.some(([field]) => profile[field] !== undefined);
  // A set slot ships with the script, so the port hides only while it is empty.
  const [auxOpen, setAuxOpen] = useState(false);
  const auxId = useId();
  const showAux = auxOpen || anyAuxSet;
  // The slots are one command on the wire, so the last cleared slot clears the field.
  const setSerial = (patch: Partial<SerialPort>) => {
    const merged = { ...serial, ...patch };
    // Wire order keeps the object equal by value to what the parser builds.
    const next: SerialPort = Object.fromEntries(SERIAL_PORT_FIELDS.flatMap((f) => (merged[f] === undefined ? [] : [[f, merged[f]]])));
    patchPrinterProfile({ serialPort: SERIAL_PORT_FIELDS.some((f) => next[f] !== undefined) ? next : undefined });
  };

  return (
    <div className="flex flex-col gap-4">
      <ZplField>
        <ZplCommandLabel text={loc.serialHeading} command="^SC" />
        <div className={`grid grid-cols-3 ${fieldGridCols}`}>
          <ZplEnumSubCustomSelect
            label={t.label.preset}
            values={SERIAL_PRESET_BAUDS}
            value={activePreset}
            defaultLabel={activePreset ? undefined : serialSlotsSet === 0 ? loc.notSet : t.label.presetCustom}
            optionLabel={(baud) => `${baud} 8N1 ${loc.handshakeX}`}
            optionBadge={noBadge}
            onChange={(baud) => baud !== undefined && patchPrinterProfile({ serialPort: serialPreset(baud) })}
            className={fieldGridCell}
          />
        </div>
        <div className={`grid grid-cols-3 ${fieldGridCols}`}>
          <ZplEnumSubCustomSelect
            label={loc.baud}
            tooltip={loc.baudTip}
            values={SERIAL_BAUD_VALUES}
            value={serial.baud}
            defaultLabel={loc.notSet}
            optionLabel={(v) => v}
            optionBadge={noBadge}
            onChange={(baud) => setSerial({ baud })}
            className={fieldGridCell}
          />
          <ZplEnumSubCustomSelect
            label={loc.dataBits}
            tooltip={loc.dataBitsTip}
            values={SERIAL_DATA_BITS_VALUES}
            value={serial.dataBits}
            defaultLabel={loc.notSet}
            optionLabel={(v) => v}
            optionBadge={noBadge}
            onChange={(dataBits) => setSerial({ dataBits })}
            className={fieldGridCell}
          />
          <ZplEnumSubCustomSelect
            label={loc.parity}
            tooltip={loc.parityTip}
            values={SERIAL_PARITY_VALUES}
            value={serial.parity}
            defaultLabel={loc.notSet}
            optionLabel={(v) => loc[PARITY_KEYS[v]]}
            onChange={(parity) => setSerial({ parity })}
            className={fieldGridCell}
          />
          <ZplEnumSubCustomSelect
            label={loc.stopBits}
            tooltip={loc.stopBitsTip}
            values={SERIAL_STOP_BITS_VALUES}
            value={serial.stopBits}
            defaultLabel={loc.notSet}
            optionLabel={(v) => v}
            optionBadge={noBadge}
            onChange={(stopBits) => setSerial({ stopBits })}
            className={fieldGridCell}
          />
          <ZplEnumSubCustomSelect
            label={loc.handshake}
            tooltip={loc.handshakeTip}
            values={SERIAL_HANDSHAKE_VALUES}
            value={serial.handshake}
            defaultLabel={loc.notSet}
            optionLabel={(v) => loc[HANDSHAKE_KEYS[v]]}
            onChange={(handshake) => setSerial({ handshake })}
            className={fieldGridCell}
          />
          <ZplEnumSubCustomSelect
            label={loc.protocol}
            tooltip={loc.protocolTip}
            values={SERIAL_PROTOCOL_VALUES}
            value={serial.protocol}
            defaultLabel={loc.notSet}
            optionLabel={(v) => loc[PROTOCOL_KEYS[v]]}
            onChange={(protocol) => setSerial({ protocol })}
            className={fieldGridCell}
          />
        </div>
        <ZplFieldHint>
          <span className="text-warning">{loc.serialBaudHint}</span>
        </ZplFieldHint>
        {serialSlotsSet > 0 && serialSlotsSet < SERIAL_PORT_FIELDS.length ? (
          <ZplFieldHint>
            <span className="text-warning">{loc.serialIncomplete}</span>
          </ZplFieldHint>
        ) : null}
      </ZplField>

      <ZplField>
        <ZplCommandLabel text={loc.auxHeading} command="^JJ" tooltip={loc.auxHint} />
        {anyAuxSet ? null : (
          <button type="button" className="self-start text-xs text-muted hover:text-text" aria-expanded={auxOpen} aria-controls={auxId} onClick={() => setAuxOpen((open) => !open)}>
            {auxOpen ? loc.auxHide : loc.auxShow}
          </button>
        )}
        {showAux ? (
          <div id={auxId} className={`grid grid-cols-2 ${fieldGridCols}`}>
            <ZplEnumSubCustomSelect
              label={loc.auxMode}
              tooltip={loc.auxModeTip}
              values={AUX_PORT_MODE_VALUES}
              value={profile.auxPortMode}
              defaultLabel={t.printerSettings.defaultOption}
              optionLabel={(v) => loc[AUX_MODE_KEYS[v]]}
              onChange={(auxPortMode) => patchPrinterProfile({ auxPortMode })}
              className={fieldGridCell}
            />
            <ZplEnumSubCustomSelect
              label={loc.endPrint}
              tooltip={loc.endPrintTip}
              values={AUX_PORT_END_PRINT_VALUES}
              value={profile.auxPortEndPrint}
              defaultLabel={t.printerSettings.defaultOption}
              optionLabel={(v) => loc[END_PRINT_KEYS[v]]}
              onChange={(auxPortEndPrint) => patchPrinterProfile({ auxPortEndPrint })}
              className={fieldGridCell}
            />
            <ZplEnumSubCustomSelect
              label={loc.startPrint}
              tooltip={loc.startPrintTip}
              values={AUX_PORT_START_PRINT_VALUES}
              value={profile.auxPortStartPrint}
              defaultLabel={t.printerSettings.defaultOption}
              optionLabel={(v) => loc[START_PRINT_KEYS[v]]}
              onChange={(auxPortStartPrint) => patchPrinterProfile({ auxPortStartPrint })}
              className={fieldGridCell}
            />
            <ZplEnumSubCustomSelect
              label={loc.errorMode}
              tooltip={loc.errorModeTip}
              values={AUX_PORT_ERROR_MODE_VALUES}
              value={profile.auxPortErrorMode}
              defaultLabel={t.printerSettings.defaultOption}
              optionLabel={(v) => loc[ERROR_MODE_KEYS[v]]}
              onChange={(auxPortErrorMode) => patchPrinterProfile({ auxPortErrorMode })}
              className={fieldGridCell}
            />
            <ZplEnumSubCustomSelect
              label={loc.reprint}
              tooltip={loc.reprintTip}
              values={AUX_PORT_SWITCH_VALUES}
              value={profile.auxPortReprint}
              defaultLabel={t.printerSettings.defaultOption}
              optionLabel={(v) => loc[SWITCH_KEYS[v]]}
              onChange={(auxPortReprint) => patchPrinterProfile({ auxPortReprint })}
              className={fieldGridCell}
            />
            <ZplEnumSubCustomSelect
              label={loc.ribbonLow}
              tooltip={loc.ribbonLowTip}
              values={AUX_PORT_SWITCH_VALUES}
              value={profile.auxPortRibbonLow}
              defaultLabel={t.printerSettings.defaultOption}
              optionLabel={(v) => loc[SWITCH_KEYS[v]]}
              onChange={(auxPortRibbonLow) => patchPrinterProfile({ auxPortRibbonLow })}
              className={fieldGridCell}
            />
          </div>
        ) : null}
      </ZplField>
    </div>
  );
}
