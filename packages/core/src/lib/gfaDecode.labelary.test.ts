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

// Rendered on Labelary (8dpmm, 2x1) and read back pixel by pixel, because the
// spec (p.1759) defines what a comma, a bang and a colon each do but not what
// they do after a line the data already filled exactly. The answer is that all
// three ALWAYS produce a row: a comma following a full row fills a fresh line
// with zeros, it is not a no-op. Anything that makes them conditional turns
// every comma-separated ^GFA into half its rows.
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
