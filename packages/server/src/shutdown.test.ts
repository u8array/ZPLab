import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { describe, it, expect, onTestFinished } from "vitest";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { stubPrinter } from "./printerStub.js";
import { shutdown } from "./shutdown.js";

const TOKEN = "test-token";
const line = (reply: object) => `${JSON.stringify(reply)}\n`;

/** A listening server with one query under way, read to its first line. */
async function withRunningQuery(play: (socket: Socket) => void) {
  const printer = await stubPrinter((socket) => {
    socket.resume();
    socket.write("partial");
    play(socket);
  });
  const app = createApp({ token: TOKEN, version: "test", printers: new Map([[printer.id, printer]]) });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }) as Server;
  onTestFinished(() => void server.closeAllConnections());
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/printers/${printer.id}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ zpl: "~HS", deadlineMs: 600_000 }),
  });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  expect((await reader.read()).value).toBe(line({ kind: "text", text: "partial" }));
  return { server, reader };
}

describe("shutdown", () => {
  it("drops a running printer query after the grace period", async () => {
    const dropped = Promise.withResolvers<boolean>();
    const { server, reader } = await withRunningQuery((socket) => socket.on("close", dropped.resolve));

    await shutdown(server, 50);
    await dropped.promise;
    await expect(reader.read()).rejects.toThrow();
  });

  it("leaves a running query to its own end inside the grace period", async () => {
    const reply = Promise.withResolvers<Socket>();
    const { server, reader } = await withRunningQuery(reply.resolve);

    void shutdown(server, 60_000);
    (await reply.promise).end();
    expect((await reader.read()).value).toBe(line({ kind: "done", end: "closed" }));
    expect((await reader.read()).done).toBe(true);
  });
});
