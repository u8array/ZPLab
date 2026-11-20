import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../packages/server/src/app";
import type { Printer } from "../../packages/server/src/printers";
import { deadPrinter, received, stubPrinter } from "../../packages/server/src/printerStub";
import { DOCUMENT_DEADLINE_MS } from "./printerDocumentQuery";
import { LAST_FOLD, SEND_FOLD, SERVER_ENDS, listServerPrinters, queryZplServer, saveServerToken, sendZplServer } from "./serverPrint";

vi.mock("./printReach", () => ({ serverApiBase: "/api/v1" }));

const TOKEN = "test-token";

/** Routes every request of the client into the app. */
function serve(...printers: Printer[]) {
  const app = createApp({ token: TOKEN, version: "test", printers: new Map(printers.map((p) => [p.id, p])) });
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => app.request(input, init));
  return app;
}

beforeEach(() => saveServerToken(TOKEN));
afterEach(() => vi.unstubAllGlobals());

describe("the client against the contract of the server", () => {
  interface KindSchema {
    properties: { kind: { enum: string[] }; end?: { enum: string[] } };
  }
  interface Doc {
    paths: Record<string, { post?: { requestBody: { content: Record<string, { schema: { properties: Record<string, { maximum?: number }> } }> } } }>;
    components: { schemas: { PrinterSendResult: KindSchema; PrinterReplyLine: { oneOf: KindSchema[] } } };
  }
  const contract = async (): Promise<Doc> => (await serve().request("/api/v1/openapi.json")).json() as Promise<Doc>;

  it("reads every answer the send route documents", async () => {
    const { PrinterSendResult } = (await contract()).components.schemas;
    expect(Object.keys(SEND_FOLD).sort()).toEqual([...PrinterSendResult.properties.kind.enum].sort());
  });

  it("reads every line the query route documents, and every end of a reply", async () => {
    const lines = (await contract()).components.schemas.PrinterReplyLine.oneOf;
    expect(["text", "done", ...Object.keys(LAST_FOLD)].sort()).toEqual(lines.flatMap((l) => l.properties.kind.enum).sort());
    const done = lines.find((l) => l.properties.kind.enum.includes("done"));
    expect([...SERVER_ENDS].sort()).toEqual([...(done?.properties.end?.enum ?? [])].sort());
  });

  it("asks within the deadline the query route takes", async () => {
    const query = (await contract()).paths["/api/v1/printers/{id}/query"]?.post;
    const maximum = query?.requestBody.content["application/json"]?.schema.properties.deadlineMs?.maximum;
    expect(maximum).toBeGreaterThanOrEqual(DOCUMENT_DEADLINE_MS);
  });
});

describe("the client against the running app", () => {
  const read = async (id: string) => {
    const texts: string[] = [];
    const result = await queryZplServer(id, "~HS", 5000, new AbortController().signal, (text) => texts.push(text));
    return { result, text: texts.join(""), pieces: texts.length };
  };

  it("is turned away without the token and lists the printers with it", async () => {
    serve(await stubPrinter(() => undefined));
    await saveServerToken("");
    expect(await listServerPrinters()).toEqual({ kind: "unauthorized" });
    await saveServerToken(TOKEN);
    expect(await listServerPrinters()).toEqual({ kind: "ok", printers: [{ id: "stub", name: "Stub" }] });
  });

  it("sends to a listed printer and names one that is not listed or not listening", async () => {
    let sent: Promise<string> | undefined;
    serve(await stubPrinter((socket) => (sent = received(socket))), { ...(await deadPrinter()), id: "dead" });
    expect(await sendZplServer("stub", "^XA^XZ")).toEqual({ kind: "sent" });
    expect(await sent).toBe("^XA^XZ");
    expect(await sendZplServer("dead", "^XA^XZ")).toEqual({ kind: "refused" });
    expect(await sendZplServer("gone", "^XA^XZ")).toEqual({ kind: "unconfigured" });
  });

  it("streams the reply of a listed printer and names one that is not listed or not listening", async () => {
    const answering = await stubPrinter((socket) =>
      socket.once("data", () => {
        socket.write("first ");
        setTimeout(() => socket.end("second"), 100);
      }),
    );
    serve(answering, { ...(await deadPrinter()), id: "dead" });
    const answered = await read("stub");
    expect(answered.text).toBe("first second");
    expect(answered.result).toEqual({ kind: "done", end: "closed", chunks: answered.pieces });
    expect((await read("dead")).result).toEqual({ kind: "refused" });
    expect((await read("gone")).result).toEqual({ kind: "unconfigured" });
  });
});
