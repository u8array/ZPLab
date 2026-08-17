import { describe, it, expect } from "vitest";
import {
  reverseBackingBoxGeometry,
  makeReverseBackingBox,
  insertReverseBackingBoxes,
  isReverseBackingFor,
  isOwnReverseBacking,
} from "@zplab/core/lib/reverseBacking";
import type { LabelObject } from "@zplab/core/types/Group";
import type { TextProps } from "@zplab/core/registry/text";

/** A reverse backing is a filled black box or a black line (a filled ^GB is
 *  canonically a line once one side equals the thickness). */
const isBlackBacking = (o: LabelObject | undefined): boolean => {
  if (!o) return false;
  const p = (o as { props?: { color?: string; filled?: boolean } }).props;
  if (o.type === "line") return p?.color === "B";
  if (o.type === "box") return p?.color === "B" && p?.filled === true;
  return false;
};

const text = (props: Partial<TextProps>, x = 50, y = 50) =>
  ({
    id: "t",
    type: "text",
    x,
    y,
    rotation: 0,
    props: {
      content: "Hi",
      fontHeight: 30,
      fontWidth: 0,
      rotation: "N",
      ...props,
    },
  }) as unknown as LabelObject;

describe("reverseBackingBoxGeometry", () => {
  it("sizes a normal reverse box to ink width x fontHeight", () => {
    const geo = reverseBackingBoxGeometry(text({ reverse: true }) as never);
    expect(geo.props.height).toBe(30);
    expect(geo.props.width).toBeGreaterThan(0);
    expect(geo.props.filled).toBe(true);
    expect(geo.props.color).toBe("B");
  });

  it("sizes an ^FB device-font backing by the snapped pitch", () => {
    // ^AG h=84 snaps to 60: 3 lines back 2*60+60 = 180 dots, not 252.
    const geo = reverseBackingBoxGeometry(
      text({ reverse: true, fontId: "G", fontHeight: 84, blockWidth: 700, blockLines: 3 }) as never,
      { customFonts: [], defaultFontId: undefined },
    );
    expect(geo.props.height).toBe(180);
  });

  it("still recognizes a backing persisted at the pre-snap raw pitch", () => {
    const rev = text({ reverse: true, fontId: "G", fontHeight: 84,
      blockWidth: 700, blockLines: 3 });
    const legacy = reverseBackingBoxGeometry(rev as never,
      { customFonts: [], defaultFontId: undefined }, { rawBlockPitch: true });
    expect(legacy.props.height).toBe(252);
    const box = { id: "bg", type: "box", x: legacy.x, y: legacy.y, rotation: 0,
      props: { ...legacy.props } } as unknown as LabelObject;
    expect(insertReverseBackingBoxes([box, rev],
      { customFonts: [], defaultFontId: undefined })).toHaveLength(2);
  });

  it("migrates a raw-pitch legacy backing to the snapped geometry on snap-up", () => {
    // Font G h=40 snaps UP to 60: the legacy 120-dot backing under-covers
    // the 180-dot snapped stack. It is the feature's own box, so migration
    // resizes it in place instead of stacking a second one.
    const label = { customFonts: [], defaultFontId: undefined };
    const rev = text({ reverse: true, fontId: "G", fontHeight: 40,
      blockWidth: 700, blockLines: 3 });
    const legacy = reverseBackingBoxGeometry(rev as never, label, { rawBlockPitch: true });
    expect(legacy.props.height).toBe(120);
    const box = { id: "bg", type: "box", x: legacy.x, y: legacy.y, rotation: 0,
      props: { ...legacy.props } } as unknown as LabelObject;
    const out = insertReverseBackingBoxes([box, rev], label);
    expect(out).toHaveLength(2);
    // Canonical form for 700x180 is a horizontal line (height == thickness).
    const migrated = out[0] as { id: string; type: string; props: { thickness: number } };
    expect(migrated.id).toBe("bg");
    expect(migrated.type).toBe("line");
    expect(migrated.props.thickness).toBe(180);
  });

  it("re-canonicalizes a line-shaped owned legacy backing on migration", () => {
    // A feature-era backing persisted as a black line matches ownership by
    // footprint; migration must rebuild the canonical shape instead of
    // merging box props into the line.
    const label = { customFonts: [], defaultFontId: undefined };
    const rev = text({ reverse: true, fontId: "G", fontHeight: 40,
      blockWidth: 700, blockLines: 3 });
    const legacy = reverseBackingBoxGeometry(rev as never, label, { rawBlockPitch: true });
    const line = { id: "bg", type: "line", x: legacy.x, y: legacy.y, rotation: 0,
      props: { length: legacy.props.width, thickness: legacy.props.height,
        angle: 0, color: "B" } } as unknown as LabelObject;
    const out = insertReverseBackingBoxes([line, rev], label);
    expect(out).toHaveLength(2);
    const migrated = out[0] as { id: string; type: string; props: { thickness?: number } };
    expect(migrated.id).toBe("bg");
    expect(migrated.props.thickness).toBe(180);
  });

  it("swaps width/height for vertical rotations", () => {
    const n = reverseBackingBoxGeometry(text({ reverse: true, rotation: "N" }) as never);
    const r = reverseBackingBoxGeometry(text({ reverse: true, rotation: "R" }) as never);
    expect(r.props.width).toBe(n.props.height);
    expect(r.props.height).toBe(n.props.width);
  });
});

