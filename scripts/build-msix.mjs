// The MSIX ships unsigned. The Store signs it on ingestion.
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestExecutable, packageVersion, readManifest, stampVersion, storeVersion } from './msix.mjs';
import { hasCertificateTable } from '../packages/mcp-server/scripts/pe.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAURI = join(ROOT, 'src-tauri');
const TAURI_CLI = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
// Pinned so an ARM64 host cannot pack its own binaries into the x64 package.
const TARGET = 'x86_64-pc-windows-msvc';
const UNPLATED_SIZES = [16, 24, 32, 48, 256];

const run = (file, args) => execFileSync(file, args, { cwd: ROOT, stdio: 'inherit' });

/** Where the SDK installer put the Windows Kits, since its install path is choosable. */
function kitsRoot() {
  let out = '';
  try {
    out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots', '/v', 'KitsRoot10', '/reg:32'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    // reg exits non-zero when the key is absent.
  }
  const root = /KitsRoot10\s+REG_SZ\s+(.+)/.exec(out)?.[1]?.trim();
  if (!root) throw new Error('KitsRoot10 not found in the registry, install the Windows SDK');
  return root;
}

function sdkTools() {
  const bin = join(kitsRoot(), 'bin');
  const versions = existsSync(bin) ? readdirSync(bin).filter((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v)) : [];
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const tools = { makeappx: join(bin, v, 'x64', 'makeappx.exe'), makepri: join(bin, v, 'x64', 'makepri.exe') };
    if (existsSync(tools.makeappx) && existsSync(tools.makepri)) return tools;
  }
  throw new Error(`makeappx.exe/makepri.exe not found under ${bin}, install the Windows SDK`);
}

// Read from the config, so a new sidecar ships in the MSIX as in every Tauri bundle.
function shippedExecutables() {
  const readConf = (file) => JSON.parse(readFileSync(join(TAURI, file), 'utf8'));
  const conf = readConf('tauri.conf.json');
  const overlay = readConf('tauri.msix.conf.json');
  if (overlay.mainBinaryName || overlay.bundle?.externalBin || overlay.bundle?.resources || conf.bundle.resources) {
    throw new Error('build-msix packs only mainBinaryName and externalBin from tauri.conf.json');
  }
  return [conf.mainBinaryName, ...(conf.bundle.externalBin ?? []).map((bin) => basename(bin))].map((name) => `${name}.exe`);
}

if (process.platform !== 'win32') throw new Error('build-msix runs on Windows only');

// Validated before the release compile, so a broken input fails in seconds.
const { makeappx, makepri } = sdkTools();
const version = storeVersion(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
const manifest = stampVersion(readManifest(), packageVersion(version));
const executables = shippedExecutables();
if (manifestExecutable(manifest) !== executables[0]) throw new Error(`AppxManifest must launch ${executables[0]}`);
// cargo, not a fixed path: CARGO_TARGET_DIR or a config target-dir moves it.
const targetDir = JSON.parse(
  execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], { cwd: TAURI, encoding: 'utf8' }),
).target_directory;
const out = join(targetDir, 'msix');
const layout = join(out, 'layout');
const assets = join(layout, 'Assets');

rmSync(out, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });
writeFileSync(join(layout, 'AppxManifest.xml'), manifest);
for (const icon of ['StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png']) {
  copyFileSync(join(TAURI, 'icons', icon), join(assets, icon));
}
// Taskbar and Start look up these variants through resources.pri. Without
// them Windows draws the plated, upscaled 44px tile.
const sized = join(out, 'sized');
run(process.execPath, [TAURI_CLI, 'icon', join(TAURI, 'icons', 'icon.png'), '--png', UNPLATED_SIZES.join(','), '-o', sized]);
for (const size of UNPLATED_SIZES) {
  copyFileSync(join(sized, `${size}x${size}.png`), join(assets, `Square44x44Logo.targetsize-${size}_altform-unplated.png`));
}
const priconfig = join(out, 'priconfig.xml');
run(makepri, ['createconfig', '/cf', priconfig, '/dq', 'en-US_scale-100', '/o']);

// The overlay turns the Tauri bundler off: makeappx packages this variant.
// The binary reports the same version the Store lists.
run(process.execPath, [TAURI_CLI, 'build', '--target', TARGET, '--config', join(TAURI, 'tauri.msix.conf.json'), '--config', JSON.stringify({ version })]);

const release = join(targetDir, TARGET, 'release');
for (const exe of executables) {
  // A carried-over table makes that signing fail with ERROR_BAD_EXE_FORMAT.
  if (hasCertificateTable(join(release, exe))) throw new Error(`${join(release, exe)} carries a certificate table, build:sea must strip it`);
  copyFileSync(join(release, exe), join(layout, exe));
}
run(makepri, ['new', '/pr', layout, '/cf', priconfig, '/mn', join(layout, 'AppxManifest.xml'), '/of', join(layout, 'resources.pri'), '/o']);

const msix = join(out, `ZPLab_${version}_x64.msix`);
run(makeappx, ['pack', '/d', layout, '/p', msix, '/o']);
console.log(`Packed ${msix}`);
// Only this script knows the dir the workflow installs and uploads from.
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `MSIX_DIR=${out}\n`);
