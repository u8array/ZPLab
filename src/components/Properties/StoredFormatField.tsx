import { useState } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";
import { useT } from "../../hooks/useT";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import { FieldLabel } from "./ZplCmd";
import { SafeStringInput } from "../PrinterSettings/zplFieldPrimitives";
import { canonicalStoredFormatPath, MAX_STORED_FORMAT_NAME_LEN, parseStoragePath, sanitizeStoredFormatName, STORAGE_DEVICES } from "@zplab/core/lib/storagePath";

/** The page's ^DF as drive plus name and the path it stores under. */
export function StoredFormatField({
  path,
  locked,
  onChange,
}: {
  path: string | undefined;
  locked: boolean;
  onChange: (path: string | undefined) => void;
}) {
  const t = useT();
  const parsed = path === undefined ? null : parseStoragePath(path, "R");
  const [device, setDevice] = useState(parsed?.device ?? "E");
  // The drive follows the page's path, and a cleared name keeps it for the next one.
  if (parsed?.device !== undefined && parsed.device !== device) setDevice(parsed.device);
  const name = parsed?.name ?? "";
  const pathOf = (d: string, n: string) => (n === "" ? undefined : canonicalStoredFormatPath(`${d}:${n}`));
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel cmd="^DF">
        <Tooltip content={t.label.storedFormatHint}>
          <span>{t.template.onPrinter}</span>
        </Tooltip>
      </FieldLabel>
      <div className="grid grid-cols-[auto_1fr_auto] gap-1 items-center">
        <Select<string>
          value={device}
          disabled={locked}
          aria-label={t.registry.image.storage}
          onChange={(d) => {
            setDevice(d);
            if (name !== "") onChange(pathOf(d, name));
          }}
          groups={[{ options: STORAGE_DEVICES.map((d) => ({ value: d, label: `${d}:` })) }]}
        />
        <SafeStringInput
          value={name}
          placeholder={t.label.storedFormatName}
          aria-label={t.template.onPrinter}
          maxLength={MAX_STORED_FORMAT_NAME_LEN}
          disabled={locked}
          sanitize={sanitizeStoredFormatName}
          onChange={(n) => onChange(pathOf(device, n))}
        />
        <Tooltip content={t.template.clear}>
          <button
            type="button"
            aria-label={t.template.clear}
            disabled={locked || name === ""}
            onClick={() => onChange(undefined)}
            className="text-muted hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>
      <span className="text-[10px] text-muted font-mono">{path ?? t.template.notStored}</span>
    </div>
  );
}
