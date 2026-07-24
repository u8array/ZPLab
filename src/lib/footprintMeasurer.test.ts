import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initFootprintMeasurer } from "./footprintMeasurer";
import { registerFootprintMeasurer } from "@zplab/core/lib/footprintProber";
import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { useLabelStore } from "../store/labelStore";
import type { LabelObject } from "@zplab/core/types/Group";

const LABEL = { widthMm: 100, heightMm: 60, dpmm: 8, emit1dZJustify: true };
const VAR = { id: "v1", name: "v", fnNumber: 1, defaultValue: "123" };
const LONG = "123456789012345";

const barcode = (): LabelObject =>
  ({
    id: "b1",
    type: "code128",
    x: 300,
    y: 50,
    positionType: "FT",
    fieldJustify: "R",
    props: {
      content: "«v»",
      height: 100,
      moduleWidth: 2,
      printInterpretation: false,
      printInterpretationAbove: false,
      checkDigit: false,
      rotation: "N",
    },
  }) as unknown as LabelObject;

const emit = (): string => {
  const s = useLabelStore.getState();
  return generateMultiPageZPL(s.label, s.pages, s.variables);
};

beforeAll(() => initFootprintMeasurer());
afterAll(() => registerFootprintMeasurer(null));

describe("app footprint bridge", () => {
  it("the gated anchor byte ignores the previewed dataset row", () => {
    useLabelStore.setState({
      label: { ...LABEL },
      pages: [{ objects: [barcode()] }],
      variables: [VAR],
      dataset: null,
      columnMapping: null,
    } as never);
    const withoutRow = emit();
    expect(withoutRow).toMatch(/\^FT\d+,50,1/);

    // Fresh props ref so the memo cannot mask a live-row resolution.
    useLabelStore.setState({
      pages: [{ objects: [barcode()] }],
      dataset: { headers: ["col"], rows: [[LONG]], activeRowIndex: 0, source: { kind: "csv" } },
      columnMapping: { bindings: { v1: "col" }, headerSnapshot: ["col"] },
    } as never);
    expect(emit()).toBe(withoutRow);
  });

  it("a wider variable DEFAULT does move the anchor (the row test discriminates)", () => {
    useLabelStore.setState({
      label: { ...LABEL },
      pages: [{ objects: [barcode()] }],
      variables: [{ ...VAR, defaultValue: LONG }],
      dataset: null,
      columnMapping: null,
    } as never);
    const s = useLabelStore.getState();
    const wide = generateMultiPageZPL(s.label, s.pages, s.variables);
    useLabelStore.setState({ pages: [{ objects: [barcode()] }], variables: [VAR] } as never);
    expect(emit()).not.toBe(wide);
  });
});
