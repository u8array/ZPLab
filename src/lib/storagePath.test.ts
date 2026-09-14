import { describe, it, expect } from "vitest";
import { parseStoragePath, formatStoragePath, recallCandidates, storagePathMatcher, uploadedGraphicPath } from "@zplab/core/lib/storagePath";

describe("storagePath", () => {
  it("parses device:name without extension", () => {
    expect(parseStoragePath("R:LOGO")).toEqual({ device: "R", name: "LOGO" });
  });

  it("parses device:name.ext and drops the implicit .GRF", () => {
    expect(parseStoragePath("R:LOGO.GRF")).toEqual({ device: "R", name: "LOGO" });
    expect(parseStoragePath("R:LOGO.grf")).toEqual({ device: "R", name: "LOGO" });
  });

  it("keeps any other extension so the reference survives re-export", () => {
    expect(parseStoragePath("R:LOGO.PNG")).toEqual({ device: "R", name: "LOGO", ext: "PNG" });
    expect(formatStoragePath({ device: "R", name: "LOGO", ext: "PNG" }, true)).toBe("R:LOGO.PNG");
    expect(formatStoragePath({ device: "R", name: "LOGO", ext: "PNG" }, false)).toBe("R:LOGO");
  });

  it("leaves the device out when the path names none, or takes the caller's default", () => {
    expect(parseStoragePath("LOGO.GRF")).toEqual({ name: "LOGO" });
    expect(parseStoragePath(":LOGO.GRF")).toEqual({ name: "LOGO" });
    expect(parseStoragePath("LOGO.GRF", "R")).toEqual({ device: "R", name: "LOGO" });
    expect(formatStoragePath({ name: "LOGO" }, true)).toBe("LOGO.GRF");
    expect(formatStoragePath({ name: "LOGO" }, false)).toBe("LOGO");
  });

  it("searches R:, E:, B:, A: for a device-less recall and persists uploads in R:", () => {
    expect(recallCandidates({ name: "LOGO" })).toEqual(["R:LOGO.GRF", "E:LOGO.GRF", "B:LOGO.GRF", "A:LOGO.GRF"]);
    expect(recallCandidates({ device: "E", name: "LOGO", ext: "PNG" })).toEqual(["E:LOGO.PNG"]);
    expect(uploadedGraphicPath({ name: "LOGO" })).toBe("R:LOGO.GRF");
  });

  it("returns null for paths with empty stem", () => {
    expect(parseStoragePath("R:")).toBeNull();
    expect(parseStoragePath("R:.GRF")).toBeNull();
  });

  it("formats with and without the .GRF extension", () => {
    const path = { device: "E", name: "LABEL" };
    expect(formatStoragePath(path, true)).toBe("E:LABEL.GRF");
    expect(formatStoragePath(path, false)).toBe("E:LABEL");
  });

  it("matches ^ID patterns with the asterisk wildcard, ignoring case", () => {
    const grf = storagePathMatcher("R:*.GRF");
    expect(grf("R:LOGO.GRF")).toBe(true);
    expect(grf("R:LOGO.PNG")).toBe(false);
    expect(grf("E:LOGO.GRF")).toBe(false);
    expect(storagePathMatcher("R:LOGO.*")("R:LOGO.PNG")).toBe(true);
    expect(storagePathMatcher("r:logo.grf")("R:LOGO.GRF")).toBe(true);
    expect(storagePathMatcher("R:LOGO.GRF")("R:LOGO2.GRF")).toBe(false);
  });

  it("takes a question mark and regex characters literally", () => {
    expect(storagePathMatcher("R:LOG?.GRF")("R:LOGO.GRF")).toBe(false);
    expect(storagePathMatcher("R:LOG?.GRF")("R:LOG?.GRF")).toBe(true);
    expect(storagePathMatcher("R:A+B(1).GRF")("R:AB(1).GRF")).toBe(false);
  });

  it("reads an empty device as R:", () => {
    expect(storagePathMatcher(":LOGO.GRF")("R:LOGO.GRF")).toBe(true);
    expect(storagePathMatcher("R:*.*")(":LOGO.GRF")).toBe(true);
  });

  it("defaults a device-less pattern to R: and a bare name to .GRF", () => {
    expect(storagePathMatcher("LOGO.GRF")("R:LOGO.GRF")).toBe(true);
    expect(storagePathMatcher("*.GRF")("E:LOGO.GRF")).toBe(false);
    expect(storagePathMatcher("R:LOGO")("R:LOGO.GRF")).toBe(true);
    expect(storagePathMatcher("R:*")("R:FNT.TTF")).toBe(false);
    expect(storagePathMatcher("R:*.*")("R:FNT.TTF")).toBe(true);
  });

  it("round-trips parse → format(true) for a path with extension", () => {
    const original = "R:LOGO.GRF";
    const parsed = parseStoragePath(original);
    expect(parsed).not.toBeNull();
    if (parsed) expect(formatStoragePath(parsed, true)).toBe(original);
  });
});
