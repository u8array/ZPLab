// commands.json (not .ts) so the coverage script reads it without a TS loader.
import raw from "./commands.json";
import type { Catalog, CatalogSection, ZplCommandEntry } from "./schema";

// Types only: a value re-export pulls zod into the app bundle.
export type { CatalogSection, CommandSupport, ImportLossCause, SupportLevel, ZplCommandEntry } from "./schema";

// Cast, not parse: catalog.test.ts validates the JSON.
const catalog = raw as unknown as Catalog;

export const CATALOG_SECTIONS: readonly CatalogSection[] = catalog.sections;
export const ZPL_COMMANDS: readonly ZplCommandEntry[] = catalog.commands;

/** The one spelling of an entry's id (`^LL`, `~JA`); twins answer to their first prefix. */
export const commandId = (entry: ZplCommandEntry): string => `${entry.prefixes[0]}${entry.cmd}`;

/** Every id an entry answers to: both prefixes of a twin row, aliases included. */
export const commandIds = (entry: ZplCommandEntry): string[] =>
  entry.prefixes.flatMap((prefix) => [entry.cmd, ...(entry.aliases ?? [])].map((name) => `${prefix}${name}`));

/** Display form with every spelling: `^B0 / ^BO`, `^HL / ~HL`. */
export const commandLabel = (entry: ZplCommandEntry): string => commandIds(entry).join(" / ");

/** `^LL` -> entry; id uniqueness is pinned by catalog.test.ts. */
const byId = new Map<string, ZplCommandEntry>();
for (const entry of ZPL_COMMANDS) {
  for (const id of commandIds(entry)) byId.set(id, entry);
}

/** `^AA`..`^AZ`, `^A1`..`^A9` select a device font; the guide documents them as one command `^A`
 *  (only `^A0` and `^A@` have entries of their own). */
const DEVICE_FONT_RE = /^\^A[A-Z1-9]$/;

/** Entry for a prefixed command like `^LL`; a bare name tries `^` first, then `~`. */
export function catalogEntry(command: string): ZplCommandEntry | undefined {
  const key = command.toUpperCase();
  if (key[0] === "^" || key[0] === "~") return byId.get(key) ?? (DEVICE_FONT_RE.test(key) ? byId.get("^A") : undefined);
  return byId.get(`^${key}`) ?? byId.get(`~${key}`);
}

/** Queries of one or two characters are command names, never prose words. */
const PROSE_MIN_CHARS = 3;

/** Search by name (with or without prefix), alias, title and summary; the empty query lists everything.
 *  A typed prefix is a command search and picks the twin (`^JS` vs `~JS`): prose is not consulted then. */
export function filterCatalog(query: string): ZplCommandEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...ZPL_COMMANDS];
  const prefix = q[0] === "^" ? "^" : q[0] === "~" ? "~" : null;
  // `^DFR:NAME` and `^XFR:NAME` in exported files are the command plus a memory device letter.
  const bare = (prefix ? q.slice(1) : q).replace(/^(df|xf)[a-z](:.*)?$/, "$1");
  const deviceFont = DEVICE_FONT_RE.test(`^${bare.toUpperCase()}`);
  const byName = (e: ZplCommandEntry): boolean =>
    (prefix === null || e.prefixes.includes(prefix)) &&
    (e.cmd.toLowerCase().startsWith(bare) || (deviceFont && e.cmd === "A") || (e.aliases ?? []).some((a) => a.toLowerCase().startsWith(bare)));
  const byProse = (e: ZplCommandEntry): boolean =>
    prefix === null && q.length >= PROSE_MIN_CHARS && (e.title.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q));
  return ZPL_COMMANDS.filter((e) => byName(e) || byProse(e));
}
