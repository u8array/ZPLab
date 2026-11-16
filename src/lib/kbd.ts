/** Platform-aware keyboard shortcut display. Mac uses the ⌘/⇧ glyphs,
 *  every other platform uses the Ctrl+Shift+… convention. */

import { isMac } from './platform';

/** Render a keyboard shortcut for the current platform. */
export function kbd(key: string, opts: { shift?: boolean } = {}): string {
  if (isMac) {
    return `⌘${opts.shift ? '⇧' : ''}${key}`;
  }
  return `Ctrl+${opts.shift ? 'Shift+' : ''}${key}`;
}

/** Lowercase letter a shortcut event means: the printed Latin letter, else the one at the key's US position. */
export function shortcutLetter(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  return /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : null;
}