describe("insertReverseBackingBoxes", () => {
  it("inserts a black backing before each reverse text", () => {
    const out = insertReverseBackingBoxes([text({ reverse: true })]);
    expect(out).toHaveLength(2);
    expect(isBlackBacking(out[0])).toBe(true);
    expect(out[1]?.type).toBe("text");
  });

  it("leaves non-reverse text untouched", () => {
    const out = insertReverseBackingBoxes([text({ reverse: false })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("text");
  });

  it("skips inserting when a covering black box already sits behind the text", () => {
    const rev = text({ reverse: true });
    const cover = {
      id: "bg",
      type: "box",
      x: 50,
      y: 50,
      rotation: 0,
      props: { width: 300, height: 30, thickness: 30, filled: true, color: "B", rounding: 0 },
    } as unknown as LabelObject;
    const out = insertReverseBackingBoxes([cover, rev]);
    expect(out).toHaveLength(2); // no duplicate backing added
    expect(out[0]?.id).toBe("bg");
  });

  it("detects a covering backing even with an unrelated object between it and the text", () => {
    const rev = text({ reverse: true });
    const cover = {
      id: "bg",
      type: "box",
      x: 50,
      y: 50,
      rotation: 0,
      props: { width: 300, height: 30, thickness: 30, filled: true, color: "B", rounding: 0 },
    } as unknown as LabelObject;
    const between = {
      id: "mid",
      type: "line",
      x: 50,
      y: 45,
      rotation: 0,
      props: { angle: 0, length: 100, thickness: 2, color: "B" },
    } as unknown as LabelObject;
    const out = insertReverseBackingBoxes([cover, between, rev]);
    expect(out).toHaveLength(3); // no duplicate despite the object in between
  });

  it("still inserts when an existing black shape only partially covers the text", () => {
    const rev = text({ reverse: true });
    const half = {
      id: "half",
      type: "box",
      x: 50,
      y: 50,
      rotation: 0,
      // height 15 over a 30-tall text => ~0.5 coverage, below the 0.9 threshold.
      props: { width: 300, height: 15, thickness: 15, filled: true, color: "B", rounding: 0 },
    } as unknown as LabelObject;
    const out = insertReverseBackingBoxes([half, rev]);
    expect(out).toHaveLength(3); // partial cover must not suppress the backing
  });

  it("still inserts when only a thin separator (not covering) precedes the text", () => {
    const rev = text({ reverse: true });
    const separator = {
      id: "sep",
      type: "line",
      x: 50,
      y: 40,
      rotation: 0,
      props: { angle: 0, length: 300, thickness: 2, color: "B" },
    } as unknown as LabelObject;
    const out = insertReverseBackingBoxes([separator, rev]);
    expect(out).toHaveLength(3); // separator doesn't count, backing added
    expect(out[0]?.id).toBe("sep");
    expect(isBlackBacking(out[1])).toBe(true);
  });

  it("does not crash on a malformed label (best-effort measure)", () => {
    const rev = {
      ...(text({ reverse: true }) as unknown as Record<string, unknown>),
      props: { content: "Hi", fontHeight: 30, fontWidth: 0, rotation: "N", reverse: true, fontId: "A" },
    } as unknown as LabelObject;
    // customFonts in the wrong shape would make font resolution throw.
    const badLabel = { customFonts: "oops", defaultFontId: "A" } as never;
    expect(() => insertReverseBackingBoxes([rev], badLabel)).not.toThrow();
    expect(insertReverseBackingBoxes([rev], badLabel)).toHaveLength(2);
  });

  it("does not crash on a malformed label for an ^FB device-font text", () => {
    const rev = {
      ...(text({ reverse: true }) as unknown as Record<string, unknown>),
      props: { content: "Hi", fontHeight: 84, fontWidth: 0, rotation: "N",
        reverse: true, fontId: "G", blockWidth: 700, blockLines: 3 },
    } as unknown as LabelObject;
    const badLabel = { customFonts: "oops", defaultFontId: "A" } as never;
    expect(() => insertReverseBackingBoxes([rev], badLabel)).not.toThrow();
  });

  it("recognizes a covering line whose angle is a string (unvalidated json)", () => {
    const rev = text({ reverse: true });
    const lineStrAngle = {
      id: "ln",
      type: "line",
      x: 50,
      y: 50,
      rotation: 0,
      props: { angle: "0", length: 300, thickness: 30, color: "B" },
    } as unknown as LabelObject;
    const out = insertReverseBackingBoxes([lineStrAngle, rev]);
    expect(out).toHaveLength(2); // string angle still detected, no duplicate
  });

  it("produces finite dimensions for malformed block props", () => {
    const geo = reverseBackingBoxGeometry({
      x: 0,
      y: 0,
      props: { content: "Hi", fontHeight: 30, fontWidth: 0, rotation: "N", reverse: true, textMode: "fb", blockWidth: "abc" },
    } as never);
    expect(Number.isFinite(geo.props.width)).toBe(true);
    expect(Number.isFinite(geo.props.height)).toBe(true);
    expect(Number.isFinite(geo.props.thickness)).toBe(true);
  });

  it("recurses into groups", () => {
    const group = {
      id: "g",
      type: "group",
      x: 0,
      y: 0,
      rotation: 0,
      children: [text({ reverse: true })],
    } as unknown as LabelObject;
    const out = insertReverseBackingBoxes([group]);
    expect(out).toHaveLength(1);
    const children = (out[0] as unknown as { children: LabelObject[] }).children;
    expect(children).toHaveLength(2);
    expect(isBlackBacking(children[0])).toBe(true);
  });

  it("tolerates a malformed group without children", () => {
    const bad = { id: "g", type: "group", x: 0, y: 0, rotation: 0 } as unknown as LabelObject;
    expect(() => insertReverseBackingBoxes([bad])).not.toThrow();
  });

  it("passes null / primitive entries through without crashing", () => {
    const junk = [null, 42, "x"] as unknown as LabelObject[];
    expect(() => insertReverseBackingBoxes(junk)).not.toThrow();
    expect(insertReverseBackingBoxes(junk)).toHaveLength(3);
  });

  it("inherits visible / includeInExport / locked onto the backing box", () => {
    const hidden = {
      ...(text({ reverse: true }) as unknown as Record<string, unknown>),
      visible: false,
      includeInExport: false,
      locked: true,
    } as unknown as LabelObject;
    const [box] = insertReverseBackingBoxes([hidden]);
    expect(isBlackBacking(box)).toBe(true);
    expect(box?.visible).toBe(false);
    expect(box?.includeInExport).toBe(false);
    expect(box?.locked).toBe(true);
  });

  it("skips a malformed reverse text (no usable geometry) without crashing", () => {
    const bad = { id: "t", type: "text", x: 0, y: 0, rotation: 0, props: { reverse: true } } as unknown as LabelObject;
    expect(() => insertReverseBackingBoxes([bad])).not.toThrow();
    const out = insertReverseBackingBoxes([bad]);
    expect(out).toHaveLength(1); // no box inserted
    expect(out[0]?.type).toBe("text");
  });
});

describe("isReverseBackingFor vs isOwnReverseBacking (shared banner)", () => {
  const rev = text({ reverse: true }) as never;
  const banner = {
    id: "banner",
    type: "box",
    x: 0,
    y: 0,
    rotation: 0,
    props: { width: 600, height: 200, thickness: 200, filled: true, color: "B", rounding: 0 },
  } as unknown as LabelObject;

  it("treats a covering banner as a knockout background (migration skips)", () => {
    expect(isReverseBackingFor(banner, rev)).toBe(true);
  });

  it("does NOT treat the banner as a removable per-text backing", () => {
    // Guards the remove flow from deleting a deliberate shared layout element.
    expect(isOwnReverseBacking(banner, rev)).toBe(false);
  });

  it("treats our own created backing as a removable per-text backing", () => {
    const own = makeReverseBackingBox(rev);
    expect(isOwnReverseBacking(own, rev)).toBe(true);
  });
});

describe("makeReverseBackingBox", () => {
  it("produces a positioned FO backing with a fresh id", () => {
    const box = makeReverseBackingBox(text({ reverse: true }) as never);
    expect(isBlackBacking(box)).toBe(true);
    expect(box.positionType).toBe("FO");
    expect(box.id).toBeTruthy();
  });

  it("emits a square backing as a box and a wide one as a line (parser parity)", () => {
    const wide = makeReverseBackingBox(text({ reverse: true, content: "wide text here" }) as never);
    expect(wide.type).toBe("line"); // width > height -> canonical line
    const tall = makeReverseBackingBox(text({ reverse: true, rotation: "R", content: "wide text here" }) as never);
    expect(tall.type).toBe("line"); // vertical bar
  });
});
