import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STX, ETX } from "@zplab/core/lib/hostStatus.fixture";
import { REPLY_DEADLINE_MS, REPLY_IDLE_MS, queryPrinter } from "./printerQuery";
import type { ServerQueryResult } from "./serverPrint";

interface Opened {
  id: string;
  zpl: string;
  deadlineMs: number;
  signal: AbortSignal;
  text: (text: string) => void;
}

let opened: Opened[] = [];
const queryZplServer = vi.hoisted(() => vi.fn());
vi.mock("./printReach", () => ({ printReach: { desktop: false, server: true } }));
vi.mock("./serverPrint", () => ({ queryZplServer }));

const target = { kind: "server", id: "dock" } as const;
const HS = `${STX}030,0,0,0892,000,0,0,0,000,0,0,0${ETX}\r\n`;

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
  // The reader ends as the server client does, naming the chunks it sent once the request is stopped.
  queryZplServer.mockImplementation(
    (id: string, zpl: string, deadlineMs: number, signal: AbortSignal, onText: (text: string) => void) =>
      new Promise<ServerQueryResult>((resolve) => {
        let chunks = 0;
        const text = (piece: string) => {
          chunks += 1;
          onText(piece);
        };
        opened.push({ id, zpl, deadlineMs, signal, text });
        signal.addEventListener("abort", () => resolve({ kind: "done", end: "stopped", chunks }));
      }),
  );
});
afterEach(() => vi.useRealTimers());

describe("queryPrinter over the server", () => {
  it("ends the read at the idle gap behind the reply, by stopping the request", async () => {
    const read = queryPrinter(target, "~HS");
    const query = await open();
    expect(query).toMatchObject({ id: "dock", zpl: "~HS", deadlineMs: REPLY_DEADLINE_MS });
    query.text(HS);
    await vi.advanceTimersByTimeAsync(REPLY_IDLE_MS - 1);
    expect(query.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(query.signal.aborted).toBe(true);
    expect(await read).toEqual({ kind: "ok", value: HS });
  });

  it("passes on what the server could not do", async () => {
    for (const failure of [{ kind: "unauthorized" }, { kind: "server_unreachable" }, { kind: "unconfigured" }, { kind: "refused" }] as const) {
      queryZplServer.mockResolvedValueOnce(failure);
      expect(await queryPrinter(target, "~HS")).toEqual(failure);
    }
  });
});
