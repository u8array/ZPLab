import { describe, it, expect } from "vitest";
import { rasterFromGfa } from "./gfaDecode";
import { GF_MAX_DECODED_BYTES, gfPayloadToBytes } from "./zplParser/decoders/gfa";
import { gfaFromRaster, type MonoRaster } from "./imageToZpl";

const raster = (bytes: number[], bytesPerRow: number): MonoRaster => ({
  bytes: new Uint8Array(bytes),
  bytesPerRow,
  paddedWidth: bytesPerRow * 8,
  widthDots: bytesPerRow * 8,
  heightDots: bytes.length / bytesPerRow,
});

const hex = (r: { bytes: Uint8Array }) =>
  [...r.bytes].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");

describe("rasterFromGfa", () => {
  it("round-trips our own encoder", () => {
    const source = raster([0xff, 0x00, 0x81, 0x18, 0x3c, 0x7e], 2);
    const back = rasterFromGfa(gfaFromRaster(source));
    expect(back?.bytes).toEqual(source.bytes);
    expect(back?.heightDots).toBe(3);
    expect(back?.bytesPerRow).toBe(2);
  });

  it("expands the repeat counts from the spec's own examples", () => {
    // p.1759: M6 is seven hex 6s, hB is 40 hex Bs, and counts combine (vMB).
    expect(hex(rasterFromGfa("^GFA,4,4,4,M60")!)).toBe("66666660");
    expect(hex(rasterFromGfa("^GFA,20,20,20,hB")!)).toBe("B".repeat(40));
    expect(rasterFromGfa("^GFA,164,164,164,vMB")!.bytes.slice(0, 163).every((b) => b === 0xbb)).toBe(true);
  });

  it("counts g as twenty, not forty", () => {
    // hB is 40 per the spec, so g must be 20; an off-by-one-step table doubles
    // the ink and only hides behind a row that truncates it.
    expect(hex(rasterFromGfa("^GFA,30,30,30,gF")!)).toBe("F".repeat(20) + "0".repeat(40));
  });

  it("carries a run across the row boundary instead of truncating it", () => {
    // Header says 4 bytes over 2 per row: two rows, the second one half-filled.
    expect(hex(rasterFromGfa("^GFA,4,4,2,MF")!)).toBe("FFFFFFF0");
  });

  it("decodes a wrapped payload as base64, never as hex", () => {
    // Every raw-binary import stores its cache as ^GFA,…,:B64:…. Read as hex
    // the same string yields plausible noise, so assert the actual bytes:
    // "AP//AA==" is 00 FF FF 00.
    expect(hex(rasterFromGfa("^GFA,4,4,2,:B64:AP//AA==:1234")!)).toBe("00FFFF00");
  });

  it("fills a line with zeros on a comma and with ones on a bang", () => {
    expect(hex(rasterFromGfa("^GFA,4,4,2,FF,!")!)).toBe("FF00FFFF");
  });

  it("repeats the previous line on a colon", () => {
    expect(hex(rasterFromGfa("^GFA,4,4,2,A1B2:")!)).toBe("A1B2A1B2");
  });

  it("reads a leading colon as an empty previous line", () => {
    // A bare leading colon has no row to repeat and is invalid input (p.1601
    // reserves it as the lead-in for :B64:/:Z64:), so it yields a blank row.
    // c=4 over 2 bytes per row declares the two rows this payload produces.
    expect(hex(rasterFromGfa("^GFA,4,4,2,:C3D4")!)).toBe("0000C3D4");
  });

  it("pads a short final row instead of dropping it", () => {
    expect(hex(rasterFromGfa("^GFA,4,4,2,FFFFAB")!)).toBe("FFFFAB00");
  });

  it("refuses a header it cannot use", () => {
    expect(rasterFromGfa("^GFB,8,8,1,binary")).toBeNull();
    expect(rasterFromGfa("^GFA,8,8,0,FF")).toBeNull();
    expect(rasterFromGfa("not a graphic")).toBeNull();
  });

  it("keeps the visible width inside the byte-padded one", () => {
    const r = rasterFromGfa("^GFA,2,2,2,FFFF", 12);
    expect(r?.paddedWidth).toBe(16);
    expect(r?.widthDots).toBe(12);
  });
});

describe("a header without its format letter", () => {
  it("is refused, like the parser and the emitter refuse it", () => {
    // Spec p.215 defaults `a` to A, but nothing else in this codebase accepts
    // the short form, and a preview must not show what the print drops.
    expect(rasterFromGfa("^GF,4,4,2,FF00FF00")).toBeNull();
    expect(rasterFromGfa("^GFA,4,4,2,FF00FF00")).not.toBeNull();
  });
});

