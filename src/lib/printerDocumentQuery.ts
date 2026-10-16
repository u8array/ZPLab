import { hostCommandParts } from "@zplab/core/lib/hostCommands";
import { parseHostReplies, type HostReplyParts } from "@zplab/core/lib/hostReplies";
import { answered, queryPrinter, type PrinterOutcome } from "./printerQuery";
import type { QueryTarget } from "./printTarget";

export interface DocumentReply {
  raw: string;
  commands: readonly string[];
  /** ^HH answers with the configuration dump, which the dialog titles as such. */
  configuration: boolean;
  parsed: HostReplyParts;
}

/** The document already carries the commands the printer answers, so nothing is appended. */
export async function queryDocument(target: QueryTarget, zpl: string, commands: readonly string[]): Promise<PrinterOutcome<DocumentReply>> {
  const res = await queryPrinter(target, zpl);
  if (res.kind !== "ok") return res;
  const text = answered(res);
  if (text.kind !== "ok") return text;
  return { kind: "ok", value: { raw: text.value, commands, configuration: commands.some((command) => hostCommandParts(command).id === "^HH"), parsed: parseHostReplies(text.value, commands) } };
}
