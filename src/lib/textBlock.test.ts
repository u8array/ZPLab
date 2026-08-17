import { describe, it, expect } from "vitest";
import { deriveBlockTextPatch, FB_DEFAULTS } from "@zplab/core/lib/textBlock";
import { getEntry } from "@zplab/core/registry";
import type { TextProps } from "@zplab/core/registry/text";

const H = 30;
const W = 0;

describe("deriveBlockTextPatch", () => {
  it("returns content-only patch for single-line text without ^FB", () => {
    expect(deriveBlockTextPatch("Hello", {}, H, W)).toEqual({ content: "Hello" });
  });

  it("activates ^FB with the wrapped line count on first newline", () => {
    expect(deriveBlockTextPatch("A\nB", {}, H, W)).toEqual({
      content: "A\nB",
      blockWidth: FB_DEFAULTS.blockWidth,
      blockLines: 2,
      blockLineSpacing: FB_DEFAULTS.blockLineSpacing,
      blockJustify: FB_DEFAULTS.blockJustify,
    });
  });

  it("activates with device-font cell widths, not the Font-0 table", () => {
    // Font A h=20 (mag 2, 12-dot advance): 30 M's are 359 dots and fit the
    // 400-dot default width; the Font-0 table (~453) would wrap and cap
    // the new block one line short.
    const long = "M".repeat(30);
    const patch = deriveBlockTextPatch(`${long}\nM`, {}, 20, 0, "A");
    expect(patch.blockLines).toBe(2);
  });

  it("resolves the ^CF-default device font for the first-newline cap", () => {
    // Same discriminating case, but the device font comes from the label
    // default instead of the field's fontId.
    const long = "M".repeat(30);
    // Reachable via imported designs: explicit textMode 'fb' without a
    // blockWidth is the one shape that routes normalizeChanges into the
    // activation branch.
    const obj = { id: "t", type: "text", x: 0, y: 0, rotation: 0,
      props: { content: "M", fontHeight: 20, fontWidth: 0, rotation: "N", textMode: "fb" } };
    const changes = getEntry("text")!.normalizeChanges!(
      obj as never,
      { props: { content: `${long}\nM` } },
      { label: { defaultFontId: "A" } },
    );
    const props = changes.props as Partial<TextProps>;
    expect(props.blockLines).toBe(2);
    // The backfill must be complete, or the block emits ^FB0 (no width).
    expect(props.blockWidth).toBe(FB_DEFAULTS.blockWidth);
    expect(props.blockLineSpacing).toBe(FB_DEFAULTS.blockLineSpacing);
    expect(props.blockJustify).toBe(FB_DEFAULTS.blockJustify);
  });

  it("grows the line cap when explicit hard breaks exceed it", () => {
    expect(
      deriveBlockTextPatch("A\nB\nC", { blockWidth: 400, blockLines: 2 }, H, W),
    ).toEqual({ content: "A\nB\nC", blockLines: 3 });
  });

  it("does NOT shrink the cap when content shrinks (box height is user-owned)", () => {
    expect(
      deriveBlockTextPatch("A", { blockWidth: 400, blockLines: 3 }, H, W),
    ).toEqual({ content: "A" });
  });

  it("does not touch the cap when hard breaks fit within it", () => {
    expect(
      deriveBlockTextPatch("A\nB", { blockWidth: 400, blockLines: 2 }, H, W),
    ).toEqual({ content: "A\nB" });
  });

  it("does not auto-activate ^FB for single-line content", () => {
    expect(deriveBlockTextPatch("Hello", {}, H, W)).toEqual({ content: "Hello" });
  });
});
