import { describe, it, expect } from "vitest";
import { formatLabelMetaComment, formatSidecarComment, parseLabelMetaComment, sidecarRanges, stripSidecarComments, zplForExport } from "./zplLabelMeta";

describe("stripSidecarComments", () => {
  it("removes the label-meta line and its line break, leaving printer bytes intact", () => {
    const meta = formatLabelMetaComment({ dpmm: 8, widthMm: 100, heightMm: 60 });
    const zpl = ["^XA", meta, "^PW800", "^FO10,10^A0N,30,30^FDHello^FS", "^XZ"].join("\n");
    expect(stripSidecarComments(zpl)).toBe(["^XA", "^PW800", "^FO10,10^A0N,30,30^FDHello^FS", "^XZ"].join("\n"));
  });

  it("removes an inline QR sidecar ahead of its ^GFA field", () => {
    const sidecar = formatSidecarComment('{"qr":{"content":"A","mag":4}}');
    const zpl = `^XA\n${sidecar}^FO10,10^GFA,1,1,1,80^FS\n^XZ`;
    expect(stripSidecarComments(zpl)).toBe("^XA\n^FO10,10^GFA,1,1,1,80^FS\n^XZ");
  });

  it("keeps CRLF streams free of bare line feeds", () => {
    const meta = formatLabelMetaComment({ dpmm: 8, widthMm: 100, heightMm: 60 });
    const zpl = `^XA\r\n${meta}\r\n^PW800\r\n^XZ`;
    expect(stripSidecarComments(zpl)).toBe("^XA\r\n^PW800\r\n^XZ");
  });

  it("leaves foreign ^FX comments alone", () => {
    const zpl = "^XA\n^FXZPLLAB is a fine tool^FS\n^FXnote^FS\n^XZ";
    expect(stripSidecarComments(zpl)).toBe(zpl);
  });

  it("matches lowercase command letters, which the wire treats the same", () => {
    expect(stripSidecarComments('^XA\n^fxZPLLAB:{"dpmm":8}^fs\n^XZ')).toBe("^XA\n^XZ");
  });

  it("is a no-op on text without sidecars", () => {
    const zpl = "^XA^FO10,10^A0N,30,30^FDx^FS^XZ";
    expect(stripSidecarComments(zpl)).toBe(zpl);
  });
});

describe("zplForExport", () => {
  const zpl = `^XA\n${formatLabelMetaComment({ dpmm: 8, widthMm: 100, heightMm: 60 })}\n^XZ`;

  it("strips by default and keeps on request", () => {
    expect(zplForExport(zpl)).toBe("^XA\n^XZ");
    expect(zplForExport(zpl, true)).toBe(zpl);
  });
});

describe("sidecarRanges", () => {
  it("names exactly the bytes stripSidecarComments removes, inline sidecars included", () => {
    const sidecar = formatLabelMetaComment({ dpmm: 8, widthMm: 70, heightMm: 40 });
    const text = ["^XA", sidecar, "^FXnote^FS", `${formatSidecarComment('{"qr":1}')}^FO1,2^GFA,1,1,1,00^FS`, "^XZ"].join("\n");
    const ranges = sidecarRanges(text);
    let kept = "";
    let at = 0;
    for (const r of ranges) {
      kept += text.slice(at, r.start);
      at = r.end;
    }
    expect(kept + text.slice(at)).toBe(stripSidecarComments(text));
    expect(ranges).toHaveLength(2);
  });
});

describe("sidecar envelope v2", () => {
  it("writes the ZPLab prefix with mm keys and reads the 0.4.x spelling as well", () => {
    const meta = { dpmm: 8, widthMm: 100, heightMm: 60 };
    const line = formatLabelMetaComment(meta);
    expect(line).toBe('^FXZPLab:{"dpmm":8,"w":100,"h":60}^FS');
    expect(parseLabelMetaComment(line.slice(3, -3))).toEqual(meta);
    expect(parseLabelMetaComment('ZPLLAB:{"dpmm":8,"wMm":100,"hMm":60}')).toEqual(meta);
    expect(parseLabelMetaComment('ZPLLAB:{"dpmm":8,"w":100,"h":60}')).toEqual(meta);
    expect(parseLabelMetaComment('ZPLab:{"dpmm":8,"wMm":100,"hMm":60}')).toEqual(meta);
    expect(parseLabelMetaComment('ZPLab:{"dpmm":8,"w":"x","h":60}')).toBeNull();
    expect(parseLabelMetaComment('{"dpmm":8,"w":100,"h":60}')).toBeNull();
  });

  it("strips and ranges both envelopes", () => {
    const text = ["^XA", '^FXZPLab:{"dpmm":8,"w":70,"h":40}^FS', '^FXZPLLAB:{"qr":{"content":"A"}}^FS^FO1,1^GFA,1,1,1,00^FS', "^XZ"].join("\n");
    expect(stripSidecarComments(text)).toBe(["^XA", "^FO1,1^GFA,1,1,1,00^FS", "^XZ"].join("\n"));
    expect(sidecarRanges(text)).toHaveLength(2);
  });
});
