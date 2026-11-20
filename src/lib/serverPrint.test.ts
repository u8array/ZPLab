import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_MS, listServerPrinters, queryZplServer, saveServerToken, sendZplServer } from "./serverPrint";

const build = vi.hoisted(() => ({ serverApiBase: "/api/v1" as string | undefined }));
vi.mock("./printReach", () => build);

const fetchMock = vi.fn<typeof fetch>();
const answers = (body: unknown, status = 200) => fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
const line = (reply: unknown) => `${JSON.stringify(reply)}\n`;

/** A reply body that arrives in pieces of the given byte lengths, the rest in a last one. */
function inPieces(text: string, ...lengths: number[]): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        let at = 0;
        for (const length of [...lengths, bytes.length]) {
          controller.enqueue(bytes.slice(at, at + length));
          at += length;
        }
        controller.close();
      },
    }),
  );
}
const replies = (text: string, ...lengths: number[]) => fetchMock.mockImplementationOnce(() => Promise.resolve(inPieces(text, ...lengths)));

/** A reply body that stops after half and stays open until the request is aborted. */
const hangsAfterHalf = () =>
  fetchMock.mockImplementationOnce((...[, init]) =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(line({ kind: "text", text: "half" })));
            init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        }),
      ),
    ),
  );

const query = async (signal = new AbortController().signal) => {
  const texts: string[] = [];
  const result = await queryZplServer("dock", "~HS", 60_000, signal, (text) => texts.push(text));
  return { result, texts };
};

beforeEach(async () => {
  build.serverApiBase = "/api/v1";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await saveServerToken("");
});
afterEach(() => vi.unstubAllGlobals());

