import { connect, type Socket } from "node:net";
import { z } from "zod";
import type { Printer } from "./printers.js";

// Same bounds as the desktop transport, see src-tauri/src/transport.rs.
const IO_TIMEOUT_MS = 4000;
const MAX_REPLY_BYTES = 8 * 1024 * 1024;
export const MAX_DEADLINE_MS = 600_000;

export const sendResultSchema = z
  .object({ kind: z.enum(["sent", "refused", "unreachable", "error"]) })
  .meta({ id: "PrinterSendResult", description: "sent: the connection took every byte. refused: nothing listens on the port. unreachable: the connection did not come up. error: the write did not finish." });
type SendResult = z.infer<typeof sendResultSchema>;

const replyLastSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("done"), end: z.enum(["closed", "deadline", "lost"]) }),
  z.object({ kind: z.enum(["refused", "unreachable", "too_large", "error"]) }),
]);
type ReplyLast = z.infer<typeof replyLastSchema>;

export const replyLineSchema = z
  .discriminatedUnion("kind", [z.object({ kind: z.literal("text"), text: z.string() }), ...replyLastSchema.options])
  .meta({ id: "PrinterReplyLine", description: "text: a piece of the reply. Every other kind is the last line and names how the read ended. done carries the end: the printer closed, the deadline passed or the link dropped. A stream without a last line was cut off." });
export type ReplyLine = z.infer<typeof replyLineSchema>;

function open({ host, port }: Printer): Promise<Socket | "refused" | "unreachable"> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const give = setTimeout(() => {
      socket.destroy();
      resolve("unreachable");
    }, IO_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(give);
      resolve(socket);
    });
    // Stays for the socket's life, since an error event without a listener ends the process.
    socket.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(give);
      resolve(err.code === "ECONNREFUSED" ? "refused" : "unreachable");
    });
  });
}

function write(socket: Socket, zpl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const give = setTimeout(() => resolve(false), IO_TIMEOUT_MS);
    socket.write(zpl, (err) => {
      clearTimeout(give);
      resolve(!err);
    });
  });
}

/** Waits for no reply. A failure comes back as a kind. */
export async function sendToPrinter(printer: Printer, zpl: string): Promise<SendResult> {
  const socket = await open(printer);
  if (typeof socket === "string") return { kind: socket };
  const sent = await write(socket, zpl);
  socket.destroy();
  return { kind: sent ? "sent" : "error" };
}

type ReadEnd = "closed" | "deadline" | "lost" | "stopped" | "too_large";

function read(socket: Socket, deadlineMs: number, stop: AbortSignal, onText: (text: string) => void): Promise<ReadEnd> {
  return new Promise((resolve) => {
    // ^HV returns field data under ^CI28, so the stream decoder holds a split UTF-8 sequence back until the next chunk completes it.
    const decoder = new TextDecoder();
    let total = 0;
    let over = false;
    const finish = (end: ReadEnd) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      stop.removeEventListener("abort", onStop);
      socket.destroy();
      const tail = decoder.decode();
      if (tail) onText(tail);
      resolve(end);
    };
    const timer = setTimeout(() => finish("deadline"), deadlineMs);
    const onStop = () => finish("stopped");
    stop.addEventListener("abort", onStop, { once: true });
    socket.on("data", (chunk: Buffer) => {
      if (over) return;
      total += chunk.length;
      if (total > MAX_REPLY_BYTES) return finish("too_large");
      const text = decoder.decode(chunk, { stream: true });
      if (text) onText(text);
    });
    socket.once("end", () => finish("closed"));
    // A close without an end ahead of it is a dropped link.
    socket.once("close", () => finish("lost"));
    if (stop.aborted) finish("stopped");
    // A printer that closes during the write has emitted its end before the listener above existed.
    else if (socket.readableEnded) finish("closed");
  });
}

/** Streams the reply as text until the printer closes, the deadline passes or `stop` aborts. A stopped read has no last line. */
export async function queryPrinter(printer: Printer, zpl: string, deadlineMs: number, stop: AbortSignal, onText: (text: string) => void): Promise<ReplyLast | "stopped"> {
  const socket = await open(printer);
  if (typeof socket === "string") return { kind: socket };
  if (!(await write(socket, zpl))) {
    socket.destroy();
    return { kind: "error" };
  }
  const end = await read(socket, deadlineMs, stop, onText);
  if (end === "stopped") return end;
  return end === "too_large" ? { kind: end } : { kind: "done", end };
}
