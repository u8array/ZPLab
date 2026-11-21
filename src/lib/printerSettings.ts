import type { AwaitedReply } from "@zplab/core/lib/documentReplies";
import { SGD_ALL_SETTINGS, SGD_ALL_SETTINGS_END, parseSgdDump, sgdGetvar, sgdGetvarCommand, type SgdSetting } from "@zplab/core/lib/sgd";
import { answeredText, endFailure, readPrinterReply, type PrinterOutcome } from "./printerQuery";
import type { QueryTarget } from "./printTarget";

/** The printer pauses inside the dump for longer than the idle gap, so the read waits for the dump's end. */
const DUMP_END: AwaitedReply = { header: "", terminator: SGD_ALL_SETTINGS_END, count: 1, commands: [sgdGetvarCommand(SGD_ALL_SETTINGS)] };

/** The printer's whole configuration in one round trip. */
export async function readPrinterSettings(target: QueryTarget, signal?: AbortSignal): Promise<PrinterOutcome<SgdSetting[]>> {
  const reply = await readPrinterReply(target, sgdGetvar(SGD_ALL_SETTINGS), { signal, answersAtOnce: true, awaited: [DUMP_END] });
  if (reply.kind !== "ok") return reply;
  const { body, unanswered, end } = reply.value;
  if (answeredText(body).kind === "silent") return { kind: "silent" };
  if (unanswered.length > 0) return endFailure(end) ?? { kind: "incomplete" };
  const settings = parseSgdDump(body);
  return settings.length > 0 ? { kind: "ok", value: settings } : { kind: "unparsed" };
}
