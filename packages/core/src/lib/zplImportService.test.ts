import { describe, it, expect } from "vitest";
import { importZplText } from "./zplImportService";
import { generateMultiPageZPL } from "./zplGenerator";

describe("geometry sidecar on later blocks", () => {
  it("is consumed on every block, so a multi-page export regenerates byte-stable", () => {
    const label = { widthMm: 70, heightMm: 40, dpmm: 8 };
    const leaf = (id: string) => ({ id, type: "text", x: 20, y: 35, rotation: 0, props: { content: id, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as never;
    const src = generateMultiPageZPL(label, [{ objects: [leaf("a")] }, { objects: [leaf("b")] }]);
    const imported = importZplText(src, label.dpmm);
    expect(imported.pages.map((p) => p.objects.map((o) => o.comment))).toEqual([[undefined], [undefined]]);
    expect(generateMultiPageZPL(label, imported.pages.map((p) => ({ ...p, overlay: undefined })), imported.variables)).toBe(src);
  });
});

