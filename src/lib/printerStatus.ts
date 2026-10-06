import {
  hostStatusAnswers,
  parseHostIdentification,
  parseHostMemory,
  parseHostQueryStatus,
  parseHostStatus,
  unframed,
  type HostMemory,
  type HostQueryStatus,
  type HostStatus,
  type PrinterIdentity,
} from "@zplab/core/lib/hostStatus";
import { queryPrinter, type PrinterOutcome } from "./printerQuery";
import type { QueryTarget } from "./printTarget";

export interface PrinterStatusReport {
  identity: PrinterIdentity | undefined;
  flags: HostQueryStatus | undefined;
  memory: HostMemory | undefined;
  /** Set only when ~HS was asked and its reply parsed. */
  status: HostStatus | undefined;
  /** True when the flags name a state that makes ~HS silent. */
  withheld: boolean;
  /** Each reply under its command, so the user can read what the parsers could not. */
  raw: string;
}

const parsed = <T>(outcome: PrinterOutcome<string> | undefined, parse: (text: string) => T | undefined): T | undefined =>
  outcome?.kind === "ok" ? parse(outcome.value) : undefined;

/** Asks ~HS only when the flags say the printer would answer. */
export async function readPrinterStatus(target: QueryTarget, onStep?: (command: string) => void): Promise<PrinterOutcome<PrinterStatusReport>> {
  const ask = (command: string) => {
    onStep?.(command);
    return queryPrinter(target, command);
  };
  const hi = await ask("~HI");
  if (hi.kind !== "ok") return hi;
  const es = await ask("~HQES");
  const hm = await ask("~HM");
  const flags = parsed(es, parseHostQueryStatus);
  const withheld = flags !== undefined && !hostStatusAnswers(flags);
  const hs = withheld ? undefined : await ask("~HS");
  const raw: string[] = [];
  for (const [command, outcome] of [["~HI", hi], ["~HQES", es], ["~HM", hm], ["~HS", hs]] as const) {
    if (outcome?.kind === "ok") raw.push(`${command}\n${unframed(outcome.value).trim()}`);
  }
  return {
    kind: "ok",
    value: {
      identity: parseHostIdentification(hi.value),
      flags,
      memory: parsed(hm, parseHostMemory),
      status: parsed(hs, parseHostStatus),
      withheld,
      raw: raw.join("\n\n"),
    },
  };
}

/** ^HH echoes the configuration label to the host as text (spec p.222). */
export async function readPrinterConfiguration(target: QueryTarget): Promise<PrinterOutcome<string>> {
  const res = await queryPrinter(target, "^XA^HH^XZ");
  return res.kind === "ok" ? { kind: "ok", value: unframed(res.value).trim() } : res;
}
