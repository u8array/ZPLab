import { describe, it, expect } from "vitest";
import { countBefore } from "./sortedCount";

describe("countBefore", () => {
  it("counts entries strictly before x, at both ends and on a hit", () => {
    const sorted = [3, 7, 7, 12];
    expect(countBefore(sorted, 0)).toBe(0);
    expect(countBefore(sorted, 3)).toBe(0);
    expect(countBefore(sorted, 4)).toBe(1);
    expect(countBefore(sorted, 7)).toBe(1);
    expect(countBefore(sorted, 8)).toBe(3);
    expect(countBefore(sorted, 99)).toBe(4);
    expect(countBefore([], 5)).toBe(0);
  });
});
