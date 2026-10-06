import { describe, it, expect } from "vitest";
import { hostObjectKind, hostObjectPath, parseHostDirectories, parseHostGraphic } from "./hostDirectory";
import { rasterFromGfa } from "./gfaDecode";

const STX = "\u0002";
const ETX = "\u0003";

// Measured on a ZD230, V89.21.46Z: four drives in one reply.
const LISTING =
  `${STX}\r\n- DIR R:*.* \r\n* R:LBL.ZPL       214          \r\n* R:PRE.GRF     49924          \r\n\r\n-   7467008 bytes free R: RAM \r\n${ETX}` +
  `${STX}\r\n- DIR E:*.* \r\n* E:ANGELINE_VINTAGE.TTF    632144          \r\n* E:CHK06.PNG      2203          \r\n\r\n-  47972352 bytes free E: ONBOARD FLASH \r\n${ETX}` +
  `${STX}\r\n- DIR B:*.* \r\n\r\n${ETX}${STX}\r\n- DIR A:*.* \r\n\r\n${ETX}`;

describe("parseHostDirectories", () => {
  it("reads one listing per drive with sizes and free bytes, and an empty drive as empty", () => {
    const dirs = parseHostDirectories(LISTING);
    expect(dirs.map((d) => [d.device, d.objects.length, d.bytesFree])).toEqual([
      ["R", 2, 7467008],
      ["E", 2, 47972352],
      ["B", 0, undefined],
      ["A", 0, undefined],
    ]);
    expect(dirs[0]?.objects[1]).toEqual({ device: "R", name: "PRE", ext: "GRF", size: 49924 });
    expect(dirs[1]?.objects.map(hostObjectPath)).toEqual(["E:ANGELINE_VINTAGE.TTF", "E:CHK06.PNG"]);
  });

  it("reads firmware objects with their flag columns and ignores lines before the first DIR head", () => {
    const dirs = parseHostDirectories(`noise\n- DIR Z:*.*\n* Z:A.FNT      6839  P    A  \n* Z:EAN-13.BAR         0  P       `);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]?.objects.map(hostObjectPath)).toEqual(["Z:A.FNT", "Z:EAN-13.BAR"]);
    expect(parseHostDirectories("")).toEqual([]);
  });

  it("reads the spec's dash-less head and skips a name outside the device's charset", () => {
    const dirs = parseHostDirectories(`${STX}\r\n DIR R: \r\n* R:logo.grf  12  \r\n* R:A^XZ~DGEVIL.GRF  12  \r\n -794292 bytes free \r\n${ETX}`);
    expect(dirs).toEqual([{ device: "R", objects: [{ device: "R", name: "LOGO", ext: "GRF", size: 12 }], bytesFree: 794292 }]);
  });
});

describe("hostObjectKind", () => {
  it("maps the object extensions onto graphic, font and format", () => {
    expect(["GRF", "PNG", "TTF", "FNT", "OTF", "TTE", "ZPL", "DAT", "BAR"].map(hostObjectKind)).toEqual([
      "graphic",
      "graphic",
      "font",
      "font",
      "font",
      "font",
      "format",
      "other",
      "other",
    ]);
  });
});

describe("parseHostGraphic", () => {
  it("turns the ~DG echo into a ^GFA the raster decoder reads, line breaks and all", () => {
    const graphic = parseHostGraphic("~DGPRE,8,2,\r\nFF\r\n,\r\n00FF\r\n,\r\n");
    expect(graphic).toEqual({ name: "PRE", gfa: "^GFA,8,8,2,FF,00FF," });
    const raster = rasterFromGfa(graphic?.gfa ?? "");
    expect(raster?.heightDots).toBe(4);
    expect(raster?.bytesPerRow).toBe(2);
    expect(Array.from(raster?.bytes ?? [])).toEqual([0xff, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00]);
  });

  it("refuses a reply without the ~DG head or with an empty raster", () => {
    expect(parseHostGraphic("")).toBeUndefined();
    expect(parseHostGraphic("~DGPRE,0,0,")).toBeUndefined();
  });
});
