// Smoke against the built SEA binary in dist-sea, run the way an operator starts it.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const exe = join(pkgDir, "dist-sea", process.platform === "win32" ? "zplab-server.exe" : "zplab-server");
const PORT = 18788;
const TOKEN = "smoketok";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/api/v1`;
const PAGE = "<!doctype html><title>smoke</title>";
const ZPL = "^XA^FO10,10^A0N,30,30^FDsmoke^FS^XZ";
const { version } = JSON.parse(readFileSync(join(dirname(dirname(pkgDir)), "package.json"), "utf8"));
const get = (path, init) => fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(10000) });
const post = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(body),
});
const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms).unref())]);

let failed = false;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "ok " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) failed = true;
};

const designer = mkdtempSync(join(tmpdir(), "zplab-smoke-"));
writeFileSync(join(designer, "index.html"), PAGE);

const printer = createServer().unref();
await new Promise((resolve) => printer.listen(0, "127.0.0.1", resolve));
// The stub answers ~HS and leaves the link open, so a closed link comes from the server.
const nextLink = () =>
  new Promise((resolve) => {
    printer.once("connection", (socket) => {
      let got = "";
      socket.on("error", () => undefined);
      socket.on("data", (chunk) => {
        got += chunk;
        if (got === "~HS") socket.write("pong");
      });
      socket.on("close", () => resolve(got));
    });
  });

const child = spawn(exe, [], {
  env: {
    ...process.env,
    ZPLAB_TOKEN: TOKEN,
    ZPLAB_PORT: String(PORT),
    ZPLAB_DESIGNER_DIR: designer,
    ZPLAB_PRINTERS: JSON.stringify([{ id: "stub", host: "127.0.0.1", port: printer.address().port }]),
  },
  stdio: ["ignore", "pipe", "inherit"],
});
child.on("error", (e) => {
  console.error("spawn failed:", e.message);
  process.exit(1);
});
// Taken before the first await, because a binary that fails to start has already exited.
const gone = new Promise((resolve) => child.once("exit", resolve));
const listening = new Promise((resolve, reject) => {
  child.stdout.on("data", (d) => {
    if (String(d).includes("listening on")) resolve();
  });
  child.on("exit", (code) => reject(new Error(`binary exited with code ${code} before listening`)));
  setTimeout(() => reject(new Error("no listening line within 15 s")), 15000).unref();
});

try {
  await listening;
  const health = await get("/health");
  const body = await health.json();
  check("health answers", health.status === 200 && body.ok === true);
  check("the binary carries the release version", body.version === version, `${body.version} vs ${version}`);
  const validated = await get("/validate-zpl", post({ zpl: ZPL }));
  check("the bundled core answers", validated.status === 200);

  const page = await fetch(ORIGIN, { signal: AbortSignal.timeout(10000) });
  check("the designer directory is served at the root", page.status === 200 && (await page.text()) === PAGE);

  const sentTo = nextLink();
  const sent = await get("/printers/stub/send", post({ zpl: ZPL }));
  check("a send reaches the printer", (await sent.json()).kind === "sent" && (await within(sentTo, 5000)) === ZPL);

  const queried = nextLink();
  const stop = new AbortController();
  const reply = await fetch(`${BASE}/printers/stub/query`, {
    ...post({ zpl: "~HS", deadlineMs: 20000 }),
    signal: AbortSignal.any([stop.signal, AbortSignal.timeout(10000)]),
  });
  const reader = reply.body.getReader();
  const decoder = new TextDecoder();
  let got = "";
  while (!got.includes("\n")) {
    const { done, value } = await reader.read();
    if (done) break;
    got += decoder.decode(value, { stream: true });
  }
  const [first] = got.split("\n");
  check("the reply streams back while the read is open", first === JSON.stringify({ kind: "text", text: "pong" }), first);
  // The app tests bypass the node adapter, so a real request is needed to show that a closed request reaches the printer link.
  stop.abort();
  check("a closed request drops the printer link", (await within(queried, 5000)) === "~HS");
} catch (e) {
  check("smoke", false, e.message);
} finally {
  // Wait for the child to exit, because an exit with its pipe still closing fails in libuv on Windows.
  child.kill();
  await within(gone, 5000);
  rmSync(designer, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
