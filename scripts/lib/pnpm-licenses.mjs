// Single source for reading the production dependency license tree. Both the
// license gate and the attribution generator depend on the exact same scope:
// the shipped app and the workspace packages it bundles. An unscoped read would
// also pull packages/mcp-server's tree, which runs as a separate process and
// never lands in dist/.
import { execSync } from 'node:child_process';

const LICENSES_CMD = 'pnpm licenses list --prod --json --filter zplab...';

// Returns pnpm's grouped output: { [spdxId]: Array<{name, versions, paths,
// license, author, homepage, description}> }. Fails closed (exit 2) if the
// list can't be read or is empty, so neither tool ever silently checks nothing.
export function readProdLicenses() {
  let raw;
  try {
    // maxBuffer well above the current ~20 KB so a growing tree can't hit the
    // 1 MB default and turn a license read into an ENOBUFS crash.
    raw = execSync(LICENSES_CMD, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error(`Could not read \`${LICENSES_CMD}\`:`, e.message);
    process.exit(2);
  }
  let byLicense;
  try {
    byLicense = JSON.parse(raw);
  } catch (e) {
    console.error(`\`${LICENSES_CMD}\` did not return valid JSON:`, e.message);
    process.exit(2);
  }
  if (!byLicense || typeof byLicense !== 'object' || Array.isArray(byLicense)) {
    console.error(`\`${LICENSES_CMD}\` did not return a JSON object.`);
    process.exit(2);
  }
  const total = Object.values(byLicense).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
  if (total === 0) {
    console.error(`\`${LICENSES_CMD}\` returned no packages; refusing to pass a check that inspected nothing.`);
    process.exit(2);
  }
  return byLicense;
}
