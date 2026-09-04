import { describe, expect, it } from "vitest";
import { buildPreviewZpl } from "./printPreview";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import type { LabelObject } from "@zplab/core/types/Group";

const label = { widthMm: 100, heightMm: 50, dpmm: 8 } as PageLabel;

const blankBarcode = (): LabelObject[] => [
  {
    id: "bc",
    type: "code128",
    x: 10,
    y: 10,
    rotation: 0,
    props: { content: "", height: 80, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation: "N" },
  } as LabelObject,
];

describe("buildPreviewZpl blank-field samples", () => {
  it("overlay opt-in renders a blank barcode with its symbology sample", () => {
    const zpl = buildPreviewZpl(label, blankBarcode(), [], null, { blankSamples: true });
    expect(zpl).toContain("^FD12345678^FS");
  });

  it("default (print path) keeps the blank ^FD so sample data never prints", () => {
    const zpl = buildPreviewZpl(label, blankBarcode(), [], null);
    expect(zpl).toContain("^FD^FS");
    expect(zpl).not.toContain("^FD12345678^FS");
  });

  it("emits the page's ^JM so a diverging page previews at its own density", () => {
    const zpl = buildPreviewZpl({ ...label, jmDensity: "B" }, blankBarcode(), [], null);
    expect(zpl).toContain("^JMB");
  });

  it("blank text has no sample and stays blank even with the opt-in", () => {
    const text = [
      {
        id: "t",
        type: "text",
        x: 10,
        y: 10,
        rotation: 0,
        props: { content: "", fontHeight: 30, fontWidth: 0, rotation: "N" },
      } as LabelObject,
    ];
    const zpl = buildPreviewZpl(label, text, [], null, { blankSamples: true });
    expect(zpl).toContain("^FD^FS");
  });
});

describe("buildPreviewZpl metadata", () => {
  it("never carries ZPLab metadata: a preview is rendered, not re-imported", () => {
    const zpl = buildPreviewZpl(label, blankBarcode(), [], null);
    expect(zpl).not.toContain("ZPLLAB");
    expect(zpl).toContain("^PW800");
  });
});
