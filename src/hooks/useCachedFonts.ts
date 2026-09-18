import { useSyncExternalStore } from 'react';
import { getFontsSnapshot, subscribe, type CachedFont } from '@zplab/core/lib/fontCache';

/** The cache as a render input. A bare read inside a memoized derivation freezes with that derivation's deps. */
export function useCachedFonts(): readonly CachedFont[] {
  return useSyncExternalStore(subscribe, getFontsSnapshot);
}
