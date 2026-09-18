import { describe, it, expect } from "vitest";
import { imageUsage } from "./imageUsage";
import type { LabelObject } from "../types/Group";

const image = (id: string, imageId: string, extra: object = {}): LabelObject =>
  ({ id, type: "image", x: 0, y: 0, rotation: 0, props: { imageId, widthDots: 8, threshold: 128 }, ...extra }) as unknown as LabelObject;

describe("imageUsage", () => {
  it("counts image leaves per id across pages, including grouped, hidden and export-excluded ones, and skips an unset id", () => {
    const group = { id: "g", type: "group", x: 0, y: 0, rotation: 0, children: [image("c", "a")] } as unknown as LabelObject;
    const pages = [
      { objects: [image("i1", "a"), image("i2", "b", { visible: false }), group] },
      { objects: [image("i3", "a"), image("i4", ""), image("i5", "c", { includeInExport: false })] },
    ];
    expect([...imageUsage(pages).entries()]).toEqual([["a", 3], ["b", 1], ["c", 1]]);
  });
});
