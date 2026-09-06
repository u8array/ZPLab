import { describe, it, expect } from "vitest";
import { formatLabelMetaComment, parseLabelMetaComment } from "@zplab/core/lib/zplLabelMeta";

describe("zplLabelMeta", () => {
  it("round-trips dpmm/width/height through format → parse", () => {
    const meta = { dpmm: 12, widthMm: 57, heightMm: 32 };
    const line = formatLabelMetaComment(meta);
    expect(line).toBe(`^FXZPLab:{"dpmm":12,"w":57,"h":32}^FS`);
    // parse consumes the comment BODY (text after ^FX), before the ^FS.
    expect(parseLabelMetaComment(line.slice(3, line.length - 3))).toEqual(meta);
  });

  it("emits a caret/tilde-free comment body (spec-safe inside ^FX)", () => {
    const line = formatLabelMetaComment({ dpmm: 8, widthMm: 100, heightMm: 60 });
    expect(line.slice(3, line.length - 3)).not.toMatch(/[\^~]/);
  });

  it("returns null for a non-sentinel comment", () => {
    expect(parseLabelMetaComment("a human note")).toBeNull();
    expect(parseLabelMetaComment("")).toBeNull();
  });

  it("returns null for malformed JSON after the prefix", () => {
    expect(parseLabelMetaComment(`ZPLab:{not json`)).toBeNull();
  });

  it("rejects an out-of-set dpmm", () => {
    expect(
      parseLabelMetaComment(`ZPLab:{"dpmm":10,"wMm":100,"hMm":60}`),
    ).toBeNull();
  });

  it("rejects out-of-range or non-numeric mm", () => {
    expect(
      parseLabelMetaComment(`ZPLab:{"dpmm":8,"wMm":0,"hMm":60}`),
    ).toBeNull();
    expect(
      parseLabelMetaComment(`ZPLab:{"dpmm":8,"wMm":100,"hMm":99999}`),
    ).toBeNull();
    expect(
      parseLabelMetaComment(`ZPLab:{"dpmm":8,"wMm":"x","hMm":60}`),
    ).toBeNull();
  });

  it("tolerates surrounding whitespace on the body", () => {
    expect(
      parseLabelMetaComment(`  ZPLab:{"dpmm":8,"wMm":100,"hMm":60}  `),
    ).toEqual({ dpmm: 8, widthMm: 100, heightMm: 60 });
  });
});
