import { describe, expect, it } from "vitest";
import { unzlibSync } from "fflate";
import { writePdf, type PdfPage } from "./pdfWriter";

const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

const page = (fill: number): PdfPage => ({ widthMm: 50, heightMm: 30, width: 16, height: 8, mono: new Uint8Array(16).fill(fill) });

describe("writePdf", () => {
  it("lays out catalog, pages, info and one image per page with a cross-reference table whose offsets land on each object", () => {
    const pdf = writePdf([page(0xff), page(0x0f)], { producer: "ZPLab", subject: "Rendered with a test" });
    const text = latin1(pdf);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/MediaBox [0 0 141.73 85.04]");
    expect(text).toContain("/Producer (ZPLab) /Subject (Rendered with a test)");
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = text.slice(xrefAt).split("\n").slice(2, 12);
    expect(entries).toHaveLength(10);
    entries.slice(1).forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj\n`)).toBe(true);
    });
  });

  it("stores every stream with its exact length and the rows inverted for DeviceGray", () => {
    const pdf = writePdf([page(0xf0)], { producer: "ZPLab" });
    const text = latin1(pdf);
    const streams = [...text.matchAll(/\/Length (\d+) >>\nstream\n/g)];
    expect(streams).toHaveLength(2);
    for (const m of streams) {
      const start = m.index! + m[0].length;
      expect(text.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe("\nendstream");
    }
    const image = streams[0]!;
    const start = image.index! + image[0].length;
    const bytes = pdf.slice(start, start + Number(image[1]));
    expect([...unzlibSync(bytes)]).toEqual(new Array(16).fill(0x0f));
    expect(text).toContain("q 141.73 0 0 85.04 0 0 cm /Im0 Do Q");
  });

  it("escapes ASCII metadata, carries other scripts as UTF-16 and refuses what it cannot lay out", () => {
    const text = latin1(writePdf([page(0)], { producer: "ZP(L)ab\\", title: "Étiquette", subject: "ラベル" }));
    expect(text).toContain("/Producer (ZP\\(L\\)ab\\\\)");
    expect(text).toContain("/Title <FEFF00C9007400690071007500650074007400650>".slice(0, 20));
    expect(text).toContain("/Subject <FEFF30E930D930EB>");
    expect(() => writePdf([], { producer: "ZPLab" })).toThrow();
    expect(() => writePdf([{ ...page(0), mono: new Uint8Array(15) }], { producer: "ZPLab" })).toThrow();
    expect(() => writePdf([{ ...page(0), width: 0 }], { producer: "ZPLab" })).toThrow();
  });
});
