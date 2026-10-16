// One wording per printer condition and reading, shared by chip, check and dialog.
import { hostObjectPath } from "@zplab/core/lib/hostDirectory";
import { printerReadiness, type HostMemory, type HostWarningFlag, type PrinterCondition, type PrinterIdentity, type PrinterReadiness } from "@zplab/core/lib/hostStatus";
import { driveUsage, hostListing, type DriveUsage } from "@zplab/core/lib/storedObjectOrigins";
import type { DocumentReply } from "./printerDocumentQuery";
import type { PrinterQueryFailure } from "./printerQuery";
import type { PrinterStatusReport } from "./printerStatus";
import type { Translations } from "../locales";
import { formatTemplate } from "./formatTemplate";

type Loc = Translations["printerSettings"]["printerStatus"];

const CONDITION_KEY = {
  mediaOut: "flagMediaOut",
  ribbonOut: "flagRibbonOut",
  headOpen: "flagHeadOpen",
  cutterFault: "flagCutterFault",
  printheadOverTemperature: "flagPrintheadOverTemperature",
  motorOverTemperature: "flagMotorOverTemperature",
  badPrintheadElement: "flagBadPrintheadElement",
  printheadDetectionError: "flagPrintheadDetectionError",
  invalidFirmwareConfig: "flagInvalidFirmwareConfig",
  printheadThermistorOpen: "flagPrintheadThermistorOpen",
  paused: "paused",
  corruptRam: "corruptRam",
  otherError: "flagOtherError",
  needToCalibrateMedia: "flagNeedToCalibrateMedia",
  cleanPrinthead: "flagCleanPrinthead",
  replacePrinthead: "flagReplacePrinthead",
  otherWarning: "flagOtherWarning",
} as const satisfies Record<PrinterCondition | HostWarningFlag, keyof Loc>;

const conditionText = (loc: Loc, condition: PrinterCondition | HostWarningFlag): string => loc[CONDITION_KEY[condition]];

export type ReadinessTone = "ready" | "warning" | "blocked" | "unknown";

export function readinessText(loc: Loc, readiness: PrinterReadiness): { text: string; tone: ReadinessTone } {
  if (!readiness.known) return { text: loc.statusUnreadHint, tone: "unknown" };
  if (readiness.conditions.length > 0) return { text: readiness.conditions.map((c) => conditionText(loc, c)).join(", "), tone: "blocked" };
  return { text: loc.ready, tone: readiness.warnings.length > 0 ? "warning" : "ready" };
}

export const warningsText = (loc: Loc, readiness: PrinterReadiness): string =>
  readiness.warnings.map((w) => conditionText(loc, w)).join(", ") || loc.none;

export const readingText = (loc: Loc, step: string): string => formatTemplate(loc.readingFmt, { step });

export function failureText(loc: Loc, failure: PrinterQueryFailure): string {
  switch (failure.kind) {
    case "unconfigured":
      return loc.failUnconfigured;
    case "busy":
      return loc.failBusy;
    case "unparsed":
      return loc.failUnparsed;
    case "silent":
      return loc.failSilent;
    case "ignored":
      return loc.failIgnored;
    case "refused":
      return formatTemplate(loc.failRefusedFmt, { port: String(failure.port) });
    case "unreachable":
      return loc.failUnreachable;
    case "not_found":
      return loc.failNotFound;
    case "permission_denied":
      return loc.failPermissionDenied;
    case "error":
      return failure.message;
  }
}

export interface ReportView {
  report: PrinterStatusReport;
  readiness: PrinterReadiness;
  line: { text: string; tone: ReadinessTone };
}

export const reportView = (loc: Loc, report: PrinterStatusReport | undefined): ReportView | undefined => {
  if (!report) return undefined;
  const readiness = printerReadiness(report.flags, report.status);
  return { report, readiness, line: readinessText(loc, readiness) };
};

export const modelText = (identity: PrinterIdentity): string => `${identity.model} ${identity.firmware}`;
export const memoryText = (loc: Loc, memory: HostMemory): string =>
  formatTemplate(loc.memoryFmt, { available: String(memory.availableKb), max: String(memory.maxKb) });

/** A listed object under a kilobyte is still there, so only a true zero reads as nothing. */
export const kilobytes = (bytes: number): string => String(bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024)));

export const driveUsageText = (loc: Translations["printerSettings"]["objects"], usage: Pick<DriveUsage, "device" | "used" | "free">): string =>
  formatTemplate(loc.usageFmt, { device: usage.device, used: kilobytes(usage.used), free: kilobytes(usage.free) });

/** A document's reply as lines, in the wording each reading already has elsewhere. */
export function documentReplyLines(loc: Loc, storage: Translations["printerSettings"]["objects"], reply: DocumentReply): string[] {
  const { status, identity, memory, flags, directories } = reply.parsed;
  const lines: string[] = [];
  if (flags !== undefined || status !== undefined) {
    const readiness = printerReadiness(flags, status);
    lines.push(readinessText(loc, readiness).text);
    if (flags !== undefined) lines.push(`${loc.warnings}: ${warningsText(loc, readiness)}`);
  }
  if (identity !== undefined) lines.push(`${loc.model}: ${modelText(identity)}`);
  if (memory !== undefined) lines.push(`${loc.memory}: ${memoryText(loc, memory)}`);
  if (directories !== undefined) {
    const listing = hostListing(directories);
    lines.push(...listing.objects.map(hostObjectPath));
    lines.push(
      ...driveUsage(listing).map((d) => driveUsageText(storage, d)),
    );
  }
  return lines;
}
