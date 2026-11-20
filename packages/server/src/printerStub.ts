import { createServer, type AddressInfo, type Socket } from "node:net";
import { onTestFinished } from "vitest";
import type { Printer } from "./printers.js";

async function listen(serve: (socket: Socket) => void): Promise<{ printer: Printer; close: () => Promise<void> }> {
  const open = new Set<Socket>();
  const server = createServer((socket) => {
    open.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => open.delete(socket));
    serve(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    printer: { id: "stub", name: "Stub", host: "127.0.0.1", port },
    close: () =>
      new Promise((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A loopback listener that plays a printer and closes when the test finishes. `serve` gets every connection. */
export async function stubPrinter(serve: (socket: Socket) => void): Promise<Printer> {
  const { printer, close } = await listen(serve);
  onTestFinished(close);
  return printer;
}

/** A printer on a port nothing listens on. */
export async function deadPrinter(): Promise<Printer> {
  const { printer, close } = await listen(() => undefined);
  await close();
  return printer;
}

/** Everything a connection sends before it ends. */
export function received(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
