const STX = "\u0002";
const ETX = "\u0003";

/** ~HS and ~HQES frame their replies in STX and ETX (spec p.226, p.233). */
export function unframed(body: string): string {
  return body.replaceAll(STX, "").replaceAll(ETX, "");
}

function replyLines(body: string): string[] {
  return unframed(body)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const int = (field: string | undefined): number | undefined => {
  const n = Number.parseInt(field ?? "", 10);
  return Number.isNaN(n) ? undefined : n;
};
const flag = (field: string | undefined): boolean => field?.trim() === "1";

export interface PrinterIdentity {
  model: string;
  firmware: string;
  dpmm: number | undefined;
  memoryKb: number | undefined;
  options: string;
}

/** ~HI answers one line `model,firmware,dpmm,memoryKB,options` (spec p.224). */
export function parseHostIdentification(body: string): PrinterIdentity | undefined {
  const [first] = replyLines(body);
  const [model, firmware, dpmm, memory, ...options] = first?.split(",") ?? [];
  if (!model || !firmware) return undefined;
  return { model, firmware, dpmm: int(dpmm), memoryKb: int(memory?.replace(/KB$/i, "")), options: options.join(",") };
}

export interface HostStatus {
  paperOut: boolean;
  paused: boolean;
  labelLengthDots: number | undefined;
  formatsInBuffer: number | undefined;
  bufferFull: boolean;
  diagnosticMode: boolean;
  partialFormat: boolean;
  corruptRam: boolean;
  underTemperature: boolean;
  overTemperature: boolean;
  headUp: boolean;
  ribbonOut: boolean;
  thermalTransfer: boolean;
  printMode: number | undefined;
  labelWaiting: boolean;
  labelsRemaining: number | undefined;
  graphicsStored: number | undefined;
}

/** Of the three strings ~HS answers, the state sits in the first two (spec p.233). */
export function parseHostStatus(body: string): HostStatus | undefined {
  // Some firmware prepends a banner line, so the state strings are picked by field count.
  const fields = replyLines(body).map((line) => line.split(","));
  const first = fields.findIndex((f) => f.length >= 12);
  const a = fields[first] ?? [];
  const b = fields.slice(first + 1).find((f) => f.length >= 11) ?? [];
  if (a.length < 12 || b.length < 11) return undefined;
  return {
    paperOut: flag(a[1]),
    paused: flag(a[2]),
    labelLengthDots: int(a[3]),
    formatsInBuffer: int(a[4]),
    bufferFull: flag(a[5]),
    diagnosticMode: flag(a[6]),
    partialFormat: flag(a[7]),
    corruptRam: flag(a[9]),
    underTemperature: flag(a[10]),
    overTemperature: flag(a[11]),
    headUp: flag(b[2]),
    ribbonOut: flag(b[3]),
    thermalTransfer: flag(b[4]),
    printMode: int(b[5]),
    labelWaiting: flag(b[7]),
    labelsRemaining: int(b[8]),
    graphicsStored: int(b[10]),
  };
}

export interface HostMemory {
  totalKb: number;
  maxKb: number;
  availableKb: number;
}

/** ~HM answers one line `total,maximum,available` in kilobytes (spec p.225). */
export function parseHostMemory(body: string): HostMemory | undefined {
  const [first] = replyLines(body);
  const [total, max, available] = (first?.split(",") ?? []).map(int);
  if (total === undefined || max === undefined || available === undefined) return undefined;
  return { totalKb: total, maxKb: max, availableKb: available };
}

export type HostErrorFlag =
  | "mediaOut"
  | "ribbonOut"
  | "headOpen"
  | "cutterFault"
  | "printheadOverTemperature"
  | "motorOverTemperature"
  | "badPrintheadElement"
  | "printheadDetectionError"
  | "invalidFirmwareConfig"
  | "printheadThermistorOpen"
  | "paused"
  | "otherError";

export type HostWarningFlag = "needToCalibrateMedia" | "cleanPrinthead" | "replacePrinthead" | "otherWarning";

/** Nibble 1 is the right-most digit of group 1, nibble 9 the right-most of group 2 (spec p.226). */
const ERROR_NIBBLES: Record<number, Record<number, HostErrorFlag>> = {
  1: { 1: "mediaOut", 2: "ribbonOut", 4: "headOpen", 8: "cutterFault" },
  2: { 1: "printheadOverTemperature", 2: "motorOverTemperature", 4: "badPrintheadElement", 8: "printheadDetectionError" },
  3: { 1: "invalidFirmwareConfig", 2: "printheadThermistorOpen" },
  5: { 1: "paused" },
};
const WARNING_NIBBLES: Record<number, Record<number, HostWarningFlag>> = {
  1: { 1: "needToCalibrateMedia", 2: "cleanPrinthead", 4: "replacePrinthead" },
};

/** Bits the spec tables do not name collapse into one flag. */
function decodeFlags<T extends string>(group1: string, group2: string, table: Record<number, Record<number, T>>, other: T): T[] {
  const digits = group2 + group1;
  const out: T[] = [];
  for (let nibble = 1; nibble <= 16; nibble += 1) {
    const value = Number.parseInt(digits[digits.length - nibble] ?? "0", 16);
    for (const bit of [1, 2, 4, 8]) {
      if ((value & bit) === 0) continue;
      const flagName = table[nibble]?.[bit] ?? other;
      if (!out.includes(flagName)) out.push(flagName);
    }
  }
  return out;
}

export interface HostQueryStatus {
  errors: HostErrorFlag[];
  warnings: HostWarningFlag[];
}

const FLAG_LINE = (label: string) => new RegExp(`${label}:\\s*([01])\\s+([0-9A-F]{8})\\s+([0-9A-F]{8})`, "i");

/** ~HQES answers an ERRORS line and a WARNINGS line, each a flag digit and two hex groups (spec p.226). */
export function parseHostQueryStatus(body: string): HostQueryStatus | undefined {
  const text = unframed(body);
  const errors = FLAG_LINE("ERRORS").exec(text);
  const warnings = FLAG_LINE("WARNINGS").exec(text);
  if (!errors || !warnings) return undefined;
  return {
    errors: decodeFlags(errors[3] ?? "", errors[2] ?? "", ERROR_NIBBLES, "otherError"),
    warnings: decodeFlags(warnings[3] ?? "", warnings[2] ?? "", WARNING_NIBBLES, "otherWarning"),
  };
}

export type PrinterCondition = HostErrorFlag | "corruptRam";

export interface PrinterReadiness {
  conditions: PrinterCondition[];
  warnings: HostWarningFlag[];
  /** False when neither reply arrived, so nothing can be said either way. */
  known: boolean;
}

/** The two replies overlap, so the blocking states are folded into one list for every reader. */
export function printerReadiness(flags: HostQueryStatus | undefined, status: HostStatus | undefined): PrinterReadiness {
  const conditions: PrinterCondition[] = [...(flags?.errors ?? [])];
  const fromStatus: [boolean, PrinterCondition][] = status
    ? [
        [status.paperOut, "mediaOut"],
        [status.ribbonOut, "ribbonOut"],
        [status.headUp, "headOpen"],
        [status.paused, "paused"],
        [status.overTemperature, "printheadOverTemperature"],
        [status.corruptRam, "corruptRam"],
      ]
    : [];
  for (const [set, condition] of fromStatus) {
    if (set && !conditions.includes(condition)) conditions.push(condition);
  }
  return { conditions, warnings: flags?.warnings ?? [], known: flags !== undefined || status !== undefined };
}

const HOST_STATUS_SILENCERS: readonly HostErrorFlag[] = ["mediaOut", "ribbonOut", "headOpen", "printheadOverTemperature"];

/** The printer withholds ~HS in these states (spec p.233), so asking would only run into the read timeout. */
export function hostStatusAnswers(flags: HostQueryStatus): boolean {
  return !flags.errors.some((f) => HOST_STATUS_SILENCERS.includes(f));
}
