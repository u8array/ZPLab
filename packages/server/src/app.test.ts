import { describe, it, expect } from "vitest";
import type { Socket } from "node:net";
import { demoLabel, designFile } from "@zplab/headless/testing";
import { createApp } from "./app.js";
import type { Printer } from "./printers.js";
import { deadPrinter, received, stubPrinter } from "./printerStub.js";

const TOKEN = "test-token";
const app = createApp({ token: TOKEN, version: "test", printers: new Map() });

type Body = Record<string, unknown>;

const send = (to: ReturnType<typeof createApp>, path: string, body: unknown, token: string | null = TOKEN) =>
  to.request(`/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function post(path: string, body: unknown, token: string | null = TOKEN): Promise<{ status: number; json: Body }> {
  const res = await send(app, path, body, token);
  return { status: res.status, json: (await res.json()) as Body };
}

async function get(path: string, token: string | null = TOKEN): Promise<{ status: number; json: Body }> {
  const res = await app.request(`/api/v1${path}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });
  return { status: res.status, json: (await res.json()) as Body };
}

describe("public routes", () => {
  it("answers health without a token", async () => {
    const r = await get("/health", null);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, version: "test" });
  });

  it("publishes every design route with a request body in the OpenAPI document", async () => {
    const r = await get("/openapi.json", null);
    expect(r.status).toBe(200);
    expect(r.json.openapi).toBe("3.1.0");
    const paths = r.json.paths as Record<string, Record<string, { requestBody?: unknown; security?: unknown }>>;
    for (const path of ["/api/v1/draft", "/api/v1/validate", "/api/v1/patch", "/api/v1/export", "/api/v1/import", "/api/v1/validate-zpl"]) {
      expect(paths[path]?.post?.requestBody, path).toBeDefined();
      expect(paths[path]?.post?.security, path).toEqual([{ bearerAuth: [] }]);
    }
    expect(paths["/api/v1/schema"]?.get).toBeDefined();
    expect((r.json.components as { securitySchemes: unknown }).securitySchemes).toEqual({ bearerAuth: { type: "http", scheme: "bearer" } });
    expect((r.json.info as { version: string }).version).toBe("test");
  });

  it("documents every key a route answers with", async () => {
    const r = await get("/openapi.json", null);
    interface Op { responses: Record<string, { content: Record<string, { schema: { properties?: Record<string, unknown>; items?: { properties: Record<string, unknown> } } }> }> }
    const ok = (path: string, method: string) => (r.json.paths as Record<string, Record<string, Op>>)[path]![method]!.responses["200"]!.content["application/json"]!.schema;
    expect(Object.keys(ok("/api/v1/import", "post").properties ?? {}).sort()).toEqual(["batch", "bounds", "designFile", "findings", "geometryTruncated", "label", "notes", "ok", "overlaps", "warnings"]);
    expect(Object.keys(ok("/api/v1/validate-zpl", "post").properties ?? {}).sort()).toEqual(["batch", "bounds", "findings", "geometryTruncated", "label", "notes", "objectCount", "ok", "overlaps", "pageCount", "warnings"]);
    const types = ok("/api/v1/schema", "get").properties!.types as { items: { properties: Record<string, unknown> } };
    expect(Object.keys(types.items.properties).sort()).toEqual(["defaultProps", "domains", "label", "props", "type"]);
    const findings = ok("/api/v1/validate-zpl", "post").properties!.findings as { properties?: Record<string, unknown> };
    const answered = await post("/validate-zpl", { zpl: "^XA^FO10,10^A0N,30,30^FDx^FS^XZ" });
    expect(Object.keys(findings.properties ?? {}).sort()).toEqual(Object.keys(answered.json.findings as Body).sort());
  });

  it("documents every field of a warning, a bound and an overlap", async () => {
    const doc = await get("/openapi.json", null);
    const schemas = (doc.json.components as { schemas: Record<string, { properties: Record<string, unknown> }> }).schemas;
    const answered = await post("/validate-zpl", { zpl: "^XA^FO10,10^A0N,30,30^FDone^FS^FO10,10^A0N,30,30^FDtwo^FS^FO10,60^BEN,80,Y,N^FD40123451234567^FS^XZ" });
    for (const [name, key] of [["PreflightWarning", "warnings"], ["ObjectBounds", "bounds"], ["ObjectOverlap", "overlaps"]] as const) {
      const answeredKeys = new Set((answered.json[key] as Body[]).flatMap((row) => Object.keys(row)));
      expect(Object.keys(schemas[name]?.properties ?? {}).sort(), name).toEqual([...answeredKeys].sort());
    }
  });

  it("documents the warning kind as an enum of the answered kinds", async () => {
    const doc = await get("/openapi.json", null);
    const schemas = (doc.json.components as { schemas: Record<string, { properties: Record<string, { enum?: string[] }> }> }).schemas;
    const answered = await post("/validate-zpl", { zpl: "^XA^FO10,10^A0N,30,30^FDone^FS^FO10,60^BEN,80,Y,N^FD40123451234567^FS^XZ" });
    const kinds = (answered.json.warnings as { kind: string }[]).map((w) => w.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(schemas.PreflightWarning?.properties.kind?.enum).toEqual(expect.arrayContaining(kinds));
  });

  it("documents the design file and the label as required in every answer that carries them", async () => {
    const doc = await get("/openapi.json", null);
    interface Op { post: { responses: Record<string, { content: Record<string, { schema: { required: string[] } }> }> } }
    const always = { draft: ["designFile"], patch: ["designFile"], import: ["designFile", "label"], "validate-zpl": ["label"] };
    for (const [route, keys] of Object.entries(always)) {
      const { required } = (doc.json.paths as Record<string, Op>)[`/api/v1/${route}`]!.post.responses["200"]!.content["application/json"]!.schema;
      expect(required, route).toEqual(expect.arrayContaining(keys));
    }
  });

  it("documents every setting a label answer carries", async () => {
    const doc = await get("/openapi.json", null);
    const schemas = (doc.json.components as { schemas: Record<string, { properties: Record<string, unknown> }> }).schemas;
    const answered = await post("/validate-zpl", { zpl: "~SD20^XA^PW400^LL200^PR4,6,3^MMT^MD10^FO10,10^A0N,30,30^FDone^FS^XZ" });
    const label = answered.json.label as Body;
    expect(label).toHaveProperty("printSpeed");
    expect(Object.keys(schemas.LabelConfig?.properties ?? {})).toEqual(expect.arrayContaining(Object.keys(label)));
  });

  it("documents the server fault on every gated route", async () => {
    const doc = await get("/openapi.json", null);
    const paths = doc.json.paths as Record<string, Record<string, { security?: unknown; responses: Record<string, unknown> }>>;
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (op.security) expect(op.responses["500"], `${method} ${path}`).toBeDefined();
      }
    }
  });
  it("documents every dpmm value and the format path pattern", async () => {
    const r = await get("/openapi.json", null);
    interface Op { post: { requestBody: { content: Record<string, { schema: { properties: Record<string, unknown> } }> } } }
    const draft = (r.json.paths as Record<string, Op>)["/api/v1/draft"];
    const props = draft!.post.requestBody.content["application/json"]!.schema.properties;
    expect(props.dpmm).toEqual({ type: "number", enum: [6, 8, 12, 24] });
    const { pattern } = props.storedFormatPath as { pattern: string };
    expect(new RegExp(pattern).test("e:label1.zpl")).toBe(true);
    expect(new RegExp(pattern).test("x:label1.zpl")).toBe(false);
    expect((r.json.components as { schemas: Record<string, unknown> }).schemas.ToolError).toBeDefined();
  });
});

