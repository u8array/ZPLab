import { describe, it, expect } from "vitest";
import { crlfIndex, isPureCrlf, minimalSplice, toDocPos } from "./sourceOffsets";

describe("sourceOffsets", () => {
  it("maps string offsets to editor positions, one per CRLF", () => {
    const idx = crlfIndex("^XA\r\n^FO\r\n^XZ");
    expect(toDocPos(idx, 0)).toBe(0);
    expect(toDocPos(idx, 5)).toBe(4);
    expect(toDocPos(idx, 12)).toBe(10);
  });

  it("splices minimally in LF and CRLF buffers", () => {
    expect(minimalSplice("^XA\n^FDa^FS\n^XZ", "^XA\n^FDab^FS\n^XZ", "\n")).toEqual({ from: 8, to: 8, insert: "b" });
    expect(minimalSplice("^XA\r\n^FDa^FS\r\n^XZ", "^XA\r\n^FDab^FS\r\n^XZ", "\r\n")).toEqual({ from: 8, to: 8, insert: "b" });
    expect(minimalSplice("a\r\nb", "a\r\n\r\nb", "\r\n")).toEqual({ from: 2, to: 2, insert: "\r\n" });
  });

  it("never cuts a CRLF pair, which is one editor position", () => {
    // The common prefix ends between \r and \n; the splice must start before the pair.
    expect(minimalSplice("a\r\nb", "a\rb", "\r\n")).toEqual({ from: 1, to: 2, insert: "\r" });
    // The common suffix starts between \r and \n; the splice must end after the pair.
    expect(minimalSplice("a\r\nb", "a\n\nb", "\r\n")).toEqual({ from: 1, to: 2, insert: "\n\n" });
  });

  it("pins CRLF only for a buffer with no bare LF", () => {
    expect(isPureCrlf("a\r\nb")).toBe(true);
    expect(isPureCrlf("a\r\nb\nc")).toBe(false);
    expect(isPureCrlf("a\nb")).toBe(false);
  });
});
