import { describe, it, expect } from "vitest";
import { FONT_SAMPLE_TEXT, fontSampleZpl } from "./fontSample";

const media = { widthMm: 100, heightMm: 150, dpmm: 8 };

describe("fontSampleZpl", () => {
  it("sets the printer font on a label of the media size, with a line budget the text cannot exceed", () => {
    expect(fontSampleZpl("E:CG_TIMES.TTF", media)).toBe(`^XA^PW800^LL1200^FO40,40^A@N,60,,E:CG_TIMES.TTF^FB720,${FONT_SAMPLE_TEXT.length},0,L^FD${FONT_SAMPLE_TEXT}^FS^XZ`);
  });

  it("shrinks margin and size on narrow media so the block still fits a character", () => {
    expect(fontSampleZpl("E:A.FNT", { ...media, widthMm: 12 })).toContain("^PW96^LL1200^FO9,9^A@N,24,,E:A.FNT^FB78,");
  });

  it("keeps the field inside a short label and never asks for a zero size", () => {
    expect(fontSampleZpl("E:A.FNT", { ...media, heightMm: 5 })).toContain("^PW800^LL40^FO4,4^A@N,10,,E:A.FNT^FB792,");
    expect(fontSampleZpl("E:A.FNT", { widthMm: 1, heightMm: 1, dpmm: 6, jmDensity: "B" })).toContain("^FO0,0^A@N,1,,E:A.FNT^FB3,");
  });

  it("declares half density and sizes the field in that space while ^PW and ^LL keep head dots", () => {
    expect(fontSampleZpl("E:A.FNT", { ...media, jmDensity: "B" })).toContain("^XA^JMB^PW800^LL1200^FO20,20^A@N,30,,E:A.FNT^FB360,");
  });

  it("never lets a command character into the font slot", () => {
    const zpl = fontSampleZpl("E:A^XZ~DG.TTF", media);
    expect(zpl).not.toContain("A^XZ");
    expect(zpl).not.toContain("~DG");
  });
});
