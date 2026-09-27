import { useT } from "../../hooks/useT";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import { FieldLabel } from "./ZplCmd";
import { SafeStringInput } from "../PrinterSettings/zplFieldPrimitives";
import { canonicalStoredFormatPath, MAX_STORED_FORMAT_NAME_LEN, parseStoragePath, sanitizeStoredFormatName, STORAGE_DEVICES } from "@zplab/core/lib/storagePath";
import type { StoredFormatDelivery } from "@zplab/core/types/LabelConfig";
import type { RecallWayIssue } from "@zplab/core/lib/zplGenerator";
import { DeliverySelect } from "./DeliverySelect";

/** The page's ^DF as drive plus name, and how jobs deliver it. An empty name stores nothing. */
export function StoredFormatField({
  path,
  delivery,
  issue,
  locked,
  onChange,
  onDeliveryChange,
}: {
  path: string | undefined;
  delivery: StoredFormatDelivery | undefined;
  issue: RecallWayIssue | undefined;
  locked: boolean;
  onChange: (path: string | undefined) => void;
  onDeliveryChange: (way: StoredFormatDelivery | undefined) => void;
}) {
  const t = useT();
  // A fresh field starts on flash; a stored path always names its device.
  const parsed = path === undefined ? null : parseStoragePath(path, "R");
  const device = parsed?.device ?? "E";
  const name = parsed?.name ?? "";
  const pathOf = (d: string, n: string) => (n === "" ? undefined : canonicalStoredFormatPath(`${d}:${n}`));
  const blocked = issue === undefined ? undefined : issue === "longName" ? t.delivery.formatNeedsShortName : t.delivery.formatNameContested;
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel cmd="^DF">
        <Tooltip content={t.label.storedFormatHint}>
          <span>{t.label.storedFormat}</span>
        </Tooltip>
      </FieldLabel>
      <div className="grid grid-cols-[auto_1fr_auto] gap-1 items-center">
        <Select<string>
          value={device}
          disabled={locked || name === ""}
          aria-label={t.registry.image.storage}
          onChange={(d) => onChange(pathOf(d, name))}
          groups={[{ options: STORAGE_DEVICES.map((d) => ({ value: d, label: `${d}:` })) }]}
        />
        <SafeStringInput
          value={name}
          placeholder={t.label.storedFormatName}
          aria-label={t.label.storedFormat}
          maxLength={MAX_STORED_FORMAT_NAME_LEN}
          disabled={locked}
          sanitize={sanitizeStoredFormatName}
          onChange={(n) => onChange(pathOf(device, n))}
        />
        <span className="font-mono text-[10px] text-muted">.ZPL</span>
      </div>
      {path !== undefined && (
        <div inert={locked}>
          <DeliverySelect
            resource="format"
            subject={path}
            value={delivery !== undefined && issue !== "longName" ? delivery : "job"}
            onChange={(next) => onDeliveryChange(next === "job" ? undefined : next)}
            blocked={blocked === undefined ? undefined : { setup: blocked, printer: blocked }}
            issue={issue === "contested" && delivery !== undefined ? blocked : undefined}
          />
        </div>
      )}
    </div>
  );
}
