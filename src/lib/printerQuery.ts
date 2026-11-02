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
export function answered(outcome: PrinterOutcome<string>): PrinterOutcome<string> {
  if (outcome.kind !== "ok") return outcome;
  const text = unframed(outcome.value).replace(/^[\r\n]+|[\r\n]+$/g, "");
  return text.trim() ? { kind: "ok", value: text } : { kind: "silent" };
}

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
const REPLY_DEADLINE_MS = 60_000;
/** The printer renders before it answers, and a ~DY font download took a ZD230 past 10 s. */
const FIRST_BYTE_MS = 30_000;
/** The printer keeps the channel open, so a gap behind the reply is its end. */
const REPLY_IDLE_MS = 1200;
/** A channel message can land after the command's return. */
const CHUNKS_SETTLE_MS = 5000;

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

/** Sends `zpl` and reads the reply until the printer goes quiet behind it, or until `deadlineMs` pass. A deadline
 *  that cuts a reply is an error. Every failure comes back as a value, never as a throw. */
export async function queryPrinter(target: QueryTarget, zpl: string, deadlineMs = REPLY_DEADLINE_MS): Promise<PrinterOutcome<string>> {
  if (!isDesktopShell) return { kind: "error", message: "The printer query requires the desktop app" };
  try {
    return await readReply(target, zpl, deadlineMs);
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
}

async function readReply(target: QueryTarget, zpl: string, deadlineMs: number): Promise<PrinterOutcome<string>> {
  let body = "";
  let received = 0;
  let returned = false;
  let settled: (() => void) | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stream = await openReplyStream(target, zpl, deadlineMs, (chunk) => {
    body += chunk;
    received += 1;
    settled?.();
    if (returned) return;
    clearTimeout(idle);
    idle = setTimeout(stop, REPLY_IDLE_MS);
  });
  const stop = () => {
    stopped = true;
    stream.stop();
  };
  // A printer that answers nothing is not waited out for the whole deadline.
  idle = setTimeout(stop, FIRST_BYTE_MS);
  const end = await stream.done;
  returned = true;
  clearTimeout(idle);
  if (end.kind !== "ok") return end;
  // The last chunks may land after the command returned, so the body waits for them.
  if (received < end.value.chunks) {
    await new Promise<void>((resolve) => {
      const give = setTimeout(resolve, CHUNKS_SETTLE_MS);
      settled = () => {
        if (received < end.value.chunks) return;
        clearTimeout(give);
        resolve();
      };
    });
    settled = undefined;
    // The channel delivers in order, so a missing message holds back every later one.
    if (received < end.value.chunks) return { kind: "incomplete" };
  }
  if (body === "") return { kind: "silent" };
  // The reader stops itself behind the reply, so a deadline or a lost link ahead of its own stop cut the printer off
  // mid-reply.
  if (!stopped && end.value.end === "deadline") return { kind: "timed_out" };
  if (!stopped && end.value.end === "lost") return { kind: "lost" };
  return { kind: "ok", value: body };
}
