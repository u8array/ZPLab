import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { parsePort } from "../../lib/printTarget";
import { labelCls, inputCls } from "../ui/formStyles";

/** The printer's network address, shared by the send dialog and the printer settings. Every keystroke commits,
 *  the host trimmed and the port only when it stays one, so the fields never show a value a send would not use. */
export function PrinterAddressFields() {
  const t = useT();
  const host = useLabelStore((s) => s.printTarget.host);
  const port = useLabelStore((s) => s.printTarget.port);
  const setPrintTarget = useLabelStore((s) => s.setPrintTarget);
  const editPort = (draft: string) => {
    const parsed = parsePort(draft);
    if (parsed !== null) setPrintTarget({ port: parsed });
  };
  return (
    <div className="flex gap-2 max-w-md">
      <div className="flex-1 flex flex-col gap-1">
        <label className={labelCls}>{t.zebraPrint.ipAddress}</label>
        <input
          type="text"
          value={host}
          onChange={(e) => setPrintTarget({ host: e.target.value.trim() })}
          placeholder="192.168.1.100"
          className={inputCls}
        />
      </div>
      <div className="w-24 flex flex-col gap-1">
        <label className={labelCls}>{t.zebraPrint.port}</label>
        <input
          type="number"
          min={1}
          max={65535}
          value={String(port)}
          onChange={(e) => editPort(e.target.value)}
          className={inputCls}
        />
      </div>
    </div>
  );
}