describe("the bearer gate", () => {
  it("refuses to build an app without a token", () => {
    expect(() => createApp({ token: "", version: "test", printers: new Map() })).toThrow();
  });

  it("gates exactly the routes the document marks with security", async () => {
    const doc = await get("/openapi.json", null);
    const paths = doc.json.paths as Record<string, Record<string, { security?: unknown }>>;
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const res = await app.request(path, { method: method.toUpperCase(), headers: { "content-type": "application/json" }, body: method === "post" ? "{}" : undefined });
        expect(res.status, `${method} ${path}`).toBe(op.security ? 401 : 200);
        if (op.security) expect(await res.json()).toEqual({ ok: false, errors: ["missing or invalid bearer token"] });
      }
    }
  });

  it("refuses before it reads a body", async () => {
    const r = await post("/validate-zpl", { zpl: "x".repeat(16 * 1024 * 1024) }, null);
    expect(r.status).toBe(401);
  });

  it("refuses a wrong token and a wrong scheme", async () => {
    expect((await post("/validate", { designFile }, "other")).status).toBe(401);
    const basic = await app.request("/api/v1/schema", { headers: { authorization: `Basic ${TOKEN}` } });
    expect(basic.status).toBe(401);
    expect(basic.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("accepts the scheme in any case", async () => {
    const res = await app.request("/api/v1/schema", { headers: { authorization: `bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
  });
});

describe("design routes", () => {
  it("builds, validates, patches and exports a draft", async () => {
    const draft = await post("/draft", {
      widthMm: 100,
      heightMm: 50,
      dpmm: 8,
      objects: [{ type: "text", x: 20, y: 20, props: { content: "Hello", fontHeight: 30 } }],
    });
    expect(draft.status).toBe(200);
    expect(draft.json.ok).toBe(true);
    const file = draft.json.designFile;

    const validated = await post("/validate", { designFile: file });
    expect(validated.status).toBe(200);
    expect(Array.isArray(validated.json.bounds)).toBe(true);

    const patched = await post("/patch", {
      designFile: file,
      operations: [{ op: "add", object: { type: "text", x: 20, y: 100, props: { content: "World" } } }],
    });
    expect(patched.status).toBe(200);

    const exported = await post("/export", { designFile: patched.json.designFile });
    expect(exported.status).toBe(200);
    expect(exported.json.zpl).toContain("^FDWorld^FS");
  });

  it("round-trips raw ZPL through import and export", async () => {
    const imported = await post("/import", { zpl: "^XA^FO10,10^A0N,30,30^FDold^FS^XZ", dpmm: 8 });
    expect(imported.status).toBe(200);
    const exported = await post("/export", { designFile: imported.json.designFile });
    expect(exported.json.zpl).toContain("^FDold^FS");
  });

  it("validates raw ZPL without returning a design file", async () => {
    const r = await post("/validate-zpl", { zpl: "^XA^FO10,10^A0N,30,30^FDx^FS^XZ" });
    expect(r.status).toBe(200);
    expect(r.json.objectCount).toBe(1);
    expect(r.json).not.toHaveProperty("designFile");
  });

  it("lists the object types", async () => {
    const r = await get("/schema");
    expect(r.status).toBe(200);
    expect((r.json.types as { type: string }[]).some((t) => t.type === "qrcode")).toBe(true);
  });

  it("exports a multi-page design with variables", async () => {
    const r = await post("/export", { designFile: demoLabel });
    expect(r.status).toBe(200);
    expect(r.json.zpl).toContain("^FN");
  });
});

describe("rejections keep the ToolError shape", () => {
  it("names an unknown field and the route's expected field", async () => {
    const r = await post("/validate", { designFile, schemaVersion: 3 });
    expect(r.status).toBe(400);
    expect(r.json.ok).toBe(false);
    expect((r.json.errors as string[])[0]).toContain('unknown field "schemaVersion"');
    expect((r.json.errors as string[])[0]).toContain("This route takes designFile.");
  });

  it("names every allowed dpmm value", async () => {
    const r = await post("/import", { zpl: "^XA^XZ", dpmm: 7 });
    expect(r.status).toBe(400);
    expect((r.json.errors as string[])[0]).toBe("dpmm: Invalid option: expected one of 6|8|12|24");
  });

  it("reports a schema issue with its path", async () => {
    const r = await post("/import", { zpl: 42 });
    expect(r.status).toBe(400);
    expect((r.json.errors as string[])[0]).toMatch(/^zpl: /);
  });

  it("refuses an unknown object type on draft", async () => {
    const r = await post("/draft", { widthMm: 100, heightMm: 50, dpmm: 8, objects: [{ type: "hologram", x: 1, y: 1, props: {} }] });
    expect(r.status).toBe(400);
    expect((r.json.errors as string[])[0]).toContain("hologram");
  });

  it("refuses a patch for an id the design does not have", async () => {
    const r = await post("/patch", { designFile, operations: [{ op: "remove", id: "ghost" }] });
    expect(r.status).toBe(400);
    expect((r.json.errors as string[])[0]).toContain("ghost");
  });

  it("refuses an export of a design file that is not JSON", async () => {
    const r = await post("/export", { designFile: "{not json" });
    expect(r.status).toBe(400);
    expect(r.json.ok).toBe(false);
  });

  it("passes a headless refusal through as 400", async () => {
    const r = await post("/validate-zpl", { zpl: "^XA^FO1,1^FDopen^FS" });
    expect(r.status).toBe(400);
    expect((r.json.errors as string[])[0]).toMatch(/do not balance/);
  });

  it("refuses a body that is not JSON", async () => {
    const r = await post("/validate", "{not json");
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ ok: false, errors: ["Malformed JSON in request body"] });
  });

  it("refuses a text/plain body with 415", async () => {
    const res = await app.request("/api/v1/validate", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" }, body: "^XA^XZ" });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ ok: false, errors: ["Unsupported Media Type"] });
  });

  it("answers an unknown route in the same shape", async () => {
    const r = await get("/nope");
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ ok: false, errors: ["no such route"] });
  });

  it("caps the body", async () => {
    const r = await post("/validate-zpl", { zpl: "x".repeat(16 * 1024 * 1024) });
    expect(r.status).toBe(413);
    expect(r.json).toEqual({ ok: false, errors: ["body exceeds 16 MiB"] });
  });
});

describe("printer routes", () => {
  const appFor = (...printers: Printer[]) => createApp({ token: TOKEN, version: "test", printers: new Map(printers.map((p) => [p.id, p])) });
  const appWithStub = async (serve: (socket: Socket) => void) => appFor(await stubPrinter(serve));
  const lines = async (res: Response) => (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Body);

  it("lists each printer by id and name without its address", async () => {
    const res = await appFor({ id: "dock", name: "Dock 3", host: "10.0.0.5", port: 9100 }).request("/api/v1/printers", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ printers: [{ id: "dock", name: "Dock 3" }] });
  });

  it("answers an id it does not know with 404 on both routes", async () => {
    for (const [path, body] of [["/printers/nope/send", { zpl: "^XA^XZ" }], ["/printers/nope/query", { zpl: "~HS", deadlineMs: 1000 }]] as const) {
      const res = await send(app, path, body);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ ok: false, errors: ["no such printer"] });
    }
  });

  it("sends the ZPL to the printer", async () => {
    let got: Promise<string> | undefined;
    const to = await appWithStub((socket) => {
      got = received(socket);
    });
    const res = await send(to, "/printers/stub/send", { zpl: "^XA^FDx^FS^XZ" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "sent" });
    expect(await got).toBe("^XA^FDx^FS^XZ");
  });

  it("reports a printer that refuses the connection on both routes", async () => {
    const to = appFor(await deadPrinter());
    expect(await (await send(to, "/printers/stub/send", { zpl: "^XA^XZ" })).json()).toEqual({ kind: "refused" });
    const res = await send(to, "/printers/stub/query", { zpl: "~HS", deadlineMs: 1000 });
    expect(res.status).toBe(200);
    expect(await lines(res)).toEqual([{ kind: "refused" }]);
  });

  it("streams the reply as JSON lines and ends with the read end", async () => {
    const to = await appWithStub((socket) => {
      socket.once("data", () => {
        socket.write("first ");
        setTimeout(() => socket.end("second"), 100);
      });
    });
    const res = await send(to, "/printers/stub/query", { zpl: "~HS", deadlineMs: 5000 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const got = await lines(res);
    expect(got.at(-1)).toEqual({ kind: "done", end: "closed" });
    expect(got.slice(0, -1).every((line) => line.kind === "text")).toBe(true);
    expect(got.map((line) => line.text ?? "").join("")).toBe("first second");
  });

  it("refuses a query without a deadline or with one outside 1 to 600000 ms", async () => {
    for (const body of [{ zpl: "~HS" }, { zpl: "~HS", deadlineMs: 600_001 }, { zpl: "~HS", deadlineMs: 0 }]) {
      const res = await send(app, "/printers/nope/query", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { errors: string[] }).errors[0], JSON.stringify(body)).toMatch(/^deadlineMs: /);
    }
  });

  it("drops the printer link when the request is cancelled", async () => {
    const dropped = Promise.withResolvers<boolean>();
    const to = await appWithStub((socket) => {
      socket.on("close", dropped.resolve);
      socket.resume();
      socket.write("partial");
    });
    const res = await send(to, "/printers/stub/query", { zpl: "~HS", deadlineMs: 15_000 });
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(`${JSON.stringify({ kind: "text", text: "partial" })}\n`);
    await reader.cancel();
    await dropped.promise;
  });

  it("documents the reply lines and the unknown-printer answer", async () => {
    const doc = await get("/openapi.json", null);
    interface Op { post: { parameters: { name: string; in: string }[]; responses: Record<string, { content: Record<string, { schema: unknown }> }> } }
    const paths = doc.json.paths as Record<string, Op>;
    const query = paths["/api/v1/printers/{id}/query"]!.post;
    expect(query.parameters.map((p) => [p.name, p.in])).toEqual([["id", "path"]]);
    expect(query.responses["200"]!.content["application/x-ndjson"]!.schema).toEqual({ $ref: "#/components/schemas/PrinterReplyLine" });
    expect(paths["/api/v1/printers/{id}/send"]!.post.responses["200"]!.content["application/json"]!.schema).toEqual({ $ref: "#/components/schemas/PrinterSendResult" });
    for (const route of ["send", "query"]) expect(paths[`/api/v1/printers/{id}/${route}`]!.post.responses["404"], route).toBeDefined();
  });
});