describe("the server request", () => {
  it("carries the stored token, and no header while none is stored", async () => {
    answers({ printers: [] });
    await listServerPrinters();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/printers", { headers: {}, signal: expect.any(AbortSignal) });
    await saveServerToken(" secret ");
    answers({ printers: [] });
    await listServerPrinters();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/printers", { headers: { Authorization: "Bearer secret" }, signal: expect.any(AbortSignal) });
  });

  it("sends no header for a token a header cannot carry, so the server refuses the request itself", async () => {
    await saveServerToken("tök€n");
    answers({ ok: false, errors: ["unauthorized"] }, 401);
    expect(await listServerPrinters()).toEqual({ kind: "unauthorized" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/printers", { headers: {}, signal: expect.any(AbortSignal) });
  });

  it("reads a refused token, a server out of reach and any other status as failures of their own", async () => {
    answers({ ok: false, errors: ["unauthorized"] }, 401);
    expect(await listServerPrinters()).toEqual({ kind: "unauthorized" });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await listServerPrinters()).toEqual({ kind: "server_unreachable" });
    answers({ ok: false, errors: ["internal error"] }, 500);
    expect(await listServerPrinters()).toEqual({ kind: "error", message: "HTTP 500" });
  });

  it("asks no one in a build without a server", async () => {
    build.serverApiBase = undefined;
    expect(await listServerPrinters()).toEqual({ kind: "error", message: "This build has no ZPLab server" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("listServerPrinters", () => {
  it("lists the printers and refuses an answer of another shape", async () => {
    answers({ printers: [{ id: "dock", name: "Dock" }] });
    expect(await listServerPrinters()).toEqual({ kind: "ok", printers: [{ id: "dock", name: "Dock" }] });
    answers({ printers: [{ id: "dock" }] });
    expect(await listServerPrinters()).toEqual({ kind: "error", message: "unexpected answer from the server" });
    fetchMock.mockResolvedValueOnce(new Response("<html>"));
    expect(await listServerPrinters()).toEqual({ kind: "error", message: "unexpected answer from the server" });
  });
});

describe("sendZplServer", () => {
  it("posts the ZPL to the printer it names", async () => {
    answers({ kind: "sent" });
    expect(await sendZplServer("dock", "^XA^XZ")).toEqual({ kind: "sent" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/printers/dock/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify({ zpl: "^XA^XZ" })),
      signal: expect.any(AbortSignal),
    });
  });

  it("reads each answer of the route and refuses one the contract does not know", async () => {
    answers({ kind: "refused" });
    expect(await sendZplServer("dock", "^XA^XZ")).toEqual({ kind: "refused" });
    answers({ kind: "unreachable" });
    expect(await sendZplServer("dock", "^XA^XZ")).toEqual({ kind: "unreachable" });
    answers({ kind: "error" });
    expect(await sendZplServer("dock", "^XA^XZ")).toEqual({ kind: "unreachable" });
    answers({ kind: "toString" });
    expect(await sendZplServer("dock", "^XA^XZ")).toEqual({ kind: "error", message: "unexpected answer from the server" });
  });

  it("reads a printer the server does not list as unconfigured, and a refused body by its status", async () => {
    answers({ ok: false, errors: ["no such printer"] }, 404);
    expect(await sendZplServer("gone", "^XA^XZ")).toEqual({ kind: "unconfigured" });
    answers({ ok: false, errors: ["body exceeds 16 MiB"] }, 413);
    expect(await sendZplServer("dock", "^XA^XZ")).toEqual({ kind: "error", message: "HTTP 413" });
    answers({ ok: false, errors: ["unauthorized"] }, 401);
    expect(await sendZplServer("dock", "^XA^XZ")).toEqual({ kind: "unauthorized" });
  });
});

describe("queryZplServer", () => {
  it("hands the text over in order, however the lines are cut on the way", async () => {
    const stream = line({ kind: "text", text: "Größe " }) + line({ kind: "text", text: "100" }) + line({ kind: "done", end: "closed" });
    // The third piece starts inside the two bytes of the ö.
    replies(stream, 5, 21, 30);
    expect(await query()).toEqual({ result: { kind: "done", end: "closed", chunks: 2 }, texts: ["Größe ", "100"] });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/printers/dock/query", expect.objectContaining({ body: new TextEncoder().encode(JSON.stringify({ zpl: "~HS", deadlineMs: 60_000 })) }));
  });

  it("ends as the last line says", async () => {
    replies(line({ kind: "text", text: "half" }) + line({ kind: "done", end: "deadline" }));
    expect((await query()).result).toEqual({ kind: "done", end: "deadline", chunks: 1 });
    replies(line({ kind: "done", end: "lost" }));
    expect((await query()).result).toEqual({ kind: "done", end: "lost", chunks: 0 });
    replies(line({ kind: "refused" }));
    expect((await query()).result).toEqual({ kind: "refused" });
    replies(line({ kind: "unreachable" }));
    expect((await query()).result).toEqual({ kind: "unreachable" });
    replies(line({ kind: "too_large" }));
    expect((await query()).result).toEqual({ kind: "error", message: "response too large" });
    replies(line({ kind: "error" }));
    expect((await query()).result).toEqual({ kind: "unreachable" });
  });

  it("refuses a line the contract does not know", async () => {
    replies(line({ kind: "done", end: "stopped" }));
    expect((await query()).result).toEqual({ kind: "error", message: "unexpected answer from the server" });
    replies(line({ kind: "text" }));
    expect((await query()).result).toEqual({ kind: "error", message: "unexpected answer from the server" });
    replies(line({ kind: "paused" }));
    expect((await query()).result).toEqual({ kind: "error", message: "unexpected answer from the server" });
  });

  it("reads a reply without its last line as lost, with what came", async () => {
    replies(line({ kind: "text", text: "half" }));
    expect(await query()).toEqual({ result: { kind: "done", end: "lost", chunks: 1 }, texts: ["half"] });
    replies(line({ kind: "text", text: "half" }) + "<html>\n");
    expect((await query()).result).toEqual({ kind: "done", end: "lost", chunks: 1 });
  });

  it("ends a read the caller stopped as stopped, before the answer and inside it", async () => {
    const early = new AbortController();
    fetchMock.mockImplementationOnce(() => {
      early.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    expect((await query(early.signal)).result).toEqual({ kind: "done", end: "stopped", chunks: 0 });

    const late = new AbortController();
    hangsAfterHalf();
    const texts: string[] = [];
    const read = queryZplServer("dock", "~HS", 60_000, late.signal, (text) => {
      texts.push(text);
      late.abort();
    });
    expect(await read).toEqual({ kind: "done", end: "stopped", chunks: 1 });
    expect(texts).toEqual(["half"]);
  });

  it("reads a printer the server does not list as unconfigured, and a refused body by its status", async () => {
    answers({ ok: false, errors: ["no such printer"] }, 404);
    expect((await query()).result).toEqual({ kind: "unconfigured" });
    answers({ ok: false, errors: ["body.deadlineMs: Too big"] }, 400);
    expect((await query()).result).toEqual({ kind: "error", message: "HTTP 400" });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await query()).result).toEqual({ kind: "server_unreachable" });
  });
});

describe("a server that stays silent", () => {
  let bounds: number[] = [];
  let giveUp: (() => void) | undefined;
  const silent = () =>
    fetchMock.mockImplementationOnce((...[, init]) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
      return promise;
    });
  const asked = (times: number) => vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(times));

  beforeEach(() => {
    bounds = [];
    giveUp = undefined;
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const bound = new AbortController();
      bounds.push(ms);
      giveUp = () => bound.abort();
      return bound.signal;
    });
  });
  afterEach(() => vi.mocked(AbortSignal.timeout).mockRestore());

  it("reads a list and a send without an answer as a server out of reach", async () => {
    silent();
    const list = listServerPrinters();
    await asked(1);
    expect(bounds).toEqual([ANSWER_MS]);
    giveUp?.();
    expect(await list).toEqual({ kind: "server_unreachable" });

    silent();
    const send = sendZplServer("dock", "^XA^XZ");
    await asked(2);
    expect(bounds).toEqual([ANSWER_MS, ANSWER_MS]);
    giveUp?.();
    expect(await send).toEqual({ kind: "server_unreachable" });
  });

  it("reads a query past its deadline as out of reach, or the reply as lost", async () => {
    silent();
    const unanswered = query();
    await asked(1);
    expect(bounds).toEqual([60_000 + ANSWER_MS]);
    giveUp?.();
    expect((await unanswered).result).toEqual({ kind: "server_unreachable" });

    hangsAfterHalf();
    const texts: string[] = [];
    const read = queryZplServer("dock", "~HS", 60_000, new AbortController().signal, (text) => {
      texts.push(text);
      giveUp?.();
    });
    expect(await read).toEqual({ kind: "done", end: "lost", chunks: 1 });
    expect(texts).toEqual(["half"]);
  });

  it("gives a megabyte its upload time on top of the deadline", async () => {
    const font = "0".repeat(1_000_000);
    silent();
    const send = sendZplServer("dock", font);
    await asked(1);
    giveUp?.();
    await send;
    silent();
    const read = queryZplServer("dock", font, 60_000, new AbortController().signal, () => undefined);
    await asked(2);
    giveUp?.();
    await read;
    expect(bounds).toEqual([ANSWER_MS + 8000, 60_000 + ANSWER_MS + 8000]);
  });

  it("counts the bytes the body takes on the wire, not the characters of the ZPL", async () => {
    silent();
    const send = sendZplServer("dock", `ä"`.repeat(500_000));
    await asked(1);
    giveUp?.();
    await send;
    expect(bounds).toEqual([ANSWER_MS + 16_000]);
  });

  it("reads a list and a send whose answer stops midway as a server out of reach", async () => {
    hangsAfterHalf();
    const list = listServerPrinters();
    await asked(1);
    giveUp?.();
    expect(await list).toEqual({ kind: "server_unreachable" });

    hangsAfterHalf();
    const send = sendZplServer("dock", "^XA^XZ");
    await asked(2);
    giveUp?.();
    expect(await send).toEqual({ kind: "server_unreachable" });
  });
});
