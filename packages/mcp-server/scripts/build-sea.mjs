// Build the sidecar as a Node SEA binary: esbuild CJS bundle -> SEA blob ->
// inject into a node copy. Cross builds (CI macOS x86_64 on the arm64 runner)
// must pass --node with a downloaded target-arch node, not the runner's own.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { stripCertificateTable } from "./pe.mjs";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const { values } = parseArgs({
  options: {
    // Node to clone for the target arch; env form for the CI cross legs.
    node: { type: "string", default: process.env.ZPLAB_SEA_NODE ?? process.execPath },
  },
});

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
// Under `tauri build` (env from the CLI) the exe goes where externalBin
// expects it; standalone runs keep dist-sea. Intermediates stay in dist-sea.
const triple = process.env.TAURI_ENV_TARGET_TRIPLE;
const workDir = join(pkgDir, "dist-sea");
const outDir = triple ? join(dirname(dirname(pkgDir)), "src-tauri", "binaries") : workDir;
const exeName = triple
  ? `zplab-mcp-${triple}${isWindows ? ".exe" : ""}`
  : `zplab-mcp${isWindows ? ".exe" : ""}`;

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: pkgDir });
// Both tool bins are JS shims, so run them through node directly: no shell,
// no pnpm wrapper, works identically on every platform.
const require = createRequire(import.meta.url);
const runBin = (spec, args) => run(process.execPath, [require.resolve(spec), ...args]);

mkdirSync(workDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
const bundle = join(workDir, "zplab-mcp.cjs");
const blob = join(workDir, "zplab-mcp.blob");
const exe = join(outDir, exeName);

runBin("esbuild/bin/esbuild", [
  join(pkgDir, "src", "index.ts"),
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--minify",
  `--outfile=${bundle}`,
]);

writeFileSync(
  join(workDir, "sea-config.json"),
  JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }),
);
run(process.execPath, ["--experimental-sea-config", join(workDir, "sea-config.json")]);

// The SEA format is version-coupled: a blob from the runner's node fails at
// runtime inside a different-version target binary.
if (values.node !== process.execPath) {
  let targetVersion = null;
  try {
    targetVersion = execFileSync(values.node, ["--version"]).toString().trim();
  } catch {
    console.warn(`cannot execute ${values.node}; ensure its version is ${process.version}`);
  }
  if (targetVersion !== null && targetVersion !== process.version) {
    throw new Error(`target node is ${targetVersion}, runner is ${process.version}`);
  }
}
// A runner-arch node under a target-triple name would ship a binary the
// target machines cannot start.
if (triple) {
  const tripleArch = triple.startsWith("aarch64") ? "arm64" : "x64";
  let nodeArch = process.arch;
  if (values.node !== process.execPath) {
    try {
      nodeArch = execFileSync(values.node, ["-p", "process.arch"]).toString().trim();
    } catch {
      nodeArch = "unknown";
    }
  }
  if (nodeArch !== "unknown" && nodeArch !== tripleArch) {
    throw new Error(
      `node is ${nodeArch} but the target triple needs ${tripleArch}; pass --node/ZPLAB_SEA_NODE`,
    );
  }
}
copyFileSync(values.node, exe);
// postject's appended section would leave the Authenticode entry pointing inside the file.
if (isWindows) stripCertificateTable(exe);
// macOS arm64 refuses unsigned binaries, so the ad-hoc signature goes back on after injecting.
if (isMac) run("codesign", ["--remove-signature", exe]);
runBin("postject/dist/cli.js", [
  exe,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(isMac ? ["--macho-segment-name", "NODE_SEA"] : []),
]);
if (isMac) run("codesign", ["-s", "-", exe]);
if (!isWindows) chmodSync(exe, 0o755);

console.log(`built ${exe}`);
