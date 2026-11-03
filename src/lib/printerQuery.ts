import { owedReplies, type AwaitedReply, type OwedReply } from "@zplab/core/lib/hostCommands";
import { unframed } from "@zplab/core/lib/hostStatus";
import { errorMessage } from "./errorMessage";
import { isDesktopShell } from "./platform";
import type { QueryTarget } from "./printTarget";
import { queryZplUsb, type StreamDone, type StreamDoneResult } from "./usbPrint";

export type PrinterQueryFailure =
  | { kind: "unconfigured" }
  | { kind: "busy" }
  | { kind: "unparsed" }
  | { kind: "silent" }
  | { kind: "ignored" }
  | { kind: "refused"; port: number }
  | { kind: "unreachable" }
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
      return "No printer configured. Set a USB device or IP under Settings, Printer.";
    case "busy":
      return "Another printer read is still running. Try again in a moment.";
    case "unparsed":
      return "The printer answered, but the reply could not be read.";
    case "silent":
      return "The printer did not answer.";
    case "ignored":
      return "The printer ignored the command. The object is still there.";
    case "refused":
      return `The printer refused the connection. Check that port ${failure.port} is open.`;
    case "unreachable":
      return "Could not reach the printer. Check the IP address and network.";
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

interface ReplyStream {
  done: Promise<PrinterOutcome<StreamDone>>;
  stop: () => void;
}

/** Bounds the read alone, the connect and the write have their own timeouts in Rust. */
export const REPLY_DEADLINE_MS = 60_000;
/** The printer renders before it answers, and a ~DY font download took a ZD230 past 10 s. */
export const FIRST_BYTE_MS = 30_000;
/** The printer keeps the channel open, so a gap behind the reply is its end. */
export const REPLY_IDLE_MS = 1200;
/** A channel message can land after the command's return. */
export const CHUNKS_SETTLE_MS = 5000;

async function openReplyStream(target: QueryTarget, zpl: string, deadlineMs: number, onChunk: (chunk: string) => void): Promise<ReplyStream> {
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
  /** Ends the read with what came so far. */
  signal?: AbortSignal;
}

export interface PrinterReply {
  body: string;
  /** The ^HV replies that had not all come when the read ended. */
  unanswered: readonly OwedReply[];
}

async function readReply(target: QueryTarget, zpl: string, deadlineMs: number, awaited: readonly AwaitedReply[], signal?: AbortSignal): Promise<PrinterOutcome<PrinterReply>> {
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
      if (owedReplies(body, awaited).length === 0) stop();
    }, REPLY_IDLE_MS);
  });
  const stop = () => {
    stopped = true;
    stream.stop();
  };
  // Only an owed reply is worth the whole deadline.
  if (awaitsNone) idle = setTimeout(stop, FIRST_BYTE_MS);
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const end = await stream.done;
  returned = true;
  clearTimeout(idle);
  signal?.removeEventListener("abort", stop);
  if (end.kind !== "ok") return end;
  // The last chunks may land after the command returned, so the body waits for them, unless the signal aborts meanwhile.
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
  // A read that awaits no ^HV stops itself behind the reply, so a deadline or a lost link ahead of its own stop cut
  // the printer off mid-reply. A document's last owed reply may land inside the idle gap ahead of either, and is whole.
  if (awaitsNone && !stopped && end.value.end === "deadline") return { kind: "timed_out" };
  if (awaitsNone && !stopped && end.value.end === "lost") return { kind: "lost" };
  if (unanswered.length === 0 && answeredText(body).kind === "silent") return { kind: "silent" };
  return { kind: "ok", value: { body, unanswered } };
}

/** The reply of a command that answers at once, whole or not at all. */
export async function queryPrinter(target: QueryTarget, zpl: string, deadlineMs?: number): Promise<PrinterOutcome<string>> {
  const res = await readPrinterReply(target, zpl, { deadlineMs });
  return res.kind === "ok" ? { kind: "ok", value: res.value.body } : res;
}

/** Reads until every awaited reply is in and the printer has gone quiet, or until the deadline or the signal ends
 *  the wait with what came. Every failure comes back as a value, never as a throw. */
export async function readPrinterReply(target: QueryTarget, zpl: string, wait: ReplyWait = {}): Promise<PrinterOutcome<PrinterReply>> {
  if (!isDesktopShell) return { kind: "error", message: "The printer query requires the desktop app" };
  try {
    return await readReply(target, zpl, wait.deadlineMs ?? REPLY_DEADLINE_MS, wait.awaited ?? [], wait.signal);
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
}
