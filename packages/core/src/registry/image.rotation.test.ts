import { describe, it, expect } from "vitest";
import { headerByteSource, imageEmitRotation, shippableGfa, type ImageProps } from "./image";

const GFA = "^GFA,4,4,2,FF00FF00";

// A field switched to ^XG keeps whatever rotation it had inline, but ^XG always
// recalls upright. Gating byte resolution on the raw prop dropped the ~DY while
// the ^XG that depends on it still shipped, and blanked the canvas preview.
describe("a recall field carrying a rotation from its inline past", () => {
  const recall = (rotation: string) =>
    ({
      imageId: "gone",
      widthDots: 8,
      threshold: 128,
      rotation,
      _gfaCache: GFA,
      storedAs: { device: "R", name: "IMG.GRF" },
    }) as unknown as ImageProps;

  it("resolves its bytes upright at any stored rotation", () => {
    for (const r of ["N", "R", "I", "B"]) {
      expect(imageEmitRotation(recall(r))).toBe("N");
      expect(headerByteSource(recall(r))).toBe(GFA);
      expect(shippableGfa(recall(r), imageEmitRotation(recall(r)))).toBe(GFA);
    }
  });
});

// The other reason rotation cannot be honoured: no source image to re-raster.
// That one must NOT collapse to upright, or the field prints an orientation the
// user did not ask for instead of saying it cannot.
describe("byte-only inline bytes carrying a rotation nothing can apply", () => {
  it("keeps the rotation so the refusal stays loud", () => {
    const p = {
      imageId: "gone", widthDots: 8, threshold: 128, rotation: "R", _gfaCache: GFA,
    } as unknown as ImageProps;
    expect(imageEmitRotation(p)).toBe("R");
    expect(headerByteSource(p)).toBeUndefined();
  });
});
