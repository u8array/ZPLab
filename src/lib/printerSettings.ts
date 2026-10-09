import { SGD_ALL_SETTINGS, parseSgdDump, sgdGetvar, type SgdSetting } from "@zplab/core/lib/sgd";
import { queryPrinter, type PrinterOutcome } from "./printerQuery";
import type { QueryTarget } from "./printTarget";

/** The printer's whole configuration in one round trip. */
export async function readPrinterSettings(target: QueryTarget): Promise<PrinterOutcome<SgdSetting[]>> {
  const reply = await queryPrinter(target, sgdGetvar(SGD_ALL_SETTINGS));
  if (reply.kind !== "ok") return reply;
  const settings = parseSgdDump(reply.value);
  return settings.length > 0 ? { kind: "ok", value: settings } : { kind: "unparsed" };
}
