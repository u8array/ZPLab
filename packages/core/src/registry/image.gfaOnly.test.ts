import { describe, it, expect } from "vitest";
import { ObjectRegistry } from "./index";
import type { LabelObject } from "../types/Group";

const gfaOnly = (): LabelObject =>
  ({
    id: "img", type: "image", x: 0, y: 0, rotation: 0,
    props: { imageId: "", widthDots: 16, heightDots: 2, threshold: 128, rotation: "N", _gfaCache: "^GFA,4,4,2,FF00FF00" },
  }) as LabelObject;

describe("resizing a graphic that only exists as bytes", () => {
  const entry = ObjectRegistry.image!;

  it("keeps the box, because the bytes cannot be re-encoded", () => {
    const changes = entry.commitTransform?.(gfaOnly() as never, { sx: 2, sy: 2, snap: (d: number) => d } as never);
    expect(changes).toEqual({});
  });

  it("still emits the graphic afterwards", () => {
    expect(entry.toZPL?.(gfaOnly() as never, {} as never)).toContain("^GFA,4,4,2,FF00FF00");
  });

  it("keeps the bytes at a rotated orientation too", () => {
    // Rotation R renders as a placeholder (emit is upright-only), but the
    // cache is still the only copy: a resize commit must not clear it, or
    // rotating back to N could never restore the graphic.
    const rotated = gfaOnly();
    (rotated as { props: { rotation: string } }).props.rotation = "R";
    const changes = entry.commitTransform?.(rotated as never, { sx: 2, sy: 2, snap: (d: number) => d } as never);
    expect(changes).toEqual({});
  });
});
