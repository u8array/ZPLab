import { describe, it, expect } from "vitest";
import { cachedFontFaceStyle, systemFontFaceStyle } from "./fontFaceStyle";

const font = (family: string, style: string) => ({ family, style });

describe("systemFontFaceStyle", () => {
  it("maps compound and single style words to weight and slant", () => {
    expect(systemFontFaceStyle(font("Noto Sans", "Extra Bold Italic"))).toEqual({ fontFamily: '"Noto Sans"', fontWeight: 800, fontStyle: "italic" });
    expect(systemFontFaceStyle(font("A", "Semi-Bold"))).toEqual({ fontFamily: '"A"', fontWeight: 600, fontStyle: undefined });
    expect(systemFontFaceStyle(font("A", "Ultra Light"))).toEqual({ fontFamily: '"A"', fontWeight: 200, fontStyle: undefined });
    expect(systemFontFaceStyle(font("A", "Bold"))).toEqual({ fontFamily: '"A"', fontWeight: 700, fontStyle: undefined });
  });

  it("leaves a style with no known weight word unweighted", () => {
    expect(systemFontFaceStyle(font("A", "Condensed Oblique"))).toEqual({ fontFamily: '"A"', fontWeight: undefined, fontStyle: "italic" });
  });

  it("strips quotes from the family", () => {
    expect(systemFontFaceStyle(font('Say "Hi"', "Regular")).fontFamily).toBe('"Say Hi"');
  });
});

describe("cachedFontFaceStyle", () => {
  it("quotes a registered face and leaves a font without one unstyled", () => {
    expect(cachedFontFaceStyle("zpl-7")).toEqual({ fontFamily: '"zpl-7"' });
    expect(cachedFontFaceStyle(undefined)).toBeUndefined();
  });
});
