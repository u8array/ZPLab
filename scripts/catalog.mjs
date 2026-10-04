// Catalog access for the coverage generator, which runs on node without a TS loader. The id
// spelling, the docker default and the level check are twins of core, pinned by src/lib/catalogScripts.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = join(ROOT, 'packages', 'core', 'src', 'catalog', 'commands.json');
export const CAPABILITIES = ['web', 'desktop', 'docker'];
const LEVELS = new Set(['yes', 'planned', 'no']);

export const commandId = (entry) => `${entry.prefixes[0]}${entry.cmd}`;
export const commandIds = (entry) => entry.prefixes.flatMap((p) => [entry.cmd, ...(entry.aliases ?? [])].map((n) => `${p}${n}`));

/** The catalog with the docker default filled and every level checked once. Throws so the caller decides how to fail. */
export function readCatalog() {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  for (const entry of catalog.commands) {
    entry.support.docker ??= entry.support.web;
    for (const cap of CAPABILITIES) {
      if (!LEVELS.has(entry.support?.[cap])) throw new Error(`catalog command ${commandId(entry)} has no valid support.${cap}`);
    }
  }
  return catalog;
}
