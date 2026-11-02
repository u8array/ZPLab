import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STX, ETX } from "@zplab/core/lib/hostStatus.fixture";
import { answered, queryPrinter, readPrinterReply } from "./printerQuery";

vi.mock("./platform", () => ({ isDesktopShell: true }));

let channels = 0;

/** The real Channel registers with the Tauri runtime, so a plain holder stands in for it. */
class FakeChannel<T> {
  id = (channels += 1);
  onmessage: (response: T) => void;
  constructor(onmessage: (response: T) => void) {
    this.onmessage = onmessage;
  }
}

interface Opened {
  cmd: string;
  args: Record<string, unknown>;
  chunk: (text: string) => void;
  end: (result: unknown) => void;
  fail: (reason: unknown) => void;
}

let opened: Opened[] = [];
const stops: unknown[] = [];
/** False where a test ends the stream itself, as a link that fails while the stop is on its way does. */
let endsOnStop = true;
const invoke = vi.fn((cmd: string, args: Record<string, unknown>) => {
  if (cmd === "query_stop") {
    stops.push(args.channel);
    const stream = opened.find((o) => (o.args.onChunk as FakeChannel<string>).id === args.channel);
    // The reader ends as the Rust side does, naming the chunks it sent.
    if (endsOnStop) stream?.end({ kind: "done", end: "stopped", chunks: stream.args.sent });
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const channel = args.onChunk as FakeChannel<string>;
    const record: Opened = {
      cmd,
      args: { ...args, sent: 0 },
      chunk: (text) => {
        record.args.sent = (record.args.sent as number) + 1;
        channel.onmessage(text);
      },
      end: resolve,
      fail: reject,
    };
    opened.push(record);
  });
});
vi.mock("@tauri-apps/api/core", () => ({ Channel: FakeChannel, invoke: (cmd: string, args: Record<string, unknown>) => invoke(cmd, args) }));

const target = { kind: "network", host: "172.17.17.175", port: 9100 } as const;
const HS = "\u0002030,0,0,0892,000,0,0,0,000,0,0,0\u0003\r\n";

const open = async (): Promise<Opened> => {
  await vi.advanceTimersByTimeAsync(0);
  const last = opened.at(-1);
  if (!last) throw new Error("no query opened");
  return last;
};

