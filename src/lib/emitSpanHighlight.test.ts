import { describe, it, expect } from "vitest";
import { spanCoveredLines } from "./emitSpanHighlight";
import { generateMultiPageZplWithMap } from "@zplab/core/lib/zplGenerator";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";
import type { LabelObject, Page } from "@zplab/core/types/Group";

const label: LabelConfig = { widthMm: 70, heightMm: 40, dpmm: 8 };
const text = (id: string, content: string, y = 10): LabelObject =>
  ({
    id, type: "text", x: 10, y, rotation: 0,
    props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" },
  }) as never;

describe("spanCoveredLines", () => {
  it("marks exactly the lines the selected object's span touches", () => {
    const pages: Page[] = [{ objects: [text("a", "Alpha"), text("b", "Beta", 60)] }];
    const out = generateMultiPageZplWithMap(label, pages);
    const lines = out.text.split("\n");
    const covered = spanCoveredLines(out.text, out.spans, new Set(["b"]));
    expect(covered.size).toBeGreaterThan(0);
    for (const [i, line] of lines.entries()) {
      expect(covered.has(i)).toBe(line.includes("Beta"));
    }
  });

  it("covers every line of a multi-line span (^FX comment + field)", () => {
    const pages: Page[] = [
      { objects: [{ ...text("c", "Gamma"), comment: "why" } as never] },
    ];
    const out = generateMultiPageZplWithMap(label, pages);
    const lines = out.text.split("\n");
    const covered = spanCoveredLines(out.text, out.spans, new Set(["c"]));
    const fx = lines.findIndex((l) => l.startsWith("^FXwhy"));
    expect(fx).toBeGreaterThan(-1);
    expect(covered.has(fx)).toBe(true);
    expect(covered.has(fx + 1)).toBe(true);
  });

  it("is empty for no selection", () => {
    const pages: Page[] = [{ objects: [text("a", "Alpha")] }];
    const out = generateMultiPageZplWithMap(label, pages);
    expect(spanCoveredLines(out.text, out.spans, new Set()).size).toBe(0);
  });
});
