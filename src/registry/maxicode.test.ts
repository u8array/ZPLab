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

  it("emits ^BD with mode and pinned (1,1) structured-append fields", () => {
    const zpl = def.toZPL(makeObj({
      content: "abc",
      mode: 4,
    }));
    expect(zpl).toContain("^FO100,200");
    expect(zpl).toContain("^BD4,1,1");
    expect(zpl).toContain("^FDabc^FS");
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

  it("defaults mode to 4 when an out-of-range value is given", () => {
    // mode 9 doesn't exist; parser clamps to the safe standalone default.
    const src = "^XA^FO0,0^BD9,1,1^FDX^FS^XZ";
    const { objects } = parseSingle(src);
    const obj = objects[0];
    if (obj?.type !== "maxicode") throw new Error("expected maxicode");
    expect(obj.props.mode).toBe(4);
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