describe("a hostile RLE payload", () => {
  // 100k input chars declare ~32M output nibbles; before the decode cap this
  // expanded quadratically (seconds of CPU, hundreds of MB) inside the render.
  it("is refused rather than expanded past the decode budget", () => {
    // Refused, not truncated: handing back the rows that fit would store a
    // silently cropped graphic and re-export it at the crop height.
    const payload = "zzzzF".repeat(20_000);
    expect(rasterFromGfa(`^GFA,4,4,1,${payload}`)).toBeNull();
    expect(gfPayloadToBytes(payload, "A", 1, Number.NaN)).toBeNull();
  });

  it("still decodes a payload that fits the budget", () => {
    const decoded = gfPayloadToBytes("zzzzF", "A", 1, Number.NaN);
    expect(decoded!.data.length).toBeLessThanOrEqual(GF_MAX_DECODED_BYTES);
  });
});

describe("the header count, not the stream", () => {
  it("keeps the rows the header declares when the payload runs long", () => {
    // Spec p.215: c is the size of the image, not necessarily of the data.
    expect(rasterFromGfa("^GFA,2,2,2,C3D4FFFF")?.heightDots).toBe(1);
  });

  it("refuses a header without the count, which prints nothing", () => {
    // Labelary: omitting b renders identically, omitting c produces no label
    // at all, because the firmware never learns where the graphic ends.
    expect(rasterFromGfa("^GFA,,,2,C3D4FFFF")).toBeNull();
    expect(rasterFromGfa("^GFA,,4,2,C3D4FFFF")?.heightDots).toBe(2);
  });

  it("refuses a fractional row count instead of flooring past what emit uses", () => {
    // 5 bytes over 2 per row = 2.5 rows: gfaHeaderDims returns null and emit
    // falls back to props dims, so the canvas must not draw a floored 2 rows.
    expect(rasterFromGfa("^GFA,5,5,2,C3D4FF")).toBeNull();
  });
});

describe("a :Z64: zip bomb", () => {
  it("declines to inflate past the decode budget instead of OOMing", async () => {
    const { zlibSync } = await import("fflate");
    const packed = zlibSync(new Uint8Array(GF_MAX_DECODED_BYTES * 4));
    const b64 = Buffer.from(packed).toString("base64");
    expect(rasterFromGfa(`^GFA,4,4,2,:Z64:${b64}:0000`)).toBeNull();
  });
});

describe("a single unbounded repeat run", () => {
  // The row cap is only tested between steps, so one run's `repeat(count)` has
  // to clamp itself: 40k compress chars declare ~16M nibbles in ONE allocation.
  it("clamps the run to the decode budget instead of allocating it whole", () => {
    const payload = "z".repeat(40_000) + "F";
    expect(rasterFromGfa(`^GFA,4,4,1,${payload}`)).toBeNull();
    expect(gfPayloadToBytes(payload, "A", 1, Number.NaN)).toBeNull();
  });
});

describe("a binary header that declares only the format count", () => {
  it("decodes via the c fallback like the boundary reads it", () => {
    // b omitted, c=4 (spec p.215: b == c uncompressed). A bare parseInt("")
    // made the raw branch compare against NaN and refuse a graphic that prints.
    const bytes = "\x01\x02\x03\x04";
    expect(rasterFromGfa(`^GFB,,4,2,${bytes}`)).not.toBeNull();
  });
});

describe("a payload shorter than its declared count", () => {
  it("draws the declared height with blank rows, the size bounds and emit use", () => {
    // gfaHeaderDims reports 4 rows for this header; shrinking to the one row
    // that decoded made the canvas, the report and the print disagree.
    const r = rasterFromGfa("^GFA,8,8,2,FFFF");
    expect(r?.heightDots).toBe(4);
    expect(hex(r!)).toBe("FFFF000000000000");
  });
});

describe("comma and bang as fills", () => {
  // What they are FOR: letting a row omit its trailing bytes. The interaction
  // after an already-full row is pinned against the printer's own raster in
  // gfaDecode.labelary.test.ts, not asserted from the prose here.
  it("fills a short row with zeros", () => {
    expect(hex(rasterFromGfa("^GFA,4,4,2,FF,AB")!)).toBe("FF00AB00");
  });
});
