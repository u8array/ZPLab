import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** Regression #399: a feature commit reverted the #396 CSP token and v0.4.0
 *  shipped without it. Pins the invariant from outside the fix's file set. */
describe("desktop CSP", () => {
  it("allows data: fonts (WKWebView enforces font-src on FontFace loads)", () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    for (const key of ["csp", "devCsp"]) {
      const csp: string = conf.app.security[key];
      const fontSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("font-src"));
      expect(fontSrc, `${key} font-src`).toContain("data:");
    }
  });
});
