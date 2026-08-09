import { describe, it, expect } from "vitest";
import { rasterFromGfa } from "./gfaDecode";

/** Row-major ink rows as '#'/'.' strings, the shape the Labelary raster was
 *  read in (see the vectors below). */
const rows = (gfa: string, width: number): string[] => {
  const r = rasterFromGfa(gfa);
  if (!r) return [];
  const out: string[] = [];
  for (let y = 0; y < r.heightDots; y++) {
    let s = "";
    for (let x = 0; x < width; x++) {
      const byte = r.bytes[y * r.bytesPerRow + (x >> 3)] ?? 0;
      s += (byte & (0x80 >> (x & 7))) !== 0 ? "#" : ".";
    }
    out.push(s);
  }
  return out;
};

// Labelary-verified: comma/bang/colon always emit a row, even right after one the data already filled.
describe("^GFA fill semantics, against the Labelary raster", () => {
  it("puts a blank row after a comma that follows a full row", () => {
    expect(rows("^GFA,16,16,2,FFFF,8001,!!!!!!", 16)).toEqual([
      "################",
      "................",
      "#..............#",
      "................",
      "################",
      "################",
      "################",
      "################",
    ]);
  });

  it("pads a partial row on a comma and opens a new one on a bang", () => {
    expect(rows("^GFA,16,16,2,FF,!,,,,,,", 16)).toEqual([
      "########........",
      "################",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
    ]);
  });

  it("repeats the previous row on a colon, blank included", () => {
    expect(rows("^GFA,16,16,2,FFFF,:,8001,!!!!", 16)).toEqual([
      "################",
      "................",
      "................",
      "................",
      "#..............#",
      "................",
      "################",
      "################",
    ]);
  });
});
