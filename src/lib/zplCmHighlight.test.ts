import { describe, it, expect } from "vitest";
import { zplLineHighlights, opaquePayloadFold } from "./zplCmHighlight";
import { MAX_LINE_RENDER } from "./zplTokenStyles";

describe("zplLineHighlights", () => {
  it("covers the line contiguously with token classes", () => {
    const line = "^FO10,10^A0N,30,30^FDHello^FS";
    const ranges = zplLineHighlights(line, 100);
    expect(ranges[0]?.from).toBe(100);
    expect(ranges[ranges.length - 1]?.to).toBe(100 + line.length);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]?.from).toBe(ranges[i - 1]?.to);
    }
    expect(ranges.some((r) => r.cls.includes("text-string"))).toBe(true);
  });

  it("colours only the head of an overlong line", () => {
    const blob = `^GFA,8,8,1,${"F".repeat(MAX_LINE_RENDER + 100)}`;
    const ranges = zplLineHighlights(blob, 0);
    expect(ranges.length).toBeGreaterThan(0);
    expect(Math.max(...ranges.map((r) => r.to))).toBeLessThanOrEqual(MAX_LINE_RENDER);
  });
});

describe("opaquePayloadFold", () => {
  it("folds the payload tail of an overlong graphic line, keeping ^FS visible", () => {
    const payload = "F".repeat(MAX_LINE_RENDER + 100);
    const line = `^FO10,10^GFA,8,8,1,${payload}^FS`;
    const fold = opaquePayloadFold(line, 50);
    expect(fold).not.toBeNull();
    expect(fold && fold.from).toBeGreaterThan(50 + line.indexOf("^GF"));
    expect(fold?.to).toBe(50 + line.length - 3);
  });

  it("leaves short opaque lines and long non-opaque lines alone", () => {
    expect(opaquePayloadFold("^GFA,8,8,1,FFFF^FS", 0)).toBeNull();
    expect(opaquePayloadFold(`^FD${"a".repeat(MAX_LINE_RENDER + 10)}^FS`, 0)).toBeNull();
  });

  it("never folds real fields after a small payload on a long single-line label", () => {
    const fields = Array.from({ length: 90 }, (_, i) => `^FO10,${i}^A0N,20,20^FDt${i}^FS`).join("");
    const line = `^XA^PW560^GFA,4,4,1,FFFF^FS${fields}^XZ`;
    expect(line.length).toBeGreaterThan(MAX_LINE_RENDER);
    expect(opaquePayloadFold(line, 0)).toBeNull();
  });

  it("folds a prefix-remapped blob line (no literal caret or tilde)", () => {
    const line = `/GFA,8,8,1,${"F".repeat(MAX_LINE_RENDER + 100)}`;
    const fold = opaquePayloadFold(line, 10);
    expect(fold).toEqual({ from: 50, to: 10 + line.length });
    expect(opaquePayloadFold("/GFA,8,8,1,FFFF/FS", 0)).toBeNull();
  });

  it("folds the first OVERLONG payload, not the first payload", () => {
    const big = "F".repeat(MAX_LINE_RENDER + 100);
    const line = `^GFA,4,4,1,FFFF^FS^FO10,90^GFA,8,8,1,${big}^FS`;
    const fold = opaquePayloadFold(line, 0);
    expect(fold).not.toBeNull();
    expect(fold && fold.from > line.indexOf(big)).toBe(true);
    expect(fold?.to).toBe(line.length - 3);
  });

  it("ends a mid-line blob fold at the payload, not the line", () => {
    const blob = "F".repeat(MAX_LINE_RENDER + 100);
    const line = `^FO10,10^GFA,8,8,1,${blob}^FS^FO10,90^A0N,20,20^FDafter^FS`;
    const fold = opaquePayloadFold(line, 0);
    expect(fold).not.toBeNull();
    expect(line.slice(fold?.to ?? 0)).toMatch(/^\^FS\^FO10,90/);
  });
});
