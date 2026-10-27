// Smoke against the built SEA binary in dist-sea, run the way an operator starts it.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const exe = join(pkgDir, "dist-sea", process.platform === "win32" ? "zplab-server.exe" : "zplab-server");
const PORT = 18788;
const TOKEN = "smoketok";
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const { version } = JSON.parse(readFileSync(join(dirname(dirname(pkgDir)), "package.json"), "utf8"));
const get = (path, init) => fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(10000) });

let failed = false;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "ok " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) failed = true;
};

const child = spawn(exe, [], {
  env: { ...process.env, ZPLAB_TOKEN: TOKEN, ZPLAB_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
child.on("error", (e) => {
  console.error("spawn failed:", e.message);
  process.exit(1);
});
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
  const validated = await get("/validate-zpl", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ zpl: "^XA^FO10,10^A0N,30,30^FDsmoke^FS^XZ" }),
  });
  check("the bundled core answers", validated.status === 200);
} catch (e) {
  check("smoke", false, e.message);
} finally {
  // Wait for the child to exit, because an exit with its pipe still closing fails in libuv on Windows.
  const gone = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
}
process.exitCode = failed ? 1 : 0;
