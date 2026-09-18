import { useSyncExternalStore } from 'react';
import { getImagesSnapshot, subscribe, type CachedImage } from '@zplab/core/lib/imageCache';

/** The cache as a render input, see useCachedFonts. */
export function useCachedImages(): readonly CachedImage[] {
  return useSyncExternalStore(subscribe, getImagesSnapshot);
}
