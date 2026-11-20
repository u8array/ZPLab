import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { parsePrinters } from "./printers.js";
import { shutdown } from "./shutdown.js";

// Docker's default stop timeout is 10 s, so open requests get half of that.
const SHUTDOWN_GRACE_MS = 5000;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main(): void {
  const token = process.env.ZPLAB_TOKEN;
  if (!token) fail("ZPLAB_TOKEN is required; every design and printer route needs the bearer token");
  // An empty variable from a compose file or .env means the default, not port 0.
  const port = Number(process.env.ZPLAB_PORT || "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("ZPLAB_PORT must be a port number from 1 to 65535");
  // Same for the host: empty must not mean every interface.
  const hostname = process.env.ZPLAB_HOST || "127.0.0.1";

  const listed = parsePrinters(process.env.ZPLAB_PRINTERS);
  if (!listed.ok) fail(`ZPLAB_PRINTERS must be a JSON list of printers: ${listed.errors.join("; ")}`);

  const app = createApp({ token, version: process.env.ZPLAB_VERSION || "dev", printers: listed.printers });
  // serve() types the result for HTTP/2 too, so the cast to Server is needed for plain HTTP.
  const server = serve({ fetch: app.fetch, hostname, port }, (info) => {
    process.stdout.write(`zplab-server listening on http://${info.address}:${info.port}/api/v1\n`);
  }) as Server;
  server.on("error", (err) => fail(`zplab-server cannot listen on ${hostname}:${port}: ${err.message}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void shutdown(server, SHUTDOWN_GRACE_MS).then(() => process.exit(0)));
  }
}

main();
