import { describe, it, expect } from "vitest";
import { buildSourceDiagnostics } from "./sourceDiagnostics";
import { describeFinding } from "./importReport";
import { formatTemplate } from "./formatTemplate";
import { fallbackTranslations as en } from "../locales";
import type { ImportFinding } from "@zplab/core/lib/importReport";

describe("buildSourceDiagnostics", () => {
  it("names each imbalance kind with the bytes it found", () => {
    const of = (ub: { kind: "strayXz" | "unclosedXa"; at: number; cmd: string }) =>
      buildSourceDiagnostics({ reason: "unbalanced", unbalanced: ub }, [], en);
    // The generic banner told the user to ADD what the diagnostic points at.
    expect(of({ kind: "strayXz", at: 0, cmd: "#XZ" })).toEqual([{
      from: 0, to: 3, severity: "error",
      message: formatTemplate(en.output.lintStrayXzFmt, { cmd: "#XZ" }),
    }]);
    expect(of({ kind: "unclosedXa", at: 4, cmd: "#XA" })[0]?.message)
      .toBe(formatTemplate(en.output.lintUnclosedXaFmt, { cmd: "#XA" }));
  });

  it("adds the repair site as a weaker second mark", () => {
    const lints = buildSourceDiagnostics({
      reason: "unbalanced",
      unbalanced: { kind: "unclosedXa", at: 0, cmd: "^XA", related: { at: 40, cmd: "^XA" } },
    }, [], en);
    expect(lints.map((l) => [l.from, l.severity])).toEqual([[0, "error"], [40, "related"]]);
    expect(lints[1]?.message).toBe(formatTemplate(en.output.lintStillOpenHereFmt, { cmd: "^XA" }));
  });

  it("stays silent for a refusal without a located command", () => {
    expect(buildSourceDiagnostics({ reason: "tooLarge" }, [], en)).toEqual([]);
    expect(buildSourceDiagnostics(null, [], en)).toEqual([]);
  });

  it("maps a spanned finding to a warning with its report wording", () => {
    const f: ImportFinding = { kind: "deviceAction", command: "~PH", pageIndex: 0, span: { start: 12, end: 15 } };
    const { title, detail } = describeFinding(f, en.importReport);
    expect(buildSourceDiagnostics(null, [f], en)).toEqual([
      { from: 12, to: 15, severity: "warning", message: `${title}: ${detail}` },
    ]);
  });

  it("drops findings without a span instead of guessing a position", () => {
    const f: ImportFinding = { kind: "lossyEdit", command: "some reason", pageIndex: 0 };
    expect(buildSourceDiagnostics(null, [f], en)).toEqual([]);
  });

  it("returns every lint in document order", () => {
    const late: ImportFinding = { kind: "unknown", command: "^QQ1", pageIndex: 0, span: { start: 30, end: 34 } };
    const early: ImportFinding = { kind: "deviceAction", command: "~PH", pageIndex: 0, span: { start: 3, end: 6 } };
    const lints = buildSourceDiagnostics(
      { reason: "unbalanced", unbalanced: { kind: "strayXz", at: 0, cmd: "^XZ" } }, [late, early], en);
    expect(lints.map((l) => l.from)).toEqual([0, 3, 30]);
    expect(lints[0]?.severity).toBe("error");
  });

  it("caps by position, so a late kind is not starved by an early flood", () => {
    const flood: ImportFinding[] = Array.from({ length: 600 }, (_, i) =>
      ({ kind: "unknown", command: `^Q${i}`, pageIndex: 0, span: { start: 100 + i, end: 101 + i } }));
    const early: ImportFinding = { kind: "deviceAction", command: "~PH", pageIndex: 0, span: { start: 3, end: 6 } };
    const lints = buildSourceDiagnostics(null, [...flood, early], en);
    expect(lints[0]?.from).toBe(3);
  });

  it("the cap budgets findings only: the imbalance error always survives", () => {
    const flood: ImportFinding[] = Array.from({ length: 600 }, (_, i) =>
      ({ kind: "unknown", command: `^Q${i}`, pageIndex: 0, span: { start: i, end: i + 1 } }));
    const lints = buildSourceDiagnostics(
      { reason: "unbalanced", unbalanced: { kind: "strayXz", at: 900, cmd: "^XZ" } }, flood, en);
    expect(lints.some((l) => l.severity === "error")).toBe(true);
  });

  it("caps a degenerate flood of warnings", () => {
    const flood: ImportFinding[] = Array.from({ length: 600 }, (_, i) =>
      ({ kind: "unknown", command: `^Q${i}`, pageIndex: 0, span: { start: i, end: i + 1 } }));
    expect(buildSourceDiagnostics(null, flood, en).length).toBeLessThanOrEqual(500);
  });
});
