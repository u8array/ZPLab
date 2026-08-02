import { describe, expect, it } from "vitest";
import { planCode128Fd, planHasLoss } from "./code128Plan";

describe("planCode128Fd", () => {
  it("whole: encodes control bytes as invocations, losslessly", () => {
    expect(planCode128Fd("A\tB", "whole")).toEqual({ fd: ">9337334", losses: [] });
    expect(planCode128Fd("A«ctrl:TAB»B", "whole").fd).toBe(">9337334");
  });

  it("whole: flags the ^FH drop when a byte fits no subset", () => {
    const plan = planCode128Fd("Ä\tB", "whole");
    expect(planHasLoss(plan, "controlBytesDropped")).toBe(true);
    expect(plan.fd).toBe("Ä\tB");
  });

  it("whole: escapes >^~ and flags > before an invocation char", () => {
    expect(planCode128Fd("A>B^C~D", "whole").fd).toBe("A>0B><C>=D");
    const plan = planCode128Fd("A>5B", "whole");
    expect(plan.fd).toBe("A>5B");
    expect(plan.losses).toEqual([{ kind: "invocationRead", seqs: [">5"] }]);
  });

  it("template: escapes literal spans only and reports both loss kinds", () => {
    const plan = planCode128Fd("A>«x^y»B«ctrl:TAB»>5", "template");
    expect(plan.fd).toBe("A>0«x^y»B«ctrl:TAB»>5");
    expect(planHasLoss(plan, "controlBytesDropped")).toBe(true);
    expect(plan.losses).toContainEqual({ kind: "invocationRead", seqs: [">5"] });
  });

  it("templateValue: plain escape with chips PRESERVED as marker text in fd", () => {
    expect(planCode128Fd("X>Y", "templateValue").fd).toBe("X>0Y");
    // The header emit ships chip markers literally; only the losses look at
    // the resolved bytes. The parser's plain-domain gate relies on this.
    const plan = planCode128Fd("A«ctrl:TAB»B^C", "templateValue");
    expect(plan.fd).toBe("A«ctrl:TAB»B><C");
    expect(planHasLoss(plan, "controlBytesDropped")).toBe(true);
  });

  it("sharedRaw: chip-resolves only and reports the unescaped corruption", () => {
    const plan = planCode128Fd("X>Y«ctrl:TAB»", "sharedRaw");
    expect(plan.fd).toBe("X>Y\t");
    expect(planHasLoss(plan, "rawUnescaped")).toBe(true);
    expect(planHasLoss(plan, "controlBytesDropped")).toBe(true);
    expect(planHasLoss(plan, "invocationRead")).toBe(false);
    expect(planCode128Fd("LOT7", "sharedRaw")).toEqual({ fd: "LOT7", losses: [] });
  });

  it("annotates DEL as routing, never as an ^FH drop (DEL ships as a raw byte)", () => {
    expect(planCode128Fd("A\x7FB", "whole")).toEqual({ fd: ">:A>1B", losses: [] });
    expect(planHasLoss(planCode128Fd("\x7FX", "templateValue"), "controlBytesDropped")).toBe(false);
  });

  it("orders losses invocation-first (pinned detail order)", () => {
    const plan = planCode128Fd("Ä>5\tB", "whole");
    expect(plan.losses.map((l) => l.kind)).toEqual(["invocationRead", "controlBytesDropped"]);
  });

  it("is idempotent on its own output (adoption gate contract)", () => {
    for (const text of ["A>B", "A\tB", "A^B~C", "ABC", "A>5B", "Ä\tB"]) {
      const fd = planCode128Fd(text, "whole").fd;
      expect(planCode128Fd(fd, "whole").fd, JSON.stringify(text)).toBe(fd);
    }
  });
});
