import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import {
  RFID_EPC_BITS_RANGE,
  RFID_EPC_PARTITION_RANGE,
  RFID_ERROR_HANDLING_VALUES,
  parseRfidPower,
  RFID_RETRIES_RANGE,
  SLEW_DOT_ROWS_RANGE,
  SPEED_RANGE,
  type RfidErrorHandling,
} from "@zplab/core/types/LabelConfig";
import {
  BoundedIntControl,
  SafeStringInput,
  ZplBoundedIntInput,
  ZplCheckbox,
  ZplCommandLabel,
  ZplEnumCustomSelect,
  ZplField,
  ZplFieldHint,
  ZplSubField,
} from "./zplFieldPrimitives";
import { fieldGridCols, fieldGridCell, labelCls, zplCommandTagCls } from "../ui/formStyles";
import { PlusIcon, TrashIcon, ViewfinderCircleIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import {
  SGTIN_96_FIELDS,
  epcAddField,
  epcFieldRange,
  epcRemoveField,
  epcSetField,
  epcSetTotal,
  epcSetTrailing,
  epcTotalRange,
  splitEpcBits,
} from "@zplab/core/lib/rfidEpc";
import {
  rfidAmountRange,
  rfidPositionConvert,
  rfidPositionFromParts,
  rfidPositionParts,
  type RfidPositionMode,
} from "@zplab/core/lib/rfidPosition";
import { RegionFocus } from "./printerIllustration";

type LocRfid = ReturnType<typeof useT>["printerSettings"]["rfid"];

const sectionHeadingCls = "font-mono text-[10px] uppercase tracking-widest text-muted";

const iconBtnCls =
  "p-1 rounded border border-border text-muted hover:text-text hover:bg-surface-2 transition-colors";

const POSITION_MODES = ["F", "B", "abs"] as const;

const MODE_LABEL_KEYS = {
  F: "positionModeForward",
  B: "positionModeBackfeed",
  abs: "positionModeAbsolute",
} as const satisfies Record<RfidPositionMode, keyof LocRfid>;

const MODE_HINT_KEYS = {
  F: "positionForwardHint",
  B: "positionBackfeedHint",
  abs: "positionAbsoluteHint",
} as const satisfies Record<RfidPositionMode, keyof LocRfid>;

const ERROR_LABEL_KEYS = {
  N: "errorHandlingN",
  P: "errorHandlingP",
  E: "errorHandlingE",
} as const satisfies Record<RfidErrorHandling, keyof LocRfid>;

const upperAlnum = (raw: string): string => raw.toUpperCase().replace(/[^0-9HML]/g, "");

/** Spec-only RFID setup (^RS / ^RB / ^RW): encoding needs an R-series
 *  printer, so the design just carries the commands. */
export function RfidTab() {
  const t = useT();
  const label = useLabelStore((s) => s.label);
  const setLabelConfig = useLabelStore((s) => s.setLabelConfig);
  const startRfidPositionPick = useLabelStore((s) => s.startRfidPositionPick);
  const loc = t.printerSettings.rfid;

  const epcBits = label.rfidEpcBits;
  const partitions = label.rfidEpcPartitions;
  const totalRange = epcTotalRange(partitions, RFID_EPC_BITS_RANGE.max);
  const fields = partitions ?? (epcBits !== undefined ? [epcBits] : []);
  const nextFields = partitions
    ? epcAddField(epcBits ?? 0, partitions)
    : splitEpcBits(epcBits);
  const parts = rfidPositionParts(label.rfidPosition);
  // A lone field is no structure, so it collapses to the plain total.
  const setPartitions = (next: number[]) =>
    setLabelConfig(
      next.length > 1
        ? { rfidEpcPartitions: next, rfidEpcBits: next.reduce((a, b) => a + b, 0) }
        : { rfidEpcPartitions: undefined },
    );
  const amountRange = rfidAmountRange(parts?.mode ?? "F", label.heightMm * label.dpmm);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">{loc.specOnlyHint}</p>

      {/* Grouped by what the printer does: what to encode, and what happens
          when encoding fails. Both groups are ^RS parameters, which is why
          the tag stays on the fields rather than the headings. */}
      <section className="flex flex-col gap-4 border-t border-border pt-4">
      <h3 className={sectionHeadingCls}>{loc.encodingHeading}</h3>

      <RegionFocus region="antenna">
        <ZplCheckbox
          text={loc.tagTypeGen2}
          command="^RS"
          checked={label.rfidTagType === 8}
          onChange={(v) => setLabelConfig({ rfidTagType: v ? 8 : undefined })}
        />
      </RegionFocus>

      <RegionFocus region="antenna">
        <ZplField>
          <ZplCommandLabel text={loc.position} command="^RS" />
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Select<RfidPositionMode | "">
                value={parts?.mode ?? ""}
                onChange={(next) => {
                  if (next === "") {
                    setLabelConfig({ rfidPosition: undefined });
                    return;
                  }
                  const range = rfidAmountRange(next, label.heightMm * label.dpmm);
                  // Absolute counts dots, F/B count mm: carry the distance,
                  // not the raw number.
                  const carried = parts
                    ? rfidPositionConvert(parts.mode, next, parts.amount, label.dpmm)
                    : 0;
                  setLabelConfig({
                    rfidPosition: rfidPositionFromParts(
                      next,
                      Math.max(range.min, Math.min(carried, range.max)),
                    ),
                  });
                }}
                groups={[
                  {
                    options: [
                      { value: "" as const, label: t.printerSettings.defaultOption },
                      ...POSITION_MODES.map((m) => ({
                        value: m,
                        label: loc[MODE_LABEL_KEYS[m]],
                        badge: m === "abs" ? undefined : m,
                      })),
                    ],
                  },
                ]}
              />
            </div>
            <div className="w-24">
              <BoundedIntControl
                ariaLabel={loc.position}
                disabled={parts === undefined}
                min={amountRange.min}
                max={amountRange.max}
                value={parts?.amount}
                onChange={(amount) =>
                  setLabelConfig({
                    rfidPosition:
                      amount === undefined
                        ? undefined
                        : rfidPositionFromParts(parts?.mode ?? "F", amount),
                  })
                }
              />
            </div>
            <span className={labelCls}>
              {parts?.mode === "abs" ? t.printerSettings.dotsUnit : loc.mmUnit}
            </span>
            <Tooltip content={loc.pickOnLabel}>
              <button
                type="button"
                onClick={startRfidPositionPick}
                aria-label={loc.pickOnLabel}
                className={iconBtnCls}
              >
                <ViewfinderCircleIcon className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
          {/* The hint describes the selected notation, so it waits for one. */}
          {parts && <ZplFieldHint>{loc[MODE_HINT_KEYS[parts.mode]]}</ZplFieldHint>}
        </ZplField>
      </RegionFocus>

      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-4">
      <h3 className={sectionHeadingCls}>{loc.failureHeading}</h3>

      <RegionFocus region="exit">
        <ZplBoundedIntInput
          label={loc.voidLength}
          command="^RS"
          min={SLEW_DOT_ROWS_RANGE.min}
          max={SLEW_DOT_ROWS_RANGE.max}
          value={label.rfidVoidLength}
          onChange={(v) => setLabelConfig({ rfidVoidLength: v })}
          unit={t.printerSettings.dotsUnit}
        />
      </RegionFocus>

      <RegionFocus region="exit">
        <ZplBoundedIntInput
          label={loc.retries}
          command="^RS"
          min={RFID_RETRIES_RANGE.min}
          max={RFID_RETRIES_RANGE.max}
          value={label.rfidRetries}
          onChange={(v) => setLabelConfig({ rfidRetries: v })}
        />
      </RegionFocus>

      <RegionFocus region="exit">
        <ZplEnumCustomSelect
          label={loc.errorHandling}
          command="^RS"
          values={RFID_ERROR_HANDLING_VALUES}
          value={label.rfidErrorHandling}
          onChange={(v) => setLabelConfig({ rfidErrorHandling: v })}
          defaultLabel={t.printerSettings.defaultOption}
          optionLabel={(m) => loc[ERROR_LABEL_KEYS[m]]}
        />
      </RegionFocus>

      <RegionFocus region="exit">
        <ZplBoundedIntInput
          label={loc.voidSpeed}
          command="^RS"
          min={SPEED_RANGE.min}
          max={SPEED_RANGE.max}
          value={label.rfidVoidSpeed}
          onChange={(v) => setLabelConfig({ rfidVoidSpeed: v })}
        />
      </RegionFocus>

      </section>

      <RegionFocus region="antenna" className="border-t border-border pt-4">
        <ZplField>
          <div className="flex items-start justify-between gap-2">
            <span className={labelCls}>
              {loc.epcHeading}
              <Tooltip content={loc.epcHint}>
                <InformationCircleIcon className="w-3.5 h-3.5 ml-1 inline-block align-text-bottom text-muted cursor-help" />
              </Tooltip>
            </span>
            <span className={zplCommandTagCls}>^RB</span>
          </div>
          {/* The tag width is the given; the fields divide it and the last
              one is derived, so no edit can break the sum rule. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={labelCls}>{loc.epcBits}</span>
            <div className="w-16">
              <BoundedIntControl
                ariaLabel={loc.epcBits}
                min={totalRange.min}
                max={totalRange.max}
                value={epcBits}
                onChange={(next) => {
                  if (next === undefined) {
                    setLabelConfig({ rfidEpcBits: undefined, rfidEpcPartitions: undefined });
                    return;
                  }
                  setLabelConfig({
                    rfidEpcBits: next,
                    rfidEpcPartitions: partitions ? epcSetTotal(partitions, next) : undefined,
                  });
                }}
              />
            </div>
          </div>

          {/* Unpartitioned still shows one field: the whole tag is the
              remainder, so adding one splits it instead of conjuring two. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={labelCls}>{loc.epcPartitions}</span>
            {fields.map((bits, i) => {
              // The trailing field is the remainder: typing into it claims
              // bits the leading ones do not, so it sets the tag width.
              const trailing = i === fields.length - 1;
              const range = trailing
                ? { min: RFID_EPC_PARTITION_RANGE.min, max: RFID_EPC_BITS_RANGE.max }
                : epcFieldRange(epcBits ?? 0, fields, i);
              return (
                <div key={i} className="group relative w-14">
                  <BoundedIntControl
                    ariaLabel={`${loc.epcPartitions} ${i + 1}`}
                    min={range.min}
                    max={range.max}
                    value={bits}
                    onChange={(next) => {
                      if (next === undefined) {
                        if (!partitions) {
                          setLabelConfig({ rfidEpcBits: undefined });
                          return;
                        }
                        const kept = epcRemoveField(epcBits ?? 0, partitions, i);
                        if (kept) setPartitions(kept);
                        return;
                      }
                      if (!partitions) {
                        // No structure yet: this field IS the tag width, so
                        // the per-partition 64-bit cap does not apply.
                        setLabelConfig({ rfidEpcBits: next });
                        return;
                      }
                      if (!trailing) {
                        setPartitions(epcSetField(epcBits ?? 0, fields, i, next));
                        return;
                      }
                      const grown = epcSetTrailing(fields, next);
                      setLabelConfig({
                        rfidEpcBits: grown.total,
                        rfidEpcPartitions: grown.partitions,
                      });
                    }}
                  />
                  {partitions && epcRemoveField(epcBits ?? 0, partitions, i) && (
                  <button
                    type="button"
                    onClick={() => {
                      const kept = epcRemoveField(epcBits ?? 0, partitions, i);
                      if (kept) setPartitions(kept);
                    }}
                    aria-label={loc.epcRemovePartition}
                    className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-muted hover:text-text group-hover:flex group-focus-within:flex"
                  >
                    <XMarkIcon className="h-2.5 w-2.5" />
                  </button>
                  )}
                </div>
              );
            })}

            {nextFields !== null && (
              <Tooltip content={loc.epcAddPartition}>
                <button
                  type="button"
                  onClick={() => setPartitions(nextFields)}
                  aria-label={loc.epcAddPartition}
                  className={iconBtnCls}
                >
                  <PlusIcon className="w-3 h-3" />
                </button>
              </Tooltip>
            )}
          </div>

          {epcBits === undefined ? (
            <div className="flex h-6 items-center justify-center rounded border border-dashed border-border text-[10px] text-muted">
              {loc.epcEmpty}
            </div>
          ) : (
            <div className="flex h-6 w-full overflow-hidden rounded border border-border">
              {fields.map((bits, i) => (
                <div
                  key={i}
                  style={{ width: `${(bits / epcBits) * 100}%` }}
                  className={`flex items-center justify-center overflow-hidden font-mono text-[10px] ${
                    i > 0 ? "border-l border-border" : ""
                  } ${i % 2 === 0 ? "bg-accent/20 text-text" : "bg-surface-2 text-muted"}`}
                >
                  {bits}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Tooltip content={loc.epcPresetSgtin}>
              <button
                type="button"
                onClick={() => setLabelConfig({ rfidEpcBits: 96, rfidEpcPartitions: [...SGTIN_96_FIELDS] })}
                className={`${iconBtnCls} font-mono text-[10px] px-2`}
              >
                SGTIN-96
              </button>
            </Tooltip>
            {partitions && (
              <Tooltip content={loc.epcClearPartitions}>
                <button
                  type="button"
                  onClick={() => setPartitions([])}
                  aria-label={loc.epcClearPartitions}
                  className={iconBtnCls}
                >
                  <TrashIcon className="w-3 h-3" />
                </button>
              </Tooltip>
            )}
          </div>
        </ZplField>
      </RegionFocus>

      <RegionFocus region="antenna" className="border-t border-border pt-4">
        <ZplField>
          <ZplCommandLabel text={loc.powerHeading} command="^RW" />
          <div className={`grid grid-cols-2 ${fieldGridCols}`}>
            <ZplSubField label={loc.readPower} className={fieldGridCell}>
              {(id) => (
              <SafeStringInput
                id={id}
                value={label.rfidReadPower?.toString() ?? ""}
                sanitize={upperAlnum}
                onChange={(raw) => setLabelConfig({ rfidReadPower: parseRfidPower(raw) })}
                placeholder="16"
              />
              )}
            </ZplSubField>
            <ZplSubField label={loc.writePower} className={fieldGridCell}>
              {(id) => (
              <SafeStringInput
                id={id}
                value={label.rfidWritePower?.toString() ?? ""}
                sanitize={upperAlnum}
                onChange={(raw) => setLabelConfig({ rfidWritePower: parseRfidPower(raw) })}
                placeholder="L"
              />
              )}
            </ZplSubField>
          </div>
          <ZplFieldHint>{loc.powerHint}</ZplFieldHint>
        </ZplField>
      </RegionFocus>
    </div>
  );
}
