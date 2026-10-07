import { describe, it, expect } from "vitest";
import { deleteKnowledge, hostListing, listingHolds, originState, storedObjectOrigins } from "./storedObjectOrigins";
import type { HostDirectory } from "./hostDirectory";

const object = (device: string, name: string, ext: string, size = 100) => ({ device, name, ext, size });
const dir = (device: string, objects: HostDirectory["objects"], bytesFree?: number): HostDirectory => ({ device, objects, bytesFree });
const bytes = (paths: string[]) => paths.map((path) => ({ path, hasBytes: true }));

describe("hostListing", () => {
  it("folds one drive answering twice into one block and lists an aliased file once", () => {
    const listing = hostListing([
      dir("R", [object("R", "LOGO", "GRF")], 100),
      dir("R", [object("R", "LOGO", "GRF")], 100),
      dir("A", [object("E", "ARIAL", "TTF")], 200),
      dir("E", [object("E", "ARIAL", "TTF")], 200),
    ]);
    expect(listing.objects).toHaveLength(2);
  });

  it("reads neither absence nor free space off a drive whose block names another drive's files", () => {
    const listing = hostListing([dir("A", [object("E", "ARIAL", "TTF")], 200), dir("E", [object("E", "ARIAL", "TTF")], 200)]);
    expect(listing.devices).toEqual(["E"]);
    expect(listing.free).toEqual([{ device: "E", bytesFree: 200 }]);
    expect(storedObjectOrigins({ kind: "font", setupPaths: ["A:ARIAL.TTF"], local: [], listing }).map((r) => [r.key, r.host])).toEqual([
      ["A:ARIAL.TTF", "unknown"],
      ["E:ARIAL.TTF", "present"],
    ]);
  });

  it("still answers for a drive that holds nothing at all", () => {
    const listing = hostListing([dir("R", [], 100)]);
    expect(listing.devices).toEqual(["R"]);
    expect(storedObjectOrigins({ kind: "graphic", setupPaths: ["R:A.GRF"], local: [], listing }).map((r) => r.host)).toEqual(["absent"]);
  });

  it("puts firmware objects behind the ones an upload could have written and names no room on their drive", () => {
    const listing = hostListing([dir("Z", [object("Z", "TT0003M_", "FNT")], 0), dir("E", [object("E", "ARIAL", "TTF")], 200)]);
    expect(listing.objects.map((o) => o.device)).toEqual(["E", "Z"]);
    expect(listing.free).toEqual([{ device: "E", bytesFree: 200 }]);
  });
});

describe("listingHolds", () => {
  it("answers for a path spelled another way than the listing spells it", () => {
    const listing = hostListing([dir("E", [object("E", "ARIAL", "TTF")])]);
    expect(listingHolds(listing, "e:arial.ttf")).toBe(true);
    expect(listingHolds(listing, "R:ARIAL.TTF")).toBe(false);
  });
});

describe("storedObjectOrigins", () => {
  it("folds the three sources into one row per file, local rows first", () => {
    const listing = hostListing([dir("E", [object("E", "ARIAL", "TTF"), object("E", "CG_TIMES", "TTF")]), dir("R", [])]);
    const rows = storedObjectOrigins({ kind: "font", setupPaths: ["E:ARIAL.TTF", "R:GONE.TTF"], local: bytes(["E:ARIAL.TTF", "E:LOCAL.TTF"]), listing });
    expect(rows.map((r) => [r.key, r.inSetup, r.hasCopy, r.host])).toEqual([
      ["E:ARIAL.TTF", true, true, "present"],
      ["E:LOCAL.TTF", false, true, "absent"],
      ["R:GONE.TTF", true, false, "absent"],
      ["E:CG_TIMES.TTF", false, false, "present"],
    ]);
  });

  it("keeps the spelling of the source that named the file and carries the listed object", () => {
    const listing = hostListing([dir("E", [object("E", "ARIAL", "TTF", 4096)])]);
    const [row] = storedObjectOrigins({ kind: "font", setupPaths: [], local: bytes(["e:arial.ttf"]), listing });
    expect(row?.path).toBe("e:arial.ttf");
    expect(row?.hostObject?.size).toBe(4096);
  });

  it("claims absence only for a drive that answered", () => {
    const listing = hostListing([dir("R", [])]);
    const rows = storedObjectOrigins({ kind: "graphic", setupPaths: ["R:A.GRF", "E:B.GRF"], local: [], listing });
    expect(rows.map((r) => r.host)).toEqual(["absent", "unknown"]);
    expect(storedObjectOrigins({ kind: "graphic", setupPaths: ["R:A.GRF"], local: [], listing: undefined }).map((r) => r.host)).toEqual(["unknown"]);
  });

  it("takes only the listed objects of its own kind", () => {
    const listing = hostListing([dir("R", [object("R", "LOGO", "GRF"), object("R", "LBL", "ZPL"), object("R", "SOME", "FNT")])]);
    expect(storedObjectOrigins({ kind: "graphic", setupPaths: [], local: [], listing }).map((r) => r.key)).toEqual(["R:LOGO.GRF"]);
    expect(storedObjectOrigins({ kind: "font", setupPaths: [], local: [], listing }).map((r) => r.key)).toEqual(["R:SOME.FNT"]);
  });
});

describe("originState", () => {
  const row = (inSetup: boolean, hasCopy: boolean, host: "present" | "absent" | "unknown") => ({ key: "R:X.GRF", path: "R:X.GRF", inSetup, hasCopy, host });

  it("says nothing about the printer before a listing", () => {
    expect(originState(row(true, true, "unknown"))).toBe("unread");
  });

  it("separates a setup entry that never arrived from a local file nothing provisions", () => {
    expect(originState(row(true, true, "absent"))).toBe("missingOnPrinter");
    expect(originState(row(false, true, "absent"))).toBe("notOnPrinter");
  });

  it("marks a listed file as the printer's own whenever nothing here can supply it", () => {
    expect(originState(row(false, false, "present"))).toBe("printerOnly");
    expect(originState(row(true, false, "present"))).toBe("printerOnly");
    expect(originState(row(false, true, "present"))).toBe("onPrinter");
    expect(originState(row(true, true, "present"))).toBe("onPrinter");
  });
});

describe("deleteKnowledge", () => {
  const row = (inSetup: boolean, hasCopy: boolean) => ({ key: "R:X.GRF", path: "R:X.GRF", inSetup, hasCopy, host: "present" as const });

  it("names the copy a delete leaves behind, and promises no re-upload without the file", () => {
    expect(deleteKnowledge(row(true, true))).toBe("setupReuploads");
    expect(deleteKnowledge(row(true, false))).toBe("noCopy");
    expect(deleteKnowledge(row(false, true))).toBe("localCopy");
    expect(deleteKnowledge(row(false, false))).toBe("noCopy");
  });
});
