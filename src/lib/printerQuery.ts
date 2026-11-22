import { owedReplies, type AwaitedReply, type OwedReply } from "@zplab/core/lib/documentReplies";
import { unframed } from "@zplab/core/lib/hostStatus";
import { errorMessage } from "./errorMessage";
import { printReach } from "./printReach";
import { carriesReply, type QueryTarget } from "./printTarget";
import type { ReplyEnd, StreamDone, StreamDoneResult } from "./replyStream";
import { queryZplServer } from "./serverPrint";
import { queryZplUsb } from "./usbPrint";

export type PrinterQueryFailure =
  | { kind: "unconfigured" }
  | { kind: "busy" }
  | { kind: "unparsed" }
  | { kind: "silent" }
  | { kind: "ignored" }
  | { kind: "refused"; port?: number }
  | { kind: "unreachable" }
  | { kind: "server_unreachable" }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "permission_denied" }
  | { kind: "timed_out" }
  | { kind: "incomplete" }
  | { kind: "lost" }
  | { kind: "error"; message: string };

export type PrinterOutcome<T> = { kind: "ok"; value: T } | PrinterQueryFailure;

/** A reply that is only a frame is silence. Spaces are kept, since they may be an ^HV header or terminator. */
export function answeredText(body: string): PrinterOutcome<string> {
  const text = unframed(body).replace(/^[\r\n]+|[\r\n]+$/g, "");
  return text.trim() ? { kind: "ok", value: text } : { kind: "silent" };
}

export const answered = (outcome: PrinterOutcome<string>): PrinterOutcome<string> => (outcome.kind === "ok" ? answeredText(outcome.value) : outcome);

/** The wording for the preview path, which keeps its errors as plain text. */
export function printerFailureMessage(failure: PrinterQueryFailure): string {
  switch (failure.kind) {
    case "unconfigured":
      return "No printer configured. Set one under Settings, Printer.";
    case "busy":
      return "Another printer read is still running. Try again in a moment.";
    case "unparsed":
      return "The printer answered, but the reply could not be read.";
    case "silent":
      return "The printer did not answer.";
    case "ignored":
      return "The printer ignored the command. The object is still there.";
    case "refused":
      return failure.port === undefined ? "The printer refused the connection." : `The printer refused the connection. Check that port ${failure.port} is open.`;
    case "unreachable":
      return "Could not reach the printer. Check its address and the network.";
    case "server_unreachable":
      return "Could not reach the server. Check the network and whether the server is running.";
    case "unauthorized":
      return "The server asks for its access token. Set it under Settings, Printer.";
    case "not_found":
      return "USB printer not found. Re-plug it and check Settings, Printer.";
    case "permission_denied":
      return "No access to the USB printer. Grant it in the print dialog, USB tab.";
    case "timed_out":
      return "The read timed out before the reply was complete.";
    case "incomplete":
      return "Part of the reply never arrived.";
    case "lost":
      return "The connection to the printer dropped before the reply was complete.";
    case "error":
      return failure.message;
  }
}

/** Mirrors the Rust TcpQueryResult. */
type TcpQueryResult = StreamDoneResult | { kind: "refused" } | { kind: "unreachable" };

interface OpenStream {
  done: Promise<PrinterOutcome<StreamDone>>;
  stop: () => void;
}

/** Bounds the read alone, the connect and the write have their own timeouts. */
export const REPLY_DEADLINE_MS = 60_000;
/** The printer renders before it answers, and a ~DY font download took a ZD230 past 10 s. */
export const FIRST_BYTE_MS = 30_000;
/** The printer keeps the channel open, so a gap behind the reply is its end. */
export const REPLY_IDLE_MS = 1200;
/** A channel message can land after the command's return. */
export const CHUNKS_SETTLE_MS = 5000;

async function openReplyStream(target: QueryTarget, zpl: string, deadlineMs: number, onChunk: (chunk: string) => void): Promise<OpenStream> {
  if (target.kind === "server") {
    const abort = new AbortController();
    const done = queryZplServer(target.id, zpl, deadlineMs, abort.signal, onChunk).then((res): PrinterOutcome<StreamDone> => (res.kind === "done" ? { kind: "ok", value: res } : res));
    return { done, stop: () => abort.abort() };
  }
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  const chunks = new Channel<string>(onChunk);
  const stop = () => {
    void invoke("query_stop", { channel: chunks.id }).catch(() => undefined);
  };
  const done =
    target.kind === "usb"
      ? queryZplUsb(target.id, zpl, deadlineMs, chunks).then((res): PrinterOutcome<StreamDone> => (res.kind === "done" ? { kind: "ok", value: res } : res))
      : invoke<TcpQueryResult>("query_zpl_tcp", { host: target.host, port: target.port, zpl, deadlineMs, onChunk: chunks }).then(
          (res): PrinterOutcome<StreamDone> => {
            if (res.kind === "refused") return { kind: "refused", port: target.port };
            if (res.kind === "unreachable") return { kind: "unreachable" };
            return { kind: "ok", value: res };
          },
          (e: unknown): PrinterOutcome<StreamDone> => ({ kind: "error", message: errorMessage(e) }),
        );
  return { done, stop };
}

