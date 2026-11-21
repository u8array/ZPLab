import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSgdDump } from "@zplab/core/lib/sgd";
import { ZD230_ALLCV_EXCERPT } from "@zplab/core/lib/sgd.fixture";
import { FIRST_BYTE_MS, REPLY_DEADLINE_MS, REPLY_IDLE_MS } from "./printerQuery";
import { readPrinterSettings } from "./printerSettings";
import type { ServerQueryResult } from "./serverPrint";

interface Opened {
  deadlineMs: number;
  signal: AbortSignal;
  text: (text: string) => void;
  end: (end: "closed" | "deadline" | "lost") => void;
}

let opened: Opened[] = [];
const queryZplServer = vi.hoisted(() => vi.fn());
vi.mock("./printReach", () => ({ printReach: { desktop: false, server: true } }));
vi.mock("./serverPrint", () => ({ queryZplServer }));

const target = { kind: "server", id: "dock" } as const;
// The ZD230 line endings and dump end, see SGD_ALL_SETTINGS_END.
const DUMP = `${ZD230_ALLCV_EXCERPT.replace(/\n/g, "\r\n")}""`;
const PAUSE_AT = DUMP.indexOf("zpl.label_length");

const open = async (): Promise<Opened> => {
  await vi.advanceTimersByTimeAsync(0);
  const last = opened.at(-1);
  if (!last) throw new Error("no query opened");
  return last;
};

beforeEach(() => {
  vi.useFakeTimers();
  opened = [];
  queryZplServer.mockReset();
  queryZplServer.mockImplementation(
    (_id: string, _zpl: string, deadlineMs: number, signal: AbortSignal, onText: (text: string) => void) =>
      new Promise<ServerQueryResult>((resolve) => {
        let chunks = 0;
        const text = (piece: string) => {
          chunks += 1;
          onText(piece);
        };
        opened.push({ deadlineMs, signal, text, end: (end) => resolve({ kind: "done", end, chunks }) });
        signal.addEventListener("abort", () => resolve({ kind: "done", end: "stopped", chunks }));
      }),
  );
});
afterEach(() => vi.useRealTimers());

describe("readPrinterSettings", () => {
  it("reads on through a pause longer than the idle gap", async () => {
    const read = readPrinterSettings(target);
    const query = await open();
    query.text(DUMP.slice(0, PAUSE_AT));
    await vi.advanceTimersByTimeAsync(REPLY_IDLE_MS + 200);
    expect(query.signal.aborted).toBe(false);
    query.text(DUMP.slice(PAUSE_AT));
    await vi.advanceTimersByTimeAsync(REPLY_IDLE_MS);
    expect(query.signal.aborted).toBe(true);
    expect(await read).toEqual({ kind: "ok", value: parseSgdDump(ZD230_ALLCV_EXCERPT) });
  });

  it("ends the read incomplete once the caller stops waiting", async () => {
    const waiting = new AbortController();
    const read = readPrinterSettings(target, waiting.signal);
    const query = await open();
    query.text(DUMP.slice(0, PAUSE_AT));
    waiting.abort();
    expect(query.signal.aborted).toBe(true);
    expect(await read).toEqual({ kind: "incomplete" });
  });

  it("calls a dump the printer closed ahead of its end incomplete", async () => {
    const read = readPrinterSettings(target);
    const query = await open();
    query.text(DUMP.slice(0, PAUSE_AT));
    query.end("closed");
    expect(await read).toEqual({ kind: "incomplete" });
  });

  it("calls a dump that outlasts the reply deadline timed out", async () => {
    const read = readPrinterSettings(target);
    const query = await open();
    query.text(DUMP.slice(0, PAUSE_AT));
    await vi.advanceTimersByTimeAsync(FIRST_BYTE_MS);
    expect(query.signal.aborted).toBe(false);
    query.end("deadline");
    expect(await read).toEqual({ kind: "timed_out" });
  });

  it("calls a dump the link dropped inside the dump lost", async () => {
    const read = readPrinterSettings(target);
    const query = await open();
    query.text(DUMP.slice(0, PAUSE_AT));
    query.end("lost");
    expect(await read).toEqual({ kind: "lost" });
  });

  it("ends the read of a mute printer at the first-byte limit", async () => {
    const read = readPrinterSettings(target);
    const query = await open();
    await vi.advanceTimersByTimeAsync(FIRST_BYTE_MS - 1);
    expect(query.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(query.signal.aborted).toBe(true);
    expect(await read).toEqual({ kind: "silent" });
  });

  it("gives a started dump the whole reply deadline", async () => {
    const read = readPrinterSettings(target);
    const query = await open();
    expect(query.deadlineMs).toBe(REPLY_DEADLINE_MS);
    query.text(DUMP.slice(0, PAUSE_AT));
    await vi.advanceTimersByTimeAsync(FIRST_BYTE_MS + 1);
    expect(query.signal.aborted).toBe(false);
    query.text(DUMP.slice(PAUSE_AT));
    await vi.advanceTimersByTimeAsync(REPLY_IDLE_MS);
    expect(await read).toEqual({ kind: "ok", value: parseSgdDump(ZD230_ALLCV_EXCERPT) });
  });

  it("calls a whole reply that lists no setting unparsed", async () => {
    const read = readPrinterSettings(target);
    const query = await open();
    query.text('"?"\r\n""');
    await vi.advanceTimersByTimeAsync(REPLY_IDLE_MS);
    expect(await read).toEqual({ kind: "unparsed" });
  });
});
