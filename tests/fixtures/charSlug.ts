/** Case-insensitive filesystems would collide `A` and `a`, so
 *  lowercase gets an `lc` prefix. */
export const PUNCT_SLUGS: Record<string, string> = {
  '-': 'minus',
  '.': 'dot',
  '=': 'eq',
  ',': 'comma',
  ':': 'colon',
  ';': 'semi',
  '/': 'slash',
  '+': 'plus',
  '*': 'star',
  '#': 'hash',
  '&': 'amp',
  '%': 'pct',
  '$': 'dollar',
  '(': 'lparen',
  ')': 'rparen',
  '!': 'bang',
  '?': 'qmark',
  '@': 'at',
  '_': 'under',
  '"': 'dquote',
  "'": 'squote',
  '<': 'lt',
  '>': 'gt',
};

export function charSlug(c: string): string {
  const punct = PUNCT_SLUGS[c];
  if (punct) return punct;
  if (c >= 'a' && c <= 'z') return `lc${c.toUpperCase()}`;
  return c;
}
