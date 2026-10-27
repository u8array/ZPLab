import { serve } from "@hono/node-server";
import { registerHeadlessFootprintMeasurer } from "@zplab/headless";
import { createApp } from "./app.js";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main(): void {
  const token = process.env.ZPLAB_TOKEN;
  if (!token) fail("ZPLAB_TOKEN is required; every design route needs the bearer token");
  // An empty variable from a compose file or .env means the default, not port 0.
  const port = Number(process.env.ZPLAB_PORT || "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("ZPLAB_PORT must be a port number from 1 to 65535");
  // Same for the host: empty must not mean every interface.
  const hostname = process.env.ZPLAB_HOST || "127.0.0.1";

  registerHeadlessFootprintMeasurer();
  const app = createApp({ token, version: process.env.ZPLAB_VERSION || "dev" });
  const server = serve({ fetch: app.fetch, hostname, port }, (info) => {
    process.stdout.write(`zplab-server listening on http://${info.address}:${info.port}/api/v1\n`);
  });
  server.on("error", (err) => fail(`zplab-server cannot listen on ${hostname}:${port}: ${err.message}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

main();
