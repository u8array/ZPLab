import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createApp } from "./app.js";
import { withDesigner } from "./designer.js";
import { stubPrinter } from "./printerStub.js";

const TOKEN = "test-token";
const PAGE = `<!doctype html><title>designer</title>${"<p>page</p>".repeat(200)}`;
const SCRIPT = `console.log("asset");${"//".repeat(600)}`;
const IMMUTABLE = "public, max-age=31536000, immutable";
const SECRET = "not for the wire";

const base = mkdtempSync(join(tmpdir(), "zplab-designer-"));
const dir = join(base, "site");
mkdirSync(join(dir, "assets"), { recursive: true });
writeFileSync(join(dir, "index.html"), PAGE);
writeFileSync(join(dir, "assets", "index-abc123.js"), SCRIPT);
writeFileSync(join(dir, ".env"), SECRET);
writeFileSync(join(base, "secret.txt"), SECRET);
afterAll(() => rmSync(base, { recursive: true, force: true }));

const app = withDesigner(createApp({ token: TOKEN, version: "test", printers: new Map() }), dir);
const auth = { authorization: `Bearer ${TOKEN}` };

describe("the designer around the API", () => {
  it("answers the start page for the root and for every path that names no file", async () => {
    for (const path of ["/", "/index.html", "/some/deep/link"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control"), path).toBe("no-cache");
      expect(await res.text(), path).toBe(PAGE);
    }
  });

  it("answers a dotfile like a path that names no file", async () => {
    for (const path of ["/.env", "/%2eenv"]) {
      expect(await (await app.request(path)).text(), path).toBe(PAGE);
    }
  });

  it("serves no file from outside its directory", async () => {
    for (const path of ["/..%5csecret.txt", "/..%2fsecret.txt", "/%5c..%5csecret.txt", "/assets%5c..%5c..%5csecret.txt"]) {
      expect(await (await app.request(path)).text(), path).not.toContain(SECRET);
    }
  });

  it("lets a browser keep a hashed asset for good", async () => {
    const res = await app.request("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(await res.text()).toBe(SCRIPT);
  });

  it("answers a missing asset with 404 and not with the start page", async () => {
    const res = await app.request("/assets/index-gone.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBeNull();
    expect(await res.json()).toEqual({ ok: false, errors: ["no such route"] });
  });

  it("compresses the page and an asset for a client that takes gzip", async () => {
    for (const [path, body] of [["/", PAGE], ["/assets/index-abc123.js", SCRIPT]] as const) {
      const res = await app.request(path, { headers: { "accept-encoding": "gzip" } });
      expect(res.headers.get("content-encoding"), path).toBe("gzip");
      expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"), path).toBe(body);
    }
  });

  it("leaves the API paths to the API", async () => {
    expect(await (await app.request("/api/v1/health")).json()).toEqual({ ok: true, version: "test" });
    expect((await app.request("/api/v1/nope")).status).toBe(401);
    for (const path of ["/api/v1/nope", "/api/v2/health", "/api"]) {
      const res = await app.request(path, { headers: auth });
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ ok: false, errors: ["no such route"] });
    }
  });

  it("answers a POST outside the API with the JSON 404", async () => {
    const res = await app.request("/", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, errors: ["no such route"] });
  });

  it("answers a refused body with 400 and ok false", async () => {
    const res = await app.request("/api/v1/validate-zpl", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("streams a printer reply", async () => {
    const printer = await stubPrinter((socket) => {
      socket.once("data", () => socket.end("reply"));
    });
    const served = withDesigner(createApp({ token: TOKEN, version: "test", printers: new Map([[printer.id, printer]]) }), dir);
    const res = await served.request("/api/v1/printers/stub/query", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ zpl: "~HS", deadlineMs: 5000 }),
    });
    const lines = (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
    expect(lines).toEqual([{ kind: "text", text: "reply" }, { kind: "done", end: "closed" }]);
  });
});
