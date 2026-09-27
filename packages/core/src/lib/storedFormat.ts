import type { PageLabel } from '../types/LabelConfig';
import type { ResourceDelivery } from './resourceDelivery';
import { isRecallableFormatPath, storageKey } from './storagePath';

type StoredFormatPage = Pick<PageLabel, 'storedFormatPath' | 'storedFormatDelivery'>;

/** The path a job recalls instead of storing, once the page says so and ^XF can read the name. */
export function recallOnlyPath(page: StoredFormatPage): string | undefined {
  const path = page.storedFormatPath;
  return page.storedFormatDelivery !== undefined && path !== undefined && isRecallableFormatPath(path) ? path : undefined;
}

/** The way a job takes for the page's format, which is storing whenever ^XF could not recall the name. */
export function formatDelivery(page: StoredFormatPage): ResourceDelivery {
  return recallOnlyPath(page) === undefined || page.storedFormatDelivery === undefined ? 'job' : page.storedFormatDelivery;
}

/** Storage keys more than one page stores its format under, since the printer keeps one format per name. */
export function contestedFormatKeys(pages: readonly Pick<PageLabel, 'storedFormatPath'>[]): Set<string> {
  const seen = new Set<string>();
  const contested = new Set<string>();
  for (const p of pages) {
    if (p.storedFormatPath === undefined) continue;
    const key = storageKey(p.storedFormatPath);
    if (seen.has(key)) contested.add(key);
    seen.add(key);
  }
  return contested;
}

export type RecallWayIssue = 'longName' | 'contested';

/** Why a page may not recall its format: ^XF cannot read the name, or another page stores under it. */
export function recallWayIssue(page: Pick<PageLabel, 'storedFormatPath'>, pages: readonly Pick<PageLabel, 'storedFormatPath'>[]): RecallWayIssue | undefined {
  const path = page.storedFormatPath;
  if (path === undefined) return undefined;
  if (!isRecallableFormatPath(path)) return 'longName';
  return contestedFormatKeys(pages).has(storageKey(path)) ? 'contested' : undefined;
}