export interface ReplyWait {
  deadlineMs?: number;
  /** The replies the printer still owes after its first answer, which the idle gap alone would miss. */
  awaited?: readonly AwaitedReply[];
  /** Whether the text proves the reply whole, for a reply that pauses longer than the idle gap. A read that ends short of it fails. */
  whole?: (body: string) => boolean;
  /** Ends the read with what came so far. */
  signal?: AbortSignal;
}

export interface PrinterReply {
  body: string;
  /** The awaited replies the body does not hold when the read ended. */
  unanswered: readonly OwedReply[];
  /** A stop can surface as a lost link, so a read the reader ended itself reports `stopped`. */
  end: ReplyEnd;
}

/** The failure a reply's end names, undefined for an end that is no failure. */
function endFailure(end: ReplyEnd): PrinterQueryFailure | undefined {
  if (end === "deadline") return { kind: "timed_out" };
  if (end === "lost") return { kind: "lost" };
  return undefined;
}

async function readReply(target: QueryTarget, zpl: string, { deadlineMs = REPLY_DEADLINE_MS, awaited = [], whole, signal }: ReplyWait): Promise<PrinterOutcome<PrinterReply>> {
  let body = "";
  let received = 0;
  let returned = false;
  let settled: (() => void) | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const awaitsNone = awaited.length === 0;
  const stream = await openReplyStream(target, zpl, deadlineMs, (chunk) => {
    body += chunk;
    received += 1;
    settled?.();
    if (returned) return;
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (whole ? whole(body) : owedReplies(body, awaited).length === 0) stop();
    }, REPLY_IDLE_MS);
  });
  const stop = () => {
    stopped = true;
    stream.stop();
  };
  // Only a reply owed behind a print waits the whole deadline, every other read gives up on a mute printer at the first-byte limit.
  if (awaitsNone) idle = setTimeout(stop, FIRST_BYTE_MS);
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const end = await stream.done;
  returned = true;
  clearTimeout(idle);
  signal?.removeEventListener("abort", stop);
  if (end.kind !== "ok") return end;
  if (received < end.value.chunks) {
    let cut = false;
    await new Promise<void>((resolve) => {
      const give = setTimeout(resolve, CHUNKS_SETTLE_MS);
      const done = () => {
        clearTimeout(give);
        signal?.removeEventListener("abort", cutShort);
        resolve();
      };
      const cutShort = () => {
        cut = true;
        done();
      };
      settled = () => {
        if (received >= end.value.chunks) done();
      };
      signal?.addEventListener("abort", cutShort, { once: true });
    });
    settled = undefined;
    // The channel delivers in order, so a missing message holds back every later one.
    if (received < end.value.chunks && !cut) return { kind: "incomplete" };
  }
  const unanswered = owedReplies(body, awaited);
  // A stopped wait with nothing in still names what it waited for.
  if (body === "" && unanswered.length === 0) return { kind: "silent" };
  const ended: ReplyEnd = stopped ? "stopped" : end.value.end;
  const reply: PrinterOutcome<PrinterReply> = { kind: "ok", value: { body, unanswered, end: ended } };
  // A reply the text proves whole is kept, even when the link or the deadline ends the read behind it.
  if (whole?.(body)) return reply;
  // A read that awaits nothing stops itself behind the reply, so a deadline or a lost link before that stop would cut the printer off mid-reply.
  const failure = awaitsNone ? endFailure(ended) : undefined;
  if (failure) return failure;
  if (unanswered.length === 0 && answeredText(body).kind === "silent") return { kind: "silent" };
  return whole ? { kind: "incomplete" } : reply;
}

/** The reply of a command that answers at once, whole or not at all. */
export async function queryPrinter(target: QueryTarget, zpl: string, deadlineMs?: number): Promise<PrinterOutcome<string>> {
  const res = await readPrinterReply(target, zpl, { deadlineMs });
  return res.kind === "ok" ? { kind: "ok", value: res.value.body } : res;
}

/** Reads until the reply is whole and the printer has gone quiet, or until the deadline or the signal ends the wait.
 *  Every failure comes back as a value, never as a throw. */
export async function readPrinterReply(target: QueryTarget, zpl: string, wait: ReplyWait): Promise<PrinterOutcome<PrinterReply>> {
  if (!carriesReply(target.kind, printReach)) return { kind: "error", message: "This build has no channel that reads this printer" };
  try {
    return await readReply(target, zpl, wait);
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
}
