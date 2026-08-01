import { describe, it, expect } from "vitest";
import { ObjectRegistry } from "@zplab/core/registry";
import { validateMaxicodeBwip } from "../components/Canvas/bwipHelpers";
import type { LabelObjectBase } from "@zplab/core/types/LabelObject";
import type { MaxicodeProps } from "@zplab/core/registry/maxicode";
import { defined, parseSingle } from "../test/helpers";

function makeObj(props: MaxicodeProps, overrides?: Partial<LabelObjectBase>): LabelObjectBase & { props: MaxicodeProps } {
  return {
    id: "test-id",
    type: "maxicode",
    x: 100,
    y: 200,
    rotation: 0,
    ...overrides,
    props,
  };
}

describe("maxicode.toZPL", () => {
  const def = defined(ObjectRegistry["maxicode"]);

  it("emits ^BD with mode and defaults the structured-append slots to (1,1)", () => {
    const zpl = def.toZPL(makeObj({
      content: "abc",
      mode: 4,
    }));
    expect(zpl).toContain("^FO100,200");
    expect(zpl).toContain("^BD4,1,1");
    expect(zpl).toContain("^FDabc^FS");
  });

  it("emits the carried structured-append slots", () => {
    const zpl = def.toZPL(makeObj({ content: "abc", mode: 4, symbolNumber: 2, symbolTotal: 3 }));
    expect(zpl).toContain("^BD4,2,3");
  });
});

describe("validateMaxicodeBwip", () => {
  // Tests run in vitest's node environment where document.createElement
  // produces a stub canvas without a 2D context, so success-path
  // assertions (mode 4/5 with valid content) can't be verified here.
  // The rejection paths exercise bwip-js' format validators, which
  // throw synchronously before touching the canvas; that's the
  // contract we actually need to pin (cleaned error message format).

  it("returns a non-null cleaned diagnostic when bwip-js rejects (e.g. mode 2/3 with bare text)", () => {
    // Pick an input that triggers either an SCM-format error (mode 2/3)
    // or the canvas-missing fallback; both are stripped of the
    // `bwip-js:` / `bwipp.<symbology>:` prefixes by cleanBwipError.
    const err = validateMaxicodeBwip("HELLO123", 2);
    expect(err).not.toBeNull();
    expect(err).not.toMatch(/^bwip-js:/);
    expect(err).not.toMatch(/^bwipp\./);
  });

  it("never throws — encoder errors are caught and surfaced as strings", () => {
    expect(() => validateMaxicodeBwip("HELLO", 3)).not.toThrow();
    expect(() => validateMaxicodeBwip("", 4)).not.toThrow();
  });
});

describe("maxicode parser roundtrip", () => {
  it("parses ^BD back to a maxicode object", () => {
    const src = "^XA^PW400^LL400^FO50,50^BD3,1,1^FDPAYLOAD^FS^XZ";
    const { objects } = parseSingle(src);
    const obj = objects[0];
    expect(obj?.type).toBe("maxicode");
    if (obj?.type !== "maxicode") return;
    expect(obj.props.content).toBe("PAYLOAD");
    expect(obj.props.mode).toBe(3);
    expect(defined(ObjectRegistry["maxicode"]).toZPL(obj)).toContain("^BD3,1,1");
  });

  // Spec p106: m defaults to 2 and 2-6 is the whole value list, so an omitted
  // and an out-of-range m both land on 2 (the firmware's reading). 4 is only the
  // spawn default for new objects, never a parse fallback.
  it("reads an omitted mode as the spec default 2", () => {
    const src = "^XA^FO50,50^BD,1,1^FD12345\x1d840\x1d001\x1dX^FS^XZ";
    const { objects } = parseSingle(src);
    const obj = objects[0];
    if (obj?.type !== "maxicode") throw new Error("expected maxicode");
    expect(obj.props.mode).toBe(2);
    expect(defined(ObjectRegistry["maxicode"]).toZPL(obj)).toContain("^BD2,1,1");
  });

  it("coerces an out-of-range mode to the spec default 2", () => {
    const src = "^XA^FO0,0^BD9,1,1^FDX^FS^XZ";
    const { objects } = parseSingle(src);
    const obj = objects[0];
    if (obj?.type !== "maxicode") throw new Error("expected maxicode");
    expect(obj.props.mode).toBe(2);
  });

  it("round-trips the structured-append slots of a 3-symbol set", () => {
    const src = [
      "^XA",
      "^FO0,0^BD4,1,3^FDA^FS",
      "^FO0,220^BD4,2,3^FDB^FS",
      "^FO0,440^BD4,3,3^FDC^FS",
      "^XZ",
    ].join("");
    const def = defined(ObjectRegistry["maxicode"]);
    const symbols = parseSingle(src).objects.map((o) => {
      if (o.type !== "maxicode") throw new Error("expected maxicode");
      return o;
    });
    expect(symbols.map((o) => [o.props.symbolNumber, o.props.symbolTotal])).toEqual([
      [1, 3], [2, 3], [3, 3],
    ]);
    expect(symbols.map((o) => def.toZPL(o).match(/\^BD[\d,]+/)?.[0])).toEqual([
      "^BD4,1,3",
      "^BD4,2,3",
      "^BD4,3,3",
    ]);
  });

  it("clamps out-of-range structured-append slots into the spec 1-8 range", () => {
    const { objects } = parseSingle("^XA^FO0,0^BD4,0,99^FDX^FS^XZ");
    const obj = objects[0];
    if (obj?.type !== "maxicode") throw new Error("expected maxicode");
    expect([obj.props.symbolNumber, obj.props.symbolTotal]).toEqual([1, 8]);
  });

  it("emit -> parse roundtrip preserves content and mode", () => {
    const def = defined(ObjectRegistry["maxicode"]);
    const body = def.toZPL(makeObj({
      content: "HELLO123",
      mode: 5,
    }));
    const src = `^XA${body}^XZ`;
    const { objects } = parseSingle(src);
    const obj = objects[0];
    if (obj?.type !== "maxicode") throw new Error("expected maxicode");
    expect(obj.props.content).toBe("HELLO123");
    expect(obj.props.mode).toBe(5);
  });
});
