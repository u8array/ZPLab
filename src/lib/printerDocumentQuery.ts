import { documentReplies, type OwedReply } from "@zplab/core/lib/documentReplies";
import { hostCommandParts } from "@zplab/core/lib/hostCommands";
import { parseHostReplies, type HostReplyParts } from "@zplab/core/lib/hostReplies";
import { answeredText, readPrinterReply, type PrinterOutcome } from "./printerQuery";
import type { QueryTarget } from "./printTarget";

export interface DocumentReply {
  raw: string;
  /** ^HH answers with the configuration dump, which the dialog titles as such. */
  configuration: boolean;
  parsed: HostReplyParts;
  unanswered: readonly OwedReply[];
}

/** A print of many labels answers ^HV for minutes, so the document waits far longer than a lone command. */
export const DOCUMENT_DEADLINE_MS = 300_000;

/** The document already carries the commands the printer answers, so nothing is appended. */
export async function queryDocument(target: QueryTarget, zpl: string, signal?: AbortSignal): Promise<PrinterOutcome<DocumentReply>> {
  const { commands, awaited } = documentReplies(zpl);
  const res = await readPrinterReply(target, zpl, { signal, deadlineMs: DOCUMENT_DEADLINE_MS, awaited });
  if (res.kind !== "ok") return res;
  const { body, unanswered } = res.value;
  const text = answeredText(body);
  const raw = text.kind === "ok" ? text.value : "";
  return {
    kind: "ok",
    value: {
      raw,
      configuration: commands.some((command) => hostCommandParts(command).id === "^HH"),
      parsed: parseHostReplies(raw, commands),
      unanswered,
    },
  };
}
