import { useT } from "../../hooks/useT";
import { Select } from "../ui/Select";
import { FieldLabel } from "./ZplCmd";
import { SafeStringInput } from "../PrinterSettings/zplFieldPrimitives";
import { canonicalStoredFormatPath, MAX_STORED_FORMAT_NAME_LEN, parseStoragePath, sanitizeStoredFormatName, STORAGE_DEVICES } from "@zplab/core/lib/storagePath";

/** The page's ^DF as drive plus name. An empty name stores nothing. */
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
  // A fresh field starts on flash; a stored path always names its device.
  const parsed = path === undefined ? null : parseStoragePath(path, "R");
  const device = parsed?.device ?? "E";
  const name = parsed?.name ?? "";
  const pathOf = (d: string, n: string) => (n === "" ? undefined : canonicalStoredFormatPath(`${d}:${n}`));
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel cmd="^DF">{t.label.storedFormat}</FieldLabel>
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
      <p className="text-[10px] text-muted leading-snug">{t.label.storedFormatHint}</p>
    </div>
  );
}