beforeEach(() => {
  endsOnStop = true;
  vi.useFakeTimers();
  invoke.mockClear();
  opened = [];
  stops.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("queryPrinter over the network", () => {
  it("ends the read at the idle gap behind the reply, by stopping the stream", async () => {
    const read = queryPrinter(target, "~HS");
    const query = await open();
    expect(query.cmd).toBe("query_zpl_tcp");
    expect(query.args).toMatchObject({ host: "172.17.17.175", port: 9100, zpl: "~HS", deadlineMs: 60_000 });
    query.chunk(HS);
    await vi.advanceTimersByTimeAsync(1199);
    expect(stops).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(stops).toEqual([(query.args.onChunk as FakeChannel<string>).id]);
    expect(await read).toEqual({ kind: "ok", value: HS });
  });

  it("joins the chunks of a reply that comes in bursts, each burst resetting the gap", async () => {
    const read = queryPrinter(target, "^XA^HWR:*.*^XZ");
    const query = await open();
    query.chunk("\u0002\r\n- DIR R:*.*");
    await vi.advanceTimersByTimeAsync(1000);
    query.chunk("\r\n* R:PRE.GRF 49924\r\n\u0003");
    await vi.advanceTimersByTimeAsync(1000);
    expect(stops).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(await read).toEqual({ kind: "ok", value: "\u0002\r\n- DIR R:*.*\r\n* R:PRE.GRF 49924\r\n\u0003" });
  });

  it("waits for the chunks that land after the command returned", async () => {
    const read = queryPrinter(target, "^XA^HYR:PRE.GRF^XZ");
    const query = await open();
    query.chunk("~DYPRE,A,G,");
    query.end({ kind: "done", end: "closed", chunks: 3 });
    await vi.advanceTimersByTimeAsync(100);
    query.chunk("4,2,");
    await vi.advanceTimersByTimeAsync(100);
    query.chunk(":B64:gAE=:AAAA");
    expect(await read).toEqual({ kind: "ok", value: "~DYPRE,A,G,4,2,:B64:gAE=:AAAA" });
  });

  it("reports a reply whose chunk never lands as incomplete", async () => {
    const cut = queryPrinter(target, "^XA^HYR:PRE.GRF^XZ");
    const late = await open();
    late.chunk("~DYPRE");
    late.end({ kind: "done", end: "closed", chunks: 2 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await cut).toEqual({ kind: "incomplete" });
  });

  it("reports a deadline that cut the reply as a timeout", async () => {
    const cut = queryPrinter(target, "~HI");
    const query = await open();
    query.chunk("ZD230");
    query.end({ kind: "done", end: "deadline", chunks: 1 });
    expect(await cut).toEqual({ kind: "timed_out" });
  });

  it("stops waiting for a first byte past the first-byte limit and calls that silence, like a stream that closes without one", async () => {
    const quiet = queryPrinter(target, "~HU");
    await open();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(stops).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(stops).toHaveLength(1);
    expect(await quiet).toEqual({ kind: "silent" });
    const closed = queryPrinter(target, "~HU");
    (await open()).end({ kind: "done", end: "closed", chunks: 0 });
    expect(await closed).toEqual({ kind: "silent" });
  });

  it("forwards a refusal, an unreachable host, a rejected invoke and a throwing runtime as values", async () => {
    const refused = queryPrinter(target, "~HI");
    (await open()).end({ kind: "refused" });
    expect(await refused).toEqual({ kind: "refused", port: 9100 });
    const gone = queryPrinter(target, "~HI");
    (await open()).end({ kind: "unreachable" });
    expect(await gone).toEqual({ kind: "unreachable" });
    const failed = queryPrinter(target, "~HI");
    (await open()).fail("no response from printer");
    expect(await failed).toEqual({ kind: "error", message: "no response from printer" });
    invoke.mockImplementationOnce(() => {
      throw new Error("no runtime");
    });
    expect(await queryPrinter(target, "~HI")).toEqual({ kind: "error", message: "no runtime" });
  });

  it("opens a USB query with the same stream and the device, under the caller's deadline", async () => {
    const read = queryPrinter({ kind: "usb", id: "0a5f:0166:X1" }, "~HI", 90_000);
    const query = await open();
    expect(query.cmd).toBe("query_zpl_usb");
    expect(query.args).toMatchObject({ device: "0a5f:0166:X1", zpl: "~HI", deadlineMs: 90_000 });
    query.chunk("ZD230");
    await vi.advanceTimersByTimeAsync(1200);
    expect(await read).toEqual({ kind: "ok", value: "ZD230" });
  });

  it("calls a link lost behind the reply lost, unless the reader had already stopped it", async () => {
    const lone = queryPrinter(target, "~HS");
    const plain = await open();
    plain.chunk("x");
    plain.end({ kind: "done", end: "lost", chunks: 1 });
    expect(await lone).toEqual({ kind: "lost" });

    endsOnStop = false;
    const whole = queryPrinter(target, "~HS");
    const query = await open();
    query.chunk("x");
    await vi.advanceTimersByTimeAsync(1200);
    expect(stops).toHaveLength(1);
    query.end({ kind: "done", end: "lost", chunks: 1 });
    expect(await whole).toEqual({ kind: "ok", value: "x" });
  });

  it("passes the USB query's own failures through unchanged", async () => {
    const usb = { kind: "usb", id: "0a5f:0166:X1" } as const;
    const missing = queryPrinter(usb, "~HI");
    (await open()).end({ kind: "not_found" });
    expect(await missing).toEqual({ kind: "not_found" });
    const denied = queryPrinter(usb, "~HI");
    (await open()).end({ kind: "permission_denied" });
    expect(await denied).toEqual({ kind: "permission_denied" });
    const failed = queryPrinter(usb, "~HI");
    (await open()).fail("No such device (os error 19)");
    expect(await failed).toEqual({ kind: "error", message: "No such device (os error 19)" });
  });
});

describe("answered", () => {
  it("keeps a reply's spaces, drops the line break around it, and calls a bare frame or whitespace silence", () => {
    expect(answered({ kind: "ok", value: " HEADER 1 \r\n" })).toEqual({ kind: "ok", value: " HEADER 1 " });
    expect(answered({ kind: "ok", value: "\u0002\u0003" })).toEqual({ kind: "silent" });
    expect(answered({ kind: "ok", value: "" })).toEqual({ kind: "silent" });
    expect(answered({ kind: "ok", value: "  " })).toEqual({ kind: "silent" });
  });
});

const HV_HEADER_END = (count: number) => ({ header: "HEADER ", terminator: "END", count, commands: ["^HV1,20,HEADER ,END,L"] });
const HV_H_E = { header: "H", terminator: "E", count: 1, commands: ["^HV1,20,H,E,F"] };
const HV_H_E_PLAIN = { header: "H", terminator: "E", count: 1, commands: ["^HV1,20,H,E"] };

describe("readPrinterReply", () => {
  it("waits past the first-byte limit while a reply is owed, and reads like a lone command where none is", async () => {
    const controller = new AbortController();
    const owed = readPrinterReply(target, "^XA^FN1^FDx^FS^HV1,20,H,E^XZ", { awaited: [HV_H_E_PLAIN], signal: controller.signal });
    await open();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(stops).toEqual([]);
    const lone = readPrinterReply(target, "^XA~HS^XZ");
    await open();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stops).toHaveLength(1);
    expect(await lone).toEqual({ kind: "silent" });
    controller.abort();
    expect(await owed).toEqual({ kind: "ok", value: { body: "", unanswered: [{ commands: ["^HV1,20,H,E"], missing: 1, of: 1 }] } });
  });

  it("waits through the print for every ^HV reply the document earns, past any idle gap", async () => {
    const read = readPrinterReply(target, "^XA~HS^FN1^FD4711^FS^HV1,20,HEADER ,END,L^PQ2^XZ", { deadlineMs: 300_000, awaited: [HV_HEADER_END(2)] });
    const query = await open();
    expect(query.args).toMatchObject({ deadlineMs: 300_000 });
    query.chunk(HS);
    await vi.advanceTimersByTimeAsync(5000);
    expect(stops).toEqual([]);
    query.chunk("HEADER 4711 END");
    await vi.advanceTimersByTimeAsync(5000);
    expect(stops).toEqual([]);
    query.chunk("HEADER 47");
    query.chunk("12 END");
    await vi.advanceTimersByTimeAsync(1200);
    expect(stops).toHaveLength(1);
    expect(await read).toEqual({ kind: "ok", value: { body: `${HS}HEADER 4711 ENDHEADER 4712 END`, unanswered: [] } });
  });

  it("does not take a mark inside another command's frame for a reply", async () => {
    const read = readPrinterReply(target, "^XA^HH^FN1^FDx^FS^HV1,20,,E^XZ", { awaited: [{ header: "", terminator: "E", count: 1, commands: ["^HV1,20,,E"] }] });
    const query = await open();
    query.chunk(`${STX}DARKNESS E\r\nMODE E${ETX}`);
    await vi.advanceTimersByTimeAsync(1200);
    expect(stops).toEqual([]);
    query.chunk("xE");
    await vi.advanceTimersByTimeAsync(1200);
    expect(stops).toHaveLength(1);
    const res = await read;
    expect(res).toMatchObject({ kind: "ok", value: { unanswered: [] } });
  });

  it("ends on the signal with what came, naming the replies still owed, and honours a signal aborted up front", async () => {
    const controller = new AbortController();
    const read = readPrinterReply(target, "^XA~HS^FN1^FDx^FS^HV1,20,H,E,F^XZ", { signal: controller.signal, awaited: [HV_H_E] });
    const query = await open();
    query.chunk(HS);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(stops).toEqual([]);
    controller.abort();
    expect(await read).toEqual({ kind: "ok", value: { body: HS, unanswered: [{ commands: ["^HV1,20,H,E,F"], missing: 1, of: 1 }] } });

    const early = readPrinterReply(target, "^XA^FN1^FDx^FS^HV1,20,H,E,F^XZ", { signal: AbortSignal.abort(), awaited: [HV_H_E] });
    await open();
    expect(stops).toHaveLength(2);
    expect(await early).toEqual({ kind: "ok", value: { body: "", unanswered: [{ commands: ["^HV1,20,H,E,F"], missing: 1, of: 1 }] } });
  });

  it("keeps what a deadline ended while a reply was owed, whole or not, and calls it a timeout for a lone command", async () => {
    const owed = readPrinterReply(target, "^XA^FN1^FDx^FS^HV1,20,H,E^XZ", { awaited: [HV_H_E_PLAIN] });
    const query = await open();
    query.chunk("x");
    query.end({ kind: "done", end: "deadline", chunks: 1 });
    expect(await owed).toEqual({ kind: "ok", value: { body: "x", unanswered: [{ commands: ["^HV1,20,H,E"], missing: 1, of: 1 }] } });
    expect(stops).toEqual([]);

    const whole = readPrinterReply(target, "^XA^FN1^FDx^FS^HV1,20,H,E^XZ", { awaited: [HV_H_E_PLAIN] });
    const late = await open();
    late.chunk("H x E");
    await vi.advanceTimersByTimeAsync(500);
    late.end({ kind: "done", end: "deadline", chunks: 1 });
    expect(await whole).toEqual({ kind: "ok", value: { body: "H x E", unanswered: [] } });

    const lone = readPrinterReply(target, "^XA~HS^XZ");
    const plain = await open();
    plain.chunk("x");
    plain.end({ kind: "done", end: "deadline", chunks: 1 });
    expect(await lone).toEqual({ kind: "timed_out" });
  });

  it("keeps what came when the link drops behind it, naming the replies still owed", async () => {
    const owed = readPrinterReply(target, "^XA^FN1^FDx^FS^HV1,20,H,E^PQ2^XZ", { awaited: [{ ...HV_H_E_PLAIN, count: 2 }] });
    const query = await open();
    query.chunk("H x E");
    query.end({ kind: "done", end: "lost", chunks: 1 });
    expect(await owed).toEqual({ kind: "ok", value: { body: "H x E", unanswered: [{ commands: ["^HV1,20,H,E"], missing: 1, of: 2 }] } });
  });

  it("waits for the chunks a stop left in flight, so the stopped read shows the whole reply", async () => {
    const controller = new AbortController();
    const read = readPrinterReply(target, "^XA~HS^FN1^FDx^FS^HV1,20,H,E^XZ", { signal: controller.signal, awaited: [HV_H_E_PLAIN] });
    const query = await open();
    query.chunk(HS);
    endsOnStop = false;
    controller.abort();
    query.end({ kind: "done", end: "stopped", chunks: 2 });
    await vi.advanceTimersByTimeAsync(10);
    query.chunk("H x E");
    expect(await read).toEqual({ kind: "ok", value: { body: `${HS}H x E`, unanswered: [] } });

    const lost = readPrinterReply(target, "^XA~HS^FN1^FDx^FS^HV1,20,H,E^XZ", { signal: AbortSignal.abort(), awaited: [HV_H_E_PLAIN] });
    const gone = await open();
    gone.chunk(HS);
    gone.end({ kind: "done", end: "stopped", chunks: 2 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await lost).toEqual({ kind: "incomplete" });
  });

  it("lets the signal end the wait for a late chunk with what came", async () => {
    const controller = new AbortController();
    const read = readPrinterReply(target, "^XA~HS^XZ", { signal: controller.signal });
    const query = await open();
    query.chunk(HS);
    query.end({ kind: "done", end: "closed", chunks: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    expect(await read).toEqual({ kind: "ok", value: { body: HS, unanswered: [] } });
  });
});
