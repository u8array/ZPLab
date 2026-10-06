// One wording per printer condition, shared by chip, check and dialog.
import { printerReadiness, type HostWarningFlag, type PrinterCondition, type PrinterReadiness } from "@zplab/core/lib/hostStatus";
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
