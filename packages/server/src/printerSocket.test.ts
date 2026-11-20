import { describe, it, expect } from "vitest";
import type { Socket } from "node:net";
import type { Printer } from "./printers.js";
import { queryPrinter, sendToPrinter } from "./printerSocket.js";
import { deadPrinter, received, stubPrinter } from "./printerStub.js";

async function ask(printer: Printer, { zpl = "~HS", deadlineMs = 5000, stop = new AbortController().signal } = {}) {
  const texts: string[] = [];
  const last = await queryPrinter(printer, zpl, deadlineMs, stop, (text) => texts.push(text));
  return { texts, last };
}

const query = async (serve: (socket: Socket) => void, deadlineMs?: number) => ask(await stubPrinter(serve), { deadlineMs });

describe("sendToPrinter", () => {
  it("delivers every byte and closes", async () => {
    let got: Promise<string> | undefined;
    const printer = await stubPrinter((socket) => {
      got = received(socket);
    });
    const zpl = "^XA^CI28^FO10,10^FDGrüße 日本^FS^XZ";
    expect(await sendToPrinter(printer, zpl)).toEqual({ kind: "sent" });
    expect(await got).toBe(zpl);
  });

  it("reports a port nothing listens on as refused", async () => {
    expect(await sendToPrinter(await deadPrinter(), "^XA^XZ")).toEqual({ kind: "refused" });
  });
});

describe("queryPrinter", () => {
  it("sends the query and ends closed when the printer closes", async () => {
    let got = "";
    const r = await query((socket) => {
      socket.once("data", (chunk: Buffer) => {
        got = chunk.toString();
        socket.end("\x02030,0,0\x03");
      });
    });
    expect(got).toBe("~HS");
    expect(r.texts.join("")).toBe("\x02030,0,0\x03");
    expect(r.last).toEqual({ kind: "done", end: "closed" });
  });

  it("keeps reading an answer that comes in parts", async () => {
    const r = await query((socket) => {
      socket.write("first ");
      setTimeout(() => socket.end("second"), 150);
    });
    expect(r.texts.join("")).toBe("first second");
    expect(r.last).toEqual({ kind: "done", end: "closed" });
  });

  it("ends at the deadline with what came while the printer keeps the link open", async () => {
    const r = await query((socket) => socket.write("partial"), 500);
    expect(r.texts).toEqual(["partial"]);
    expect(r.last).toEqual({ kind: "done", end: "deadline" });
  });

  it("ends closed and empty when the printer closes without a reply", async () => {
    const r = await query((socket) => socket.end());
    expect(r.texts).toEqual([]);
    expect(r.last).toEqual({ kind: "done", end: "closed" });
  });

  it("ends closed when the printer closes while the query is still being written", async () => {
    const printer = await stubPrinter((socket) => {
      socket.resume();
      socket.end();
    });
    const r = await ask(printer, { zpl: "x".repeat(12 * 1024 * 1024) });
    expect(r.last).toEqual({ kind: "done", end: "closed" });
  });

  it("ends lost when the link resets", async () => {
    const r = await query((socket) => {
      socket.once("data", () => socket.resetAndDestroy());
    });
    expect(r.last).toEqual({ kind: "done", end: "lost" });
  });

  it("reports a port nothing listens on as refused", async () => {
    const r = await ask(await deadPrinter());
    expect(r.last).toEqual({ kind: "refused" });
    expect(r.texts).toEqual([]);
  });

  it("joins a UTF-8 character that two reads split", async () => {
    const bytes = Buffer.from("Grüße");
    const r = await query((socket) => {
      socket.write(bytes.subarray(0, 3));
      setTimeout(() => socket.end(bytes.subarray(3)), 100);
    });
    expect(r.texts.join("")).toBe("Grüße");
    expect(r.texts.join("")).not.toContain("\uFFFD");
  });

  it("replaces a cut-off character at the end", async () => {
    const r = await query((socket) => socket.end(Buffer.from("Grüße").subarray(0, 3)));
    expect(r.texts.join("")).toBe("Gr\uFFFD");
  });

  it("gives up on a reply over 8 MiB", async () => {
    const r = await query((socket) => {
      const mib = Buffer.alloc(1024 * 1024, "x");
      for (let i = 0; i < 9; i++) socket.write(mib);
    });
    expect(r.last).toEqual({ kind: "too_large" });
    expect(r.texts.join("").length).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it("stops without a last line and drops the link when the caller aborts", async () => {
    const stop = new AbortController();
    const dropped = Promise.withResolvers<boolean>();
    const printer = await stubPrinter((socket) => {
      socket.on("close", dropped.resolve);
      socket.resume();
      socket.write("partial");
    });
    const texts: string[] = [];
    const last = await queryPrinter(printer, "~HS", 5000, stop.signal, (text) => {
      texts.push(text);
      stop.abort();
    });
    expect(last).toBe("stopped");
    expect(texts).toEqual(["partial"]);
    await dropped.promise;
  });

  it("stops when the caller aborted before the read began", async () => {
    const stop = new AbortController();
    stop.abort();
    const r = await ask(await stubPrinter((socket) => socket.resume()), { stop: stop.signal });
    expect(r.last).toBe("stopped");
  });
});
