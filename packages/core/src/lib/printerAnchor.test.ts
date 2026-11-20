import { describe, expect, it } from "vitest";
import { ObjectRegistry } from "../registry";
import type { LabelObject } from "../types/Group";
import type { Variable } from "../types/Variable";
import { footprintDots, printerAnchoredX } from "./printerAnchor";
import { generateMultiPageZPL } from "./zplGenerator";

const LABEL = { widthMm: 100, heightMm: 60, dpmm: 8, emit1dZJustify: true };
const VAR: Variable = { id: "v1", name: "v", fnNumber: 1, defaultValue: "123" };
const LONG = "123456789012345";
// Code 128 "123" at module width 2 is 68 modules wide.
const W123 = 136;

const bound = (props: Record<string, unknown> = {}): LabelObject =>
  ({
    id: "b1",
    type: "code128",
    x: 300,
    y: 50,
    positionType: "FT",
    fieldJustify: "R",
    props: { ...ObjectRegistry.code128.defaultProps, content: "«v»", moduleWidth: 2, printInterpretation: false, ...props },
  }) as LabelObject;

const maxicode = (): LabelObject =>
  ({ id: "m1", type: "maxicode", x: 0, y: 0, props: { ...ObjectRegistry.maxicode.defaultProps } }) as LabelObject;

describe("printerAnchoredX", () => {
  it("anchors a gated field at its left edge plus the width of the variable default", () => {
    expect(printerAnchoredX(bound(), LABEL, [VAR])).toBe(300 + W123);
  });

  it("moves the emitted anchor when the variable default gets wider", () => {
    const anchor = (variables: Variable[]) =>
      Number(/\^FT(\d+),50,1/.exec(generateMultiPageZPL(LABEL, [{ objects: [bound()] }], variables))?.[1]);
    expect(anchor([VAR])).toBe(300 + W123);
    expect(anchor([{ ...VAR, defaultValue: LONG }])).toBeGreaterThan(300 + W123);
  });

  it("keeps a field whose variable default reaches past the label home", () => {
    const long = [{ ...VAR, defaultValue: LONG }];
    const obj = { ...bound(), x: 10 } as LabelObject;
    const width = footprintDots(obj, LABEL, long)!.w;
    expect(footprintDots(obj, LABEL, [])?.w).toBeLessThan(290);
    const zpl = generateMultiPageZPL({ ...LABEL, labelHomeX: 300 }, [{ objects: [obj] }], long);
    expect(zpl).toContain(`^FT${10 + width - 300},50,1`);
  });

  it("answers null when the field emits z-less", () => {
    expect(printerAnchoredX(bound(), { ...LABEL, emit1dZJustify: false }, [VAR])).toBeNull();
    expect(printerAnchoredX(bound({ rotation: "R" }), LABEL, [VAR])).toBeNull();
    expect(printerAnchoredX({ ...maxicode(), fieldJustify: "R" } as LabelObject, LABEL, [])).toBeNull();
  });
});

describe("footprintDots memo", () => {
  it("measures the same object again when the variable default changes", () => {
    const obj = bound();
    const short = footprintDots(obj, LABEL, [VAR]);
    const long = footprintDots(obj, LABEL, [{ ...VAR, defaultValue: LONG }]);
    expect(short?.w).toBe(W123);
    expect(long).toEqual(footprintDots(bound(), LABEL, [{ ...VAR, defaultValue: LONG }]));
    expect(long?.w).toBeGreaterThan(W123);
    expect(footprintDots(obj, LABEL, [VAR])).toEqual(short);
  });

  it("measures the same object again when the density changes", () => {
    const obj = maxicode();
    const at8 = footprintDots(obj, { dpmm: 8 }, []);
    const at12 = footprintDots(obj, { dpmm: 12 }, []);
    const halved = footprintDots(obj, { dpmm: 8, jmDensity: "B" }, []);
    expect(at12).toEqual(footprintDots(maxicode(), { dpmm: 12 }, []));
    expect(halved).toEqual(footprintDots(maxicode(), { dpmm: 8, jmDensity: "B" }, []));
    expect(at12).not.toEqual(at8);
    expect(halved).not.toEqual(at8);
  });
});
