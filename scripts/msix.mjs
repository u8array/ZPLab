// Split out of build-msix.mjs so msixScripts.test.ts can check these without a Windows build.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = join(ROOT, 'src-tauri', 'packaging', 'windows', 'AppxManifest.xml');

export const readManifest = () => readFileSync(MANIFEST, 'utf8');

/** The Store refuses a leading 0 and orders by version, so the major stays shifted by one past 1.0. */
export function storeVersion(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
  if (!parts || parts[0] > 65534 || parts.some((part) => part > 65535)) throw new Error(`MSIX cannot express version '${version}'`);
  const [major, minor, patch] = parts;
  return `${major + 1}.${minor}.${patch}`;
}

/** The Store reserves the fourth part. */
export const packageVersion = (store) => `${store}.0`;

const IDENTITY_VERSION = /(<Identity\b[^>]*?\bVersion=")[^"]*(")/g;

export function stampVersion(manifest, version) {
  const found = manifest.match(IDENTITY_VERSION)?.length ?? 0;
  if (found !== 1) throw new Error(`expected one Identity Version in the manifest, found ${found}`);
  return manifest.replace(IDENTITY_VERSION, (_, before, after) => `${before}${version}${after}`);
}

export const manifestExecutable = (manifest) => /<Application\b[^>]*\bExecutable="([^"]+)"/.exec(manifest)?.[1];
