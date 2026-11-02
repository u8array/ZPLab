import { describe, it, expect } from "vitest";
import { fallbackTranslations as en } from "../locales";
import { failureText, owedReplyLines, readinessText, reportView, warningsText } from "./printerStatusText";

const loc = en.printerSettings.printerStatus;

describe("readinessText", () => {
  it("names the blocking conditions, or ready, or that nothing is known", () => {
    expect(readinessText(loc, { conditions: ["headOpen", "corruptRam"], warnings: [], known: true })).toEqual({
      text: `${loc.flagHeadOpen}, ${loc.corruptRam}`,
      tone: "blocked",
    });
    expect(readinessText(loc, { conditions: [], warnings: ["cleanPrinthead"], known: true })).toEqual({ text: loc.ready, tone: "warning" });
    expect(readinessText(loc, { conditions: [], warnings: [], known: true })).toEqual({ text: loc.ready, tone: "ready" });
    expect(readinessText(loc, { conditions: [], warnings: [], known: false })).toEqual({ text: loc.statusUnreadHint, tone: "unknown" });
  });
});

describe("reportView", () => {
  it("folds a report into readiness and line, and nothing into nothing", () => {
    const report = { identity: undefined, flags: { errors: ["headOpen" as const], warnings: [] }, memory: undefined, status: undefined, withheld: true, raw: "" };
    expect(reportView(loc, report)).toMatchObject({ readiness: { conditions: ["headOpen"] }, line: { tone: "blocked" } });
    expect(reportView(loc, undefined)).toBeUndefined();
  });
});

describe("failureText", () => {
  it("names the failure in the locale and passes a transport message through", () => {
    expect(failureText(loc, { kind: "refused", port: 9100 })).toBe("The printer refused the connection. Check that port 9100 is open.");
    expect(failureText(loc, { kind: "unconfigured" })).toBe(loc.failUnconfigured);
    expect(failureText(loc, { kind: "busy" })).toBe(loc.failBusy);
    expect(failureText(loc, { kind: "unparsed" })).toBe(loc.failUnparsed);
    expect(failureText(loc, { kind: "ignored" })).toBe(loc.failIgnored);
    expect(failureText(loc, { kind: "timed_out" })).toBe(loc.failTimedOut);
    expect(failureText(loc, { kind: "incomplete" })).toBe(loc.failIncomplete);
    expect(failureText(loc, { kind: "lost" })).toBe(loc.failLost);
    expect(failureText(loc, { kind: "error", message: "no response from printer" })).toBe("no response from printer");
  });
});

describe("warningsText", () => {
  it("lists the warnings or says none", () => {
    expect(warningsText(loc, { conditions: [], warnings: ["cleanPrinthead"], known: true })).toBe(loc.flagCleanPrinthead);
    expect(warningsText(loc, { conditions: [], warnings: [], known: true })).toBe(loc.none);
  });
});

describe("owedReplyLines", () => {
  it("words a whole and a partial miss, names every command of a group, and shows a wording once", () => {
    const owed = [
      { commands: ["^HV1,20,H,E", "^HV2,20,H,E"], missing: 2, of: 2 },
      { commands: ["^HV3,20,K,U,L"], missing: 1, of: 3 },
      { commands: ["^HV3,20,K,U,L"], missing: 1, of: 3 },
    ];
    expect(owedReplyLines(en.zebraPrint, owed)).toEqual(["No reply to ^HV1,20,H,E ^HV2,20,H,E.", "Only 2 of 3 replies to ^HV3,20,K,U,L."]);
  });
});
