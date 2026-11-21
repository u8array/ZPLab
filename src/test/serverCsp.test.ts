import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createApp } from "../../packages/server/src/app";
import { withDesigner } from "../../packages/server/src/designer";

describe("the content security policy of the server", () => {
  it("leaves the page without an inline script that script-src 'self' would block", () => {
    expect(readFileSync("index.html", "utf8")).not.toMatch(/<script(?![^>]*\ssrc=)/);
  });

  it("matches the desktop policy except for an open connect-src", async () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as { app: { security: { csp: string } } };
    const desktop = conf.app.security.csp.replace(/connect-src [^;]*/, "connect-src 'self' http: https:");
    const page = await withDesigner(createApp({ token: "t", version: "test", printers: new Map() }), ".").request("/");
    expect(page.headers.get("content-security-policy")).toBe(desktop);
  });
});
