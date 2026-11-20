import type { Server } from "node:http";

/** Stops listening and resolves once the last connection is gone, cutting any connection still open after `graceMs`. */
export function shutdown(server: Server, graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    const cut = setTimeout(() => server.closeAllConnections(), graceMs);
    server.close(() => {
      clearTimeout(cut);
      resolve();
    });
  });
}
