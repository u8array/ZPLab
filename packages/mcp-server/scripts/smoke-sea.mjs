// Full-channel smoke against the built SEA binary (dist-sea/zplab-mcp[.exe]):
// spawns it the way the Tauri host does and verifies every app-facing channel.
// Exits non-zero on the first failed check.
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const exe = join(pkgDir, "dist-sea", process.platform === "win32" ? "zplab-mcp.exe" : "zplab-mcp");
const PORT = 18746;
const TOK = "smoketok";
const BASE = `http://127.0.0.1:${PORT}/`;
const H = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: `Bearer ${TOK}`,
};
const rpc = (id, method, params) =>
  fetch(BASE, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }).then((r) => r.json());
const design = {
  schemaVersion: 3,
  label: { widthMm: 100, heightMm: 50, dpmm: 8 },
  pages: [
    {
      objects: [
        {
          id: "t1",
          type: "text",
          x: 10,
          y: 10,
          rotation: 0,
          props: { content: "HI", fontHeight: 30, fontWidth: 0, rotation: "N" },
        },
      ],
    },
  ],
};

let failed = false;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "ok " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) failed = true;
};

const t0 = Date.now();
// stderr inherited so a startup crash shows its real cause; token over stdin
// exactly like the Tauri host hands it over.
const child = spawn(exe, ["--http", "--port", String(PORT), "--token-stdin"], {
  stdio: ["pipe", "pipe", "inherit"],
});
child.on("error", (e) => {
  console.error("spawn failed:", e.message);
  process.exit(1);
});
child.stdin.end(`${TOK}\n`);
const events = [];
let onListening;
let onExited;
const ready = new Promise((res) => {
  onListening = res;
});
const exited = new Promise((_res, rej) => {
  onExited = rej;
});
child.on("exit", (code) => onExited(new Error(`binary exited with code ${code} before listening`)));
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try {
      const e = JSON.parse(line);
      events.push(e);
      if (e.zplabEvent === "listening") onListening(Date.now() - t0);
    } catch {
      // dev noise
    }
  }
});

try {
  const startupMs = await Promise.race([
    ready,
    exited,
    new Promise((_r, rej) => setTimeout(() => rej(new Error("no listening line in 5s")), 5000)),
  ]);
  check("startup listening", true, `${startupMs}ms`);

  const init = await rpc(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  check("initialize", init.result?.serverInfo?.name === "zplab");

  const tools = await rpc(2, "tools/list", {});
  const names = tools.result?.tools?.map((t) => t.name) ?? [];
  check("all 8 tools", names.length === 8, names.join(","));

  const created = await rpc(3, "tools/call", {
    name: "create_draft",
    arguments: {
      widthMm: 100,
      heightMm: 50,
      dpmm: 8,
      objects: [{ type: "code128", x: 20, y: 20, props: { content: "12345", height: 80 } }],
    },
  });
  check("create_draft", JSON.parse(created.result.content[0].text).ok === true);

  // Exercises the bundled bwip engine end to end: z-normalisation only
  // happens when the binary can actually measure the barcode.
  const zImport = await rpc(9, "tools/call", {
    name: "import_zpl",
    arguments: { zpl: "^XA^FT300,150,1^BCN,100,Y,N,N^FD123^FS^XZ", dpmm: 8 },
  });
  const zi = JSON.parse(zImport.result.content[0].text);
  check(
    "import_zpl z-normalisation (bwip in SEA)",
    zi.ok === true &&
      zi.designFile?.label?.emit1dZJustify === true &&
      zi.designFile?.pages?.[0]?.objects?.[0]?.x < 300,
  );

  const denied = await fetch(BASE, {
    method: "POST",
    headers: { ...H, authorization: "Bearer wrong" },
    body: "{}",
  });
  check("wrong token 401", denied.status === 401);

  const oia = await rpc(4, "tools/call", { name: "open_in_app", arguments: { designFile: design } });
  check("open_in_app", JSON.parse(oia.result.content[0].text).ok === true);
  await new Promise((r) => setTimeout(r, 200));
  check("openDraft stdout event", events.some((e) => e.zplabEvent === "openDraft"));

  const pendingCall = rpc(5, "tools/call", { name: "get_current_design", arguments: {} });
  await new Promise((r) => setTimeout(r, 300));
  const req = events.find((e) => e.zplabEvent === "designRequest");
  check("designRequest stdout event", !!req);
  await fetch(`${BASE}design-response`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ id: req?.id, designFile: design, measured: { t1: { width: 111, height: 30 } } }),
  });
  const gcd = JSON.parse((await pendingCall).result.content[0].text);
  const t1 = gcd.bounds?.find((b) => b.objectId === "t1");
  check("get_current_design round-trip", gcd.ok === true && t1?.width === 111 && t1?.approx === false);

} finally {
  // Also on the timeout/assertion path: never orphan the spawned binary.
  child.kill();
}
process.exit(failed ? 1 : 0);
