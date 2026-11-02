import { awaitedReplies, fieldReplies, hostCommandParts, type OwedReply } from "@zplab/core/lib/hostCommands";
import { parseHostReplies, type HostReplyParts } from "@zplab/core/lib/hostReplies";
import { answered, readPrinterReply, type PrinterOutcome } from "./printerQuery";
import type { QueryTarget } from "./printTarget";

export interface DocumentReply {
  raw: string;
  commands: readonly string[];
  /** ^HH answers with the configuration dump, which the dialog titles as such. */
  configuration: boolean;
  parsed: HostReplyParts;
  unanswered: readonly OwedReply[];
}

/** A print of many labels answers ^HV for minutes, so the document waits far longer than a lone command. */
const DOCUMENT_DEADLINE_MS = 300_000;

/** The document already carries the commands the printer answers, so nothing is appended. */
export async function queryDocument(target: QueryTarget, zpl: string, commands: readonly string[], signal?: AbortSignal): Promise<PrinterOutcome<DocumentReply>> {
  const res = await readPrinterReply(target, zpl, { signal, deadlineMs: DOCUMENT_DEADLINE_MS, awaited: awaitedReplies(fieldReplies(zpl)) });
  if (res.kind !== "ok") return res;
  const { unanswered } = res.value;
  const text = answered({ kind: "ok", value: res.value.body });
  // A stopped read that got nothing still names what it waited for.
  if (text.kind !== "ok" && unanswered.length === 0) return text;
  const raw = text.kind === "ok" ? text.value : "";
  return {
    kind: "ok",
    value: {
      raw,
      commands,
      configuration: commands.some((command) => hostCommandParts(command).id === "^HH"),
      parsed: parseHostReplies(raw, commands),
      unanswered,
    },
  };
}
