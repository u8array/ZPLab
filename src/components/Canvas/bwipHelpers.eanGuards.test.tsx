// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { renderEanUpcRawCanvas } from "./bwipHelpers";

const rectHeights: number[] = [];

beforeAll(() => {
  const noop = () => undefined;
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({
      fillRect: (_x: number, _y: number, _w: number, h: number) => {
        rectHeights.push(h);
      },
    }, {
      get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop),
      set: () => true,
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

// Regression: guard tails were gated on printInterpretation.
describe("EAN raw canvas guard tails", () => {
  it("draws guard bars through the text zone unconditionally", () => {
    rectHeights.length = 0;
    const canvas = renderEanUpcRawCanvas({
      type: "ean13",
      text: "123456891234",
      modulePxInt: 2,
      barHeightPx: 100,
      tailHeightPx: 13,
    });
    expect(canvas).not.toBeNull();
    expect(Math.max(...rectHeights)).toBe(113);
    expect(Math.min(...rectHeights)).toBe(100);
  });
});
