import { describe, it, expect } from "vitest";
import { importZplText } from "./zplImportService";

const single = "^XA^FO10,10^A0N,20,20^FDx^FS^PQ2,0,0,N^XZ";
const lines = "^XA\n^FO10,10^A0N,20,20^FDx^FS\n^PQ2,0,0,N\n^XZ";

describe("line-oriented ZPL", () => {
  it("reads the last parameter the same with or without line breaks", () => {
    expect(importZplText(lines, 8).labelConfig.overridePauseCount).toBe(
      importZplText(single, 8).labelConfig.overridePauseCount,
    );
    expect(importZplText(lines, 8).labelConfig.overridePauseCount).toBe("N");
  });

  it("leaves field data verbatim, unlike the parameter list", () => {
    const r = importZplText("^XA\n^FO10,10^A0N,20,20^FDkeep me \n^FS\n^XZ", 8);
    const text = r.pages[0]?.objects[0] as { props: { content: string } };
    expect(text.props.content).toBe("keep me \n");
  });
});

describe("a parameter whose value is a space", () => {
  it("survives, because ^FE takes any character", () => {
    // Spec p.191: the embed delimiter is any character but ^ and ~.
    const r = importZplText("^XA\n^FN1^FDA^FS\n^FE ^FO10,10^A0N,20,20^FD 1 ^FS\n^XZ", 8);
    const text = r.pages[0]?.objects.find((o) => o.type === "text") as { props: { content: string } };
    expect(text.props.content).toContain("«");
  });
});

describe("indented ZPL", () => {
  // The common hand-authored shape: the break is followed by the next line's
  // indent, so an end-anchored newline strip never fires.
  it("keeps an enum parameter intact when the next line is indented", () => {
    for (const zpl of [
      "^XA\n  ^FO10,10^A0N,20,20^FDx^FS\n  ^PQ2,0,0,N\n  ^XZ",
      "^XA\r\n\t^PQ2,0,0,N \r\n\t^XZ",
    ]) {
      expect(importZplText(zpl, 8).labelConfig.overridePauseCount, zpl).toBe("N");
    }
  });
});

describe("a whitespace parameter after a non-blank one", () => {
  // ^FC's tertiary indicator IS the space here; the strip may only take
  // whitespace hanging after real content, not a whitespace-valued slot.
  it("keeps the space tertiary clock indicator, with and without line breaks", () => {
    for (const zpl of [
      "^XA\n^FC%,{, \n^FO10,10^A0N,20,20^FD H^FS\n^XZ",
      "^XA^FC%,{, ^FO10,10^A0N,20,20^FD H^FS^XZ",
    ]) {
      const text = importZplText(zpl, 8).pages[0]?.objects[0] as { props: { content: string } };
      expect(text.props.content, zpl).toContain("«clock3:H»");
    }
  });
});

describe("a trailing space with no line break", () => {
  // Single-line ZPL has no wrap indentation to strip, so a space after the last
  // parameter is real data (a ^SN seed here) and must survive; the strip is
  // line-break-only. A regression of the strip shortened the seed to "AB".
  it("keeps a space the last parameter ends with", () => {
    const r = importZplText("^XA^FO10,10^A0N,20,20^SNAB ^FS^XZ", 8);
    const text = r.pages[0]?.objects.find((o) => o.type === "text") as { props: { content: string } };
    expect(text.props.content).toBe("AB ");
  });
});

describe("a whitespace character parameter at line end", () => {
  // ^FE's parameter IS a space here; only the break and indent may go.
  it("keeps the space delimiter that the line break follows", () => {
    const zpl = "^XA\n^FN1^FDA^FS\n^FE \n^FO10,10^A0N,20,20^FD 1 ^FS\n^XZ";
    const objects = importZplText(zpl, 8).pages[0]?.objects ?? [];
    const contents = objects.map((o) => (o as { props?: { content?: string } }).props?.content);
    expect(contents).toContain("«field_1»");
  });
});
