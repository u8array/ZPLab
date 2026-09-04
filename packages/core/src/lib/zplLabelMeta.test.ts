import { describe, it, expect } from "vitest";
import { formatLabelMetaComment, formatSidecarComment, stripSidecarComments, zplForExport } from "./zplLabelMeta";

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
