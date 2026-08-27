import { describe, it, expect } from "vitest";
import {
  formatQrSidecarComment,
  modulesToRaster,
  parseQrSidecarComment,
  qrModuleMatrix,
  qrRotatedGfa,
  rotateModules,
  type QrGraphicInput,
} from "@zplab/core/lib/qrGraphic";
import { ZD230_QA_123 } from "../test/qrFixtures";

const ascii = (m: boolean[][]) => m.map((r) => r.map((v) => (v ? "#" : ".")).join(""));

describe("qrModuleMatrix", () => {
  it("matches the ZD230 print module-for-module at EC Q", () => {
    const m = qrModuleMatrix("123", "Q");
    expect(m && ascii(m)).toEqual(ZD230_QA_123);
  });

  it("returns null for unencodable input instead of throwing", () => {
    // Over capacity: must yield null, not throw.
    expect(qrModuleMatrix("x".repeat(8000), "Q")).toBeNull();
  });
});

describe("rotateModules", () => {
  const m = [
    [true, false],
    [false, false],
  ];
  it("rotates a marker corner through R/I/B", () => {
    expect(rotateModules(m, "R")[0]).toEqual([false, true]);
    expect(rotateModules(m, "I")[1]).toEqual([false, true]);
    expect(rotateModules(m, "B")[1]).toEqual([true, false]);
    expect(rotateModules(m, "N")).toEqual(m);
  });

  it("four quarter turns are the identity", () => {
    const q = qrModuleMatrix("123", "Q")!;
    const four = rotateModules(rotateModules(rotateModules(rotateModules(q, "R"), "R"), "R"), "R");
    expect(four).toEqual(q);
  });
});

describe("modulesToRaster", () => {
  it("scales modules to magnification-sized blocks, MSB-first", () => {
    const raster = modulesToRaster([[true, false], [false, true]], 2);
    expect(raster.widthDots).toBe(4);
    expect(raster.heightDots).toBe(4);
    expect(raster.paddedWidth).toBe(8);
    // Rows 0-1: module (0,0) black = 1100_0000
    expect(raster.bytes[0]).toBe(0xc0);
    expect(raster.bytes[1]).toBe(0xc0);
    // Rows 2-3: module (1,1) black = 0011_0000
    expect(raster.bytes[2]).toBe(0x30);
    expect(raster.bytes[3]).toBe(0x30);
  });
});

describe("qrRotatedGfa", () => {
  const input: QrGraphicInput = {
    content: "123",
    magnification: 4,
    errorCorrection: "Q",
    model: 2,
    rotation: "R",
  };

  it("emits a ^GFA with the byte counts of the scaled matrix", () => {
    const g = qrRotatedGfa(input);
    expect(g).not.toBeNull();
    expect(g!.sizeDots).toBe(21 * 4);
    // 84 dots = 11 padded bytes/row, 84 rows.
    expect(g!.gfa.startsWith("^GFA,924,924,11,")).toBe(true);
  });

  it("R and N emit different bitmaps (the rotation is really baked)", () => {
    const r = qrRotatedGfa(input)!;
    const n = qrRotatedGfa({ ...input, rotation: "N" })!;
    expect(r.gfa).not.toBe(n.gfa);
  });
});

describe("qr sidecar comment", () => {
  const props: QrGraphicInput = {
    content: "A^B~C_https://x.de/?a=1",
    magnification: 6,
    errorCorrection: "M",
    model: 2,
    rotation: "B",
  };

  it("round-trips all props, with ^/~ escaped out of the ZPL stream", () => {
    const comment = formatQrSidecarComment(props);
    // ^FX prefix and closing ^FS are the only carets in the field.
    expect(comment.slice(3, -3)).not.toMatch(/[\^~]/);
    const body = comment.slice(3, -3);
    expect(parseQrSidecarComment(body)).toEqual(props);
  });

  it("round-trips the pinned byHeight, and omits it when absent", () => {
    const withBy = { ...props, byHeight: 50 };
    expect(parseQrSidecarComment(formatQrSidecarComment(withBy).slice(3, -3))).toEqual(withBy);
    // Absent stays absent: materialising 10 here would turn every legacy
    // sidecar lossy on the emit comparison.
    expect(parseQrSidecarComment(formatQrSidecarComment(props).slice(3, -3))).toEqual(props);
  });

  it("drops a byh no ^BY could have pinned, keeps any positive integer", () => {
    for (const byh of [1.5, 0, -3]) {
      const body = `ZPLLAB:{"qr":{"content":"X","mag":4,"ec":"Q","model":2,"rot":"R","byh":${byh}}}`;
      expect(parseQrSidecarComment(body)?.byHeight).toBeUndefined();
    }
    const big = 'ZPLLAB:{"qr":{"content":"X","mag":4,"ec":"Q","model":2,"rot":"R","byh":50000}}';
    expect(parseQrSidecarComment(big)?.byHeight).toBe(50000);
  });

  it("rejects foreign and label-meta comments", () => {
    expect(parseQrSidecarComment("just a note")).toBeNull();
    expect(parseQrSidecarComment('ZPLLAB:{"dpmm":8,"wMm":100,"hMm":50}')).toBeNull();
    expect(parseQrSidecarComment('ZPLLAB:{"qr":{"content":1}}')).toBeNull();
  });
});
