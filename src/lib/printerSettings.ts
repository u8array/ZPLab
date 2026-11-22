import { SGD_ALL_SETTINGS, parseSgdDump, sgdAllSettingsWhole, sgdGetvar, type SgdSetting } from "@zplab/core/lib/sgd";
import { readPrinterReply, type PrinterOutcome } from "./printerQuery";
import type { QueryTarget } from "./printTarget";

/** The printer's whole configuration in one round trip. */
export async function readPrinterSettings(target: QueryTarget, signal?: AbortSignal): Promise<PrinterOutcome<SgdSetting[]>> {
  const reply = await readPrinterReply(target, sgdGetvar(SGD_ALL_SETTINGS), { signal, whole: sgdAllSettingsWhole });
  if (reply.kind !== "ok") return reply;
  const settings = parseSgdDump(reply.value.body);
  return settings.length > 0 ? { kind: "ok", value: settings } : { kind: "unparsed" };
}
