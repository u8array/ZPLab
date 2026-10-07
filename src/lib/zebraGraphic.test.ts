import { describe, it, expect, vi } from "vitest";
import { zlibSync } from "fflate";
import { buildPrinterPreviewZpl, contentBounds, cropBitmap, decodeDyGraphic, monoToRgba, type PrinterBitmap } from "./zebraGraphic";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

// A 16x2 GRF: row0 = 0x80,0x01 (leftmost + rightmost bit set), row1 = 0xFF,0x00.
const MONO = new Uint8Array([0x80, 0x01, 0xff, 0x00]);
const BPR = 2;

const dyResponse = (mono: Uint8Array, kind: "Z" | "B", wrap = false): string => {
  const payload = kind === "Z" ? zlibSync(mono) : mono;
  let body = b64(payload);
  if (wrap) body = body.replace(/(.{4})/g, "$1\r\n"); // mimic printer line wrapping
  return `~DYPRE,A,G,${mono.length},${BPR},:${kind}64:${body}:5A3C\r\n`;
};

describe("buildPrinterPreviewZpl", () => {
  it("stores under a fresh name per render, uploads it with ^HY and deletes it with ^ID", () => {
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const out = buildPrinterPreviewZpl("^XA^FO10,10^A0N,30^FDHi^FS^XZ");
    expect(out).toContain("^ISR:ZL800000.GRF,N^XZ");
    expect(out).toContain("^HYR:ZL800000.GRF^XZ");
    expect(out.indexOf("^IS")).toBeLessThan(out.indexOf("^HY"));
    expect(out.indexOf("^HY")).toBeLessThan(out.indexOf("^IDR:ZL800000.GRF^FS^XZ"));
    expect(buildPrinterPreviewZpl("^XA^FDx^FS^XZ")).toContain("^ISR:ZL400000.GRF,N^XZ");
    random.mockRestore();
  });

  it("appends ^IS even when the design has no trailing ^XZ", () => {
    expect(buildPrinterPreviewZpl("^XA^FDx^FS")).toMatch(/\^ISR:ZL[0-9A-F]{6}\.GRF,N\^XZ/);
  });

  it("forces ^LL onto all media so the render matches the design length", () => {
    expect(buildPrinterPreviewZpl("^XA^PW400^LL600^FDx^FS^XZ")).toContain("^LL600,Y");
  });

  it("leaves an already-parameterised ^LL untouched", () => {
    const out = buildPrinterPreviewZpl("^XA^LL600,N^FDx^FS^XZ");
    expect(out).toContain("^LL600,N");
    expect(out).not.toContain("^LL600,Y");
  });

  it("leaves a design with no ^LL unchanged apart from the preview wrapper", () => {
    expect(buildPrinterPreviewZpl("^XA^FDx^FS^XZ")).not.toContain(",Y");
  });
});

describe("contentBounds", () => {
  const bitmap = (width: number, height: number): PrinterBitmap => ({
    width,
    height,
    mono: new Uint8Array((width / 8) * height),
  });

  it("returns zeros for an all-blank bitmap", () => {
    expect(contentBounds(bitmap(16, 4))).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("measures the full bounding box of the black pixels", () => {
    const bmp = bitmap(24, 5);
    bmp.mono[3] = 0b00100000; // row 1, byte 0, bit 5 -> col 2
    bmp.mono[2 * 3 + 1] = 0b00000100; // row 2, byte 1, bit 2 -> col 13
    expect(contentBounds(bmp)).toEqual({ left: 2, right: 14, top: 1, bottom: 3 });
  });

  it("locates centered content inside head-width padding", () => {
    const bmp = bitmap(32, 2);
    bmp.mono[1] = 0b11111111; // row 0: cols 8-15 black, bytes 0/2/3 blank
    expect(contentBounds(bmp)).toEqual({ left: 8, right: 16, top: 0, bottom: 1 });
  });

  it("finds both edges when they share a byte", () => {
    const bmp = bitmap(8, 1);
    bmp.mono[0] = 0b01000010; // cols 1 and 6
    expect(contentBounds(bmp)).toEqual({ left: 1, right: 7, top: 0, bottom: 1 });
  });

  it("measures top from the first non-blank row", () => {
    const bmp = bitmap(8, 4);
    bmp.mono[2] = 0b10000000; // row 2 only
    expect(contentBounds(bmp)).toEqual({ left: 0, right: 1, top: 2, bottom: 3 });
  });
});

describe("decodeDyGraphic", () => {
  it("decodes a Z64 (zlib) graphic upload round-trip", () => {
    const bmp = decodeDyGraphic(dyResponse(MONO, "Z"));
    expect(bmp).not.toBeNull();
    expect(bmp!.width).toBe(16);
    expect(bmp!.height).toBe(2);
    expect(Array.from(bmp!.mono)).toEqual(Array.from(MONO));
  });

  it("decodes a B64 (uncompressed) graphic upload", () => {
    const bmp = decodeDyGraphic(dyResponse(MONO, "B"));
    expect(Array.from(bmp!.mono)).toEqual(Array.from(MONO));
  });

  it("tolerates the printer's CRLF line-wrapping inside the base64 payload", () => {
    const bmp = decodeDyGraphic(dyResponse(MONO, "Z", true));
    expect(bmp).not.toBeNull();
    expect(Array.from(bmp!.mono)).toEqual(Array.from(MONO));
  });

  it("ignores trailing content after the ~DY (no CRC over-capture)", () => {
    // A status line the printer appends must not have its colon mistaken for
    // the CRC separator (regression: lastIndexOf would over-capture the payload).
    const bmp = decodeDyGraphic(dyResponse(MONO, "Z") + "\r\nHEAD TEMPERATURE: 25");
    expect(bmp).not.toBeNull();
    expect(Array.from(bmp!.mono)).toEqual(Array.from(MONO));
  });

  it("rejects a payload shorter than the declared byte count (truncated read)", () => {
    // Header claims 8 bytes (4 rows) but the payload only carries MONO (4).
    const resp = `~DYPRE,A,G,8,${BPR},:Z64:${b64(zlibSync(MONO))}:5A3C`;
    expect(decodeDyGraphic(resp)).toBeNull();
  });

  it("returns null when there is no ~DY graphic in the response", () => {
    expect(decodeDyGraphic("^XA^XZ")).toBeNull();
    expect(decodeDyGraphic("")).toBeNull();
  });
});

describe("monoToRgba", () => {
  it("maps set bits to black and clear bits to white", () => {
    const bmp: PrinterBitmap = { width: 16, height: 2, mono: MONO };
    const rgba = monoToRgba(bmp);
    // row0 pixel 0 (bit set) = black
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([0, 0, 0, 255]);
    // row0 pixel 1 (bit clear) = white
    expect([rgba[4], rgba[5], rgba[6], rgba[7]]).toEqual([255, 255, 255, 255]);
    // row0 pixel 15 (rightmost bit set) = black
    const p15 = 15 * 4;
    expect([rgba[p15], rgba[p15 + 1], rgba[p15 + 2]]).toEqual([0, 0, 0]);
  });
});

describe("cropBitmap", () => {
  it("widens the bounds to whole bytes and copies the rows between top and bottom", () => {
    const mono = Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00]);
    const bmp = { width: 24, height: 4, mono };
    expect(cropBitmap(bmp, { left: 7, right: 9, top: 2, bottom: 3 })).toEqual({ width: 16, height: 1, mono: Uint8Array.from([0x01, 0x80]) });
    expect(cropBitmap(bmp, contentBounds(bmp))).toEqual({ width: 16, height: 1, mono: Uint8Array.from([0x01, 0x80]) });
  });
});
