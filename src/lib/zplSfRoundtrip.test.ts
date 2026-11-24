import { describe, it, expect } from 'vitest';
import { parseZPL } from '@zplab/core/lib/zplParser';
import { generateZPL } from '@zplab/core/lib/zplGenerator';

// The printer's ^SF rule after the Zebra guide (p.335-336): mask and increment align to the right
// end of the data, a % position passes the carry on, and a carry past the leftmost position is lost.
function printerStep(data: string, mask: string, increment: string): { next: string; escaped: boolean } {
  const chars = [...data];
  let carry = 0;
  let escaped = false;
  let defaultOne = increment === '';
  for (let k = 1; k <= chars.length; k++) {
    const m = mask[mask.length - k];
    if (m === undefined || m === '%') {
      // A carry that lands on a % position escapes the positions the mask counts.
      escaped ||= carry !== 0 && m === '%';
      if (m === undefined) break;
      continue;
    }
    const at = chars.length - k;
    const c = chars[at] ?? '';
    const [zero, radix] = /[0-9]/.test(c) ? [48, 10] : /[a-z]/.test(c) ? [97, 26] : [65, 26];
    const digit = defaultOne ? 1 : (increment[increment.length - k] ?? '').charCodeAt(0) - zero;
    defaultOne = false;
    const value = c.charCodeAt(0) - zero + (digit >= 0 && digit < radix ? digit : 0) + carry;
    chars[at] = String.fromCharCode(zero + (value % radix));
    carry = Math.floor(value / radix);
    escaped ||= carry !== 0 && k === mask.length && k < chars.length;
  }
  return { next: chars.join(''), escaped };
}

/** The first prints of a field, null once a carry leaves the positions the mask counts. The mask is
 *  rebuilt over every character, so the printer cannot be followed past that point. */
function prints(data: string, mask: string, increment: string, n = 6): string[] | null {
  const out = [data];
  while (out.length < n) {
    const { next, escaped } = printerStep(out[out.length - 1] ?? '', mask, increment);
    if (escaped) return null;
    out.push(next);
  }
  return out;
}

/** The ^FD, mask and increment the app exports after importing the field. */
function regenerated(data: string, mask: string, increment: string) {
  const { pages } = parseZPL(`^XA^FO0,0^A0N,30,0^FD${data}^SF${mask},${increment}^FS^XZ`, 8);
  const zpl = generateZPL({ widthMm: 100, heightMm: 50, dpmm: 8 }, pages[0]?.objects ?? []);
  const [, fd = '', sfMask = '', sfIncrement = ''] = /\^FD([^^]*)\^SF([^,^]*),([^^]*)\^FS/.exec(zpl) ?? [];
  return { fd, mask: sfMask, increment: sfIncrement };
}

const withoutDropped = (s: string) => s.replace(/[^0-9A-Za-z]/g, '');

let seed = 20261124;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (chars: string) => chars[Math.floor(random() * chars.length)] ?? '';
const ALPHABET = { d: '0123456789', A: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', a: 'abcdefghijklmnopqrstuvwxyz' } as const;

function field(kind: 'plain' | 'skip' | 'shortMask' | 'longIncrement' | 'foreignChars' | 'minusSign' | 'emptyIncrement') {
  const classes = Array.from({ length: 1 + Math.floor(random() * 6) }, () => pick('dAa') as keyof typeof ALPHABET);
  const data = classes.map((c) => pick(ALPHABET[c])).join('');
  let mask = classes.join('');
  const from = Math.floor(random() * classes.length);
  let increment = classes.slice(from).map((c) => pick(ALPHABET[c])).join('');
  if (kind === 'skip') {
    const at = Math.floor(random() * mask.length);
    mask = mask.slice(0, at) + '%' + mask.slice(at + 1);
  }
  if (kind === 'shortMask') {
    mask = mask.slice(Math.floor(random() * mask.length));
    increment = increment.slice(-mask.length);
  }
  if (kind === 'longIncrement') increment = pick('0123456789ABC') + increment.padStart(data.length, '0');
  if (kind === 'foreignChars') increment = [...increment].map((c) => (random() < 0.4 ? pick('0123456789ABCXYZ') : c)).join('');
  if (kind === 'minusSign') increment = `-${increment}`;
  if (kind === 'emptyIncrement') increment = '';
  return { data, mask, increment };
}

describe('an imported ^SF field keeps its sequence once the app writes it again', () => {
  it.each(['plain', 'skip', 'shortMask', 'longIncrement', 'foreignChars', 'minusSign', 'emptyIncrement'] as const)('%s', (kind) => {
    let compared = 0;
    for (let n = 0; n < 300; n++) {
      const original = field(kind);
      const expected = prints(original.data, original.mask, original.increment);
      if (!expected) continue;
      const again = regenerated(original.data, original.mask, original.increment);
      expect(prints(again.fd, again.mask, again.increment), JSON.stringify(original)).toEqual(expected);
      compared++;
    }
    expect(compared).toBeGreaterThan(150);
  });

  it('keeps the digits of the guide example with a dash', () => {
    const again = regenerated('BL00-0', 'AAdd%d', '1%1');
    expect(prints(again.fd, again.mask, again.increment, 3)).toEqual(prints('BL00-0', 'AAdd%d', '1%1', 3)?.map(withoutDropped));
  });
});
