import { describe, expect, it } from "vitest";
import { guardedRegion } from "./canvasImage";

describe("guardedRegion", () => {
  it("keeps the last column when the scaled size lands a hair under a whole pixel", () => {
    const rect = { x: 0, y: 0, width: 0.29, height: 0.29 };
    expect(Math.floor(rect.width * 100)).toBe(28);
    const region = guardedRegion(rect, 100);
    expect(Math.floor(region.width * region.pixelRatio)).toBe(29);
    expect(region).toMatchObject({ x: 0, y: 0, pixelRatio: 100 });
  });
});
