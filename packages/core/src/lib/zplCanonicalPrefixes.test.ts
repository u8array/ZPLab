import { describe, it, expect } from "vitest";
import { canonicalPrefixes } from "./zplCanonicalPrefixes";

const NL = String.fromCharCode(10);
const j = (...lines: string[]) => lines.join(NL);

describe("canonicalPrefixes", () => {
  it("writes a remapped caret, tilde and delimiter back, keeping every offset", () => {
    const zpl = j("^XA", "^CC!", "!CD;", "!FO20;90!A0N;30;0!FDa;b!FS", "!CT|", "|JA", "!XZ");
    const out = canonicalPrefixes(zpl);
    expect(out).toBe(j("^XA", "^CC!", "^CD;", "^FO20,90^A0N,30,0^FDa;b^FS", "^CT|", "~JA", "^XZ"));
    expect(out.length).toBe(zpl.length);
  });

  it("keeps astral characters, a rejected remap, the tilde form and data delimiters intact", () => {
    const emoji = j("^XA", "^FO1,2^FDa\u{1F600}b^FS", "^CC!", "!FO3,4!FDc!FS", "!XZ");
    expect(canonicalPrefixes(emoji)).toBe(j("^XA", "^FO1,2^FDa\u{1F600}b^FS", "^CC!", "^FO3,4^FDc^FS", "^XZ"));
    expect(canonicalPrefixes(emoji).length).toBe(emoji.length);
    const rejected = j("^XA", "^CC,", "^FO1,2^FDa^FS", "^XZ");
    expect(canonicalPrefixes(rejected)).toBe(rejected);
    expect(canonicalPrefixes(j("^XA", "~CC!", "!FO1,2!FDa!FS", "!XZ"))).toBe(j("^XA", "~CC!", "^FO1,2^FDa^FS", "^XZ"));
    expect(canonicalPrefixes(j("^XA", "^CD;", "^FO1;2^FDa;b^FS", "~DYR:X;B;PNG;3;;a;b", "^GFA;8;8;1;FF;0^FS", "^XZ"))).toBe(j("^XA", "^CD;", "^FO1,2^FDa;b^FS", "~DYR:X;B;PNG;3;;a;b", "^GFA;8;8;1;FF;0^FS", "^XZ"));
  });

  it("leaves a text without remaps alone and applies a remap only from where it lands", () => {
    const plain = j("^XA", "^FO1,2^FDx,y^FS", "^XZ");
    expect(canonicalPrefixes(plain)).toBe(plain);
    const mid = j("^XA", "^FO1,2^FDa^FS", "^CC!", "!FO3,4!FDb!FS", "!XZ");
    expect(canonicalPrefixes(mid)).toBe(j("^XA", "^FO1,2^FDa^FS", "^CC!", "^FO3,4^FDb^FS", "^XZ"));
  });
});
