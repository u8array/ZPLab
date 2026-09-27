import { describe, expect, it } from "vitest";
import { contestedFormatKeys, formatDelivery, recallOnlyPath, recallWayIssue } from "./storedFormat";

describe("storedFormat", () => {
  it("recalls only a chosen way on a name ^XF can read", () => {
    expect(recallOnlyPath({ storedFormatPath: "E:JOB.ZPL", storedFormatDelivery: "setup" })).toBe("E:JOB.ZPL");
    expect(recallOnlyPath({ storedFormatPath: "E:VERYLONGNAME12.ZPL", storedFormatDelivery: "setup" })).toBeUndefined();
    expect(recallOnlyPath({ storedFormatPath: "E:JOB.ZPL" })).toBeUndefined();
  });

  it("takes the chosen way, or stores when the name is one no recall reads, even on a contested name", () => {
    expect(formatDelivery({ storedFormatPath: "E:JOB.ZPL", storedFormatDelivery: "printer" })).toBe("printer");
    expect(formatDelivery({ storedFormatPath: "E:VERYLONGNAME12.ZPL", storedFormatDelivery: "setup" })).toBe("job");
    expect(formatDelivery({ storedFormatPath: "E:JOB.ZPL" })).toBe("job");
    expect(formatDelivery({})).toBe("job");
    const contested = { storedFormatPath: "E:JOB.ZPL", storedFormatDelivery: "setup" as const };
    expect(recallWayIssue(contested, [contested, { storedFormatPath: "e:job.zpl" }])).toBe("contested");
    expect(formatDelivery(contested)).toBe("setup");
  });

  it("names the printer files more than one page stores under, however each page spells them", () => {
    const pages = [{ storedFormatPath: "E:JOB.ZPL" }, {}, { storedFormatPath: "e:job.zpl" }, { storedFormatPath: "E:VERYLONGNAME12.ZPL" }, { storedFormatPath: "E:FREE.ZPL" }];
    expect([...contestedFormatKeys(pages)]).toEqual(["E:JOB.ZPL"]);
    expect(pages.map((p) => recallWayIssue(p, pages))).toEqual(["contested", undefined, "contested", "longName", undefined]);
  });
});
