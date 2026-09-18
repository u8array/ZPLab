// Setup-script upload lists `setupFonts` and `setupGraphics`, one entry per printer file.

import { setupEntryKey } from "./storagePath";

export function findSetupEntry<T extends { path: string }>(list: readonly T[] | undefined, path: string): T | undefined {
  const key = setupEntryKey({ path });
  return list?.find((e) => setupEntryKey(e) === key);
}

/** Whether the list already holds this file with different content, so a merge would replace it. */
export function setupEntryHoldsOther<T extends { path: string }>(list: readonly T[] | undefined, entry: T): boolean {
  const prior = findSetupEntry(list, entry.path);
  return prior !== undefined && !sameSetupEntry(prior, { ...entry, path: prior.path });
}

/** The list with this entry added, or replacing the one already on that printer file. */
export function withSetupEntry<T extends { path: string }>(list: readonly T[] | undefined, entry: T): T[] {
  return mergeSetupEntries(list, [entry]).merged;
}

/** Undefined once empty, so the profile field reads as absent. */
export function withoutSetupEntry<T extends { path: string }>(list: readonly T[] | undefined, path: string): T[] | undefined {
  const key = setupEntryKey({ path });
  const next = (list ?? []).filter((e) => setupEntryKey(e) !== key);
  return next.length > 0 ? next : undefined;
}

/** Entries hold only strings, so identity is field equality. */
function sameSetupEntry<T extends object>(a: T, b: T): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

/** A stream states the current bytes and never a deletion, so an incoming entry adds or replaces, never removes.
 *  `changed` counts what the caller may report as news. */
export function mergeSetupEntries<T extends { path: string }>(
  existing: readonly T[] | undefined,
  incoming: readonly T[],
): { merged: T[]; changed: number } {
  const merged = [...(existing ?? [])];
  let changed = 0;
  for (const entry of incoming) {
    const at = merged.findIndex((e) => setupEntryKey(e) === setupEntryKey(entry));
    if (at < 0) {
      merged.push(entry);
      changed += 1;
      continue;
    }
    // The stored path spelling wins, so only the rest of the entry can differ.
    const next = { ...entry, path: (merged[at] as T).path };
    if (!sameSetupEntry(merged[at] as T, next)) changed += 1;
    merged[at] = next;
  }
  return { merged, changed };
}
