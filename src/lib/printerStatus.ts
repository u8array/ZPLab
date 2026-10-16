import { parseHostReplies, type HostReplyParts } from "@zplab/core/lib/hostReplies";
import { hostStatusAnswers, unframed } from "@zplab/core/lib/hostStatus";
import { answered, queryPrinter, type PrinterOutcome } from "./printerQuery";
import type { QueryTarget } from "./printTarget";

export interface PrinterStatusReport extends Pick<HostReplyParts, "identity" | "flags" | "memory" | "status"> {
  /** True when the flags name a state that makes ~HS silent. */
  withheld: boolean;
  /** Each reply under its command, so the user can read what the parsers could not. */
  raw: string;
}

const read = (outcome: PrinterOutcome<string> | undefined, id: string): HostReplyParts =>
  outcome?.kind === "ok" ? parseHostReplies(outcome.value, [id]) : {};

/** Asks ~HS only when the flags say the printer would answer. */
export async function readPrinterStatus(target: QueryTarget, onStep?: (command: string) => void): Promise<PrinterOutcome<PrinterStatusReport>> {
  const ask = async (command: string) => {
    onStep?.(command);
    return answered(await queryPrinter(target, command));
  };
  const hi = await ask("~HI");
  if (hi.kind !== "ok") return hi;
  const es = await ask("~HQES");
  const hm = await ask("~HM");
  const esParts = read(es, "~HQES");
  const withheld = esParts.flags !== undefined && !hostStatusAnswers(esParts.flags);
  const hs = withheld ? undefined : await ask("~HS");
  const raw: string[] = [];
  for (const [command, outcome] of [["~HI", hi], ["~HQES", es], ["~HM", hm], ["~HS", hs]] as const) {
    if (outcome?.kind === "ok") raw.push(`${command}\n${unframed(outcome.value).trim()}`);
  }
  return {
    kind: "ok",
    value: { ...read(hi, "~HI"), ...esParts, ...read(hm, "~HM"), ...read(hs, "~HS"), withheld, raw: raw.join("\n\n") },
  };
}

/** ^HH echoes the configuration label to the host as text (spec p.222). */
export async function readPrinterConfiguration(target: QueryTarget): Promise<PrinterOutcome<string>> {
  return answered(await queryPrinter(target, "^XA^HH^XZ"));
}
