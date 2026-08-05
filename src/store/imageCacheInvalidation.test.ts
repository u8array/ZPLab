import { describe, it, expect } from "vitest";
import { applyObjectChanges } from "./labelStore.internals";
import { ObjectRegistry } from "@zplab/core/registry";
import type { LabelObject } from "@zplab/core/types/Group";

// The wiring seam between normalizeChanges and the emit fallback: a width
// change without fresh bytes must reach toZPL as an invalidated cache.
describe("image cache invalidation through applyObjectChanges", () => {
  const gfa = "^GFA,8,8,1,00FF00FF00FF00FF";
  const img = {
    id: "i",
    type: "image",
    x: 0,
    y: 0,
    rotation: 0,
    props: { imageId: "gone", widthDots: 8, threshold: 128, rotation: "N", _gfaCache: gfa },
  } as LabelObject;

  it("a width-only change ends in an empty ^FD emit, not stale bytes", () => {
    expect(ObjectRegistry.image.toZPL(img as never)).toContain(gfa);
    const changed = applyObjectChanges(img, { props: { widthDots: 80 } });
    const zpl = ObjectRegistry.image.toZPL(changed as never);
    expect(zpl).not.toContain(gfa);
    expect(zpl).toContain("^FD^FS");
  });
});
