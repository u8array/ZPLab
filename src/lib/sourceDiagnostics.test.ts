import { describe, it, expect } from "vitest";
import { buildSourceDiagnostics } from "./sourceDiagnostics";
import { formatTemplate } from "./formatTemplate";
import { fallbackTranslations as en } from "../locales";

describe("buildSourceDiagnostics", () => {
  it("names each imbalance kind with the bytes it found", () => {
    const of = (ub: { kind: "strayXz" | "unclosedXa"; at: number; cmd: string }) =>
      buildSourceDiagnostics({ reason: "unbalanced", unbalanced: ub }, en);
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
    }, en);
    expect(lints.map((l) => [l.from, l.severity])).toEqual([[0, "error"], [40, "related"]]);
    expect(lints[1]?.message).toBe(formatTemplate(en.output.lintStillOpenHereFmt, { cmd: "^XA" }));
  });

  it("stays silent for a refusal without a located command", () => {
    expect(buildSourceDiagnostics({ reason: "tooLarge" }, en)).toEqual([]);
    expect(buildSourceDiagnostics(null, en)).toEqual([]);
  });
});
