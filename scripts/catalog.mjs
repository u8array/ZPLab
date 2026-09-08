// Catalog access for the coverage generator (node only, no TS loader), so the
// id spelling and the level check below are twins of the core module; the
// parity test in src/lib/catalogScripts.test.ts pins them together.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = join(ROOT, 'packages', 'core', 'src', 'catalog', 'commands.json');
export const CAPABILITIES = ['web', 'desktop', 'lint'];
const LEVELS = new Set(['yes', 'planned', 'no']);

export const commandId = (entry) => `${entry.prefixes[0]}${entry.cmd}`;
export const commandIds = (entry) => entry.prefixes.flatMap((p) => [entry.cmd, ...(entry.aliases ?? [])].map((n) => `${p}${n}`));

/** The catalog with every support level checked once; throws so the caller decides how to fail. */
export function readCatalog() {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  for (const entry of catalog.commands) {
    for (const cap of CAPABILITIES) {
      if (!LEVELS.has(entry.support?.[cap])) throw new Error(`catalog command ${commandId(entry)} has no valid support.${cap}`);
    }
  }
  return catalog;
}
