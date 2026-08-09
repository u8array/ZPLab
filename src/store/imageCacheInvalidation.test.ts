import { describe, it, expect, afterEach } from "vitest";
import { applyObjectChanges } from "./labelStore.internals";
import { ObjectRegistry } from "@zplab/core/registry";
import { putImage, removeImage } from "@zplab/core/lib/imageCache";
import type { LabelObject } from "@zplab/core/types/Group";

// The wiring seam between normalizeChanges and the emit fallback: a width
// change without fresh bytes must reach toZPL as an invalidated cache, but
// only where the source image can re-encode them.
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

  afterEach(() => removeImage("src"));

  it("a width-only change ends in an empty ^FD emit, not stale bytes", () => {
    putImage({ id: "src", name: "s.png", dataUrl: "data:image/png;base64,AA", width: 8, height: 8 });
    const withSource = { ...img, props: { ...(img as { props: object }).props, imageId: "src" } } as LabelObject;
    const changed = applyObjectChanges(withSource, { props: { widthDots: 80 } });
    expect((changed as { props: { _gfaCache?: string } }).props._gfaCache).toBeUndefined();
  });

  it("keeps the bytes when they are the graphic's only copy", () => {
    expect(ObjectRegistry.image.toZPL(img as never)).toContain(gfa);
    const changed = applyObjectChanges(img, { props: { widthDots: 80 } });
    // The header is the printed size (imageEmitDims), so widthDots never made
    // these bytes stale; clearing them would leave nothing to print.
    expect(ObjectRegistry.image.toZPL(changed as never)).toContain(gfa);
  });
});
