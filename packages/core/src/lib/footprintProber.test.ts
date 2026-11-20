import { describe, it, expect, afterEach } from "vitest";
import { measureFootprintDots, registerFootprintMeasurer, withFootprintMeasurer } from "./footprintProber";
import type { LabelObject } from "../types/Group";

const obj = { id: "o", type: "code128", x: 0, y: 0, props: {} } as unknown as LabelObject;

afterEach(() => registerFootprintMeasurer(null));

describe("withFootprintMeasurer", () => {
  it("measures under the scoped measurer and restores the previous one, also when fn throws", () => {
    registerFootprintMeasurer(() => ({ w: 1, h: 1 }));
    expect(measureFootprintDots(obj)).toEqual({ w: 1, h: 1 });
    expect(() =>
      withFootprintMeasurer(() => ({ w: 2, h: 2 }), () => {
        expect(measureFootprintDots(obj)).toEqual({ w: 2, h: 2 });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(measureFootprintDots(obj)).toEqual({ w: 1, h: 1 });
  });

  it("leaves the seam empty when nothing was registered before", () => {
    expect(withFootprintMeasurer(() => ({ w: 2, h: 2 }), () => measureFootprintDots(obj))).toEqual({ w: 2, h: 2 });
    expect(measureFootprintDots(obj)).toBeNull();
  });
});
