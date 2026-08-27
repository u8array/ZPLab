// QR ^FD codec (Zebra PG pp. 128-133): the field data carries switches before
// the payload, in a fixed order. This module owns both directions, so the
// emitted form and the parsed form cannot drift apart. Pure, no UI.

const QR_EC_LEVELS = ['H', 'Q', 'M', 'L'] as const;
export type QrEcLevel = (typeof QR_EC_LEVELS)[number];

/** The level the firmware falls back to when the ^FD switch names none
 *  (spec p.130 "M = standard level (default)", ZD230-confirmed). */
export const QR_EC_DEFAULT: QrEcLevel = 'M';

export function isQrEcLevel(v: unknown): v is QrEcLevel {
  return typeof v === 'string' && (QR_EC_LEVELS as readonly string[]).includes(v);
}

export function qrFdWire(errorCorrection: QrEcLevel, data: string): string {
  return `${errorCorrection}A,${data}`;
}

/** Switch order per spec p.129/130. Case-insensitive: the firmware accepts a
 *  lowercase switch (Labelary-verified), so refusing it would read the
 *  printer's own bytes as payload. */
const QR_FD_SWITCHES = /^(D[0-9]{4}[0-9A-Fa-f]{2},)?([HQML])([AM]),([\s\S]*)$/i;

function utf8Width(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** How many JS characters carry the first `n` wire bytes. `Bdddd` counts the
 *  bytes the printer receives, but this string is already decoded, so a
 *  character's width is whatever the active ^CI charset gave it. */
function charsForBytes(s: string, n: number, utf8: boolean): number {
  let bytes = 0;
  let chars = 0;
  for (const ch of s) {
    const width = utf8 ? utf8Width(ch.codePointAt(0) ?? 0) : 1;
    if (bytes + width > n) break;
    bytes += width;
    chars += ch.length;
  }
  return chars;
}

/** The payload as the printer encodes it. Segments exist only where per-segment
 *  switches do (manual input, mixed mode); plain automatic input has none, so
 *  its commas are data (p.131/132/133). */
function joinSegments(payload: string, manual: boolean, mixed: boolean, utf8: boolean): string {
  if (!manual && !mixed) return payload;
  const out: string[] = [];
  let rest = payload;
  let more = true;
  while (more) {
    // Byte mode counts its bytes, so one of them may be the comma that would
    // otherwise end the segment; reading in order is what tells them apart.
    // Case-sensitive: a lowercase mode letter is payload, not a switch.
    const counted = manual ? /^B([0-9]{4})/.exec(rest)?.[1] : undefined;
    if (counted !== undefined) {
      const body = rest.slice(5);
      const end = 5 + charsForBytes(body, Number(counted), utf8);
      out.push(rest.slice(5, end));
      rest = rest.slice(end);
      // A count that overruns its segment costs only the overhang: the
      // firmware resyncs at the next comma and reads on (ZD230: `B0002abc,N12`
      // prints `ab12`).
      if (rest !== '' && !rest.startsWith(',')) {
        const next = rest.indexOf(',');
        rest = next === -1 ? '' : rest.slice(next);
      }
    } else {
      const seg = (manual ? /^[NAK]?([^,]*)/ : /^([^,]*)/).exec(rest);
      out.push(seg?.[1] ?? '');
      rest = rest.slice(seg?.[0].length ?? rest.length);
    }
    more = rest.startsWith(',');
    if (more) rest = rest.slice(1);
  }
  return out.join('');
}

export interface QrFdParse {
  errorCorrection: QrEcLevel;
  content: string;
  /** Re-emitting this model would not reproduce the source bytes. */
  lossy: boolean;
}

/** `encoding` is the active ^CI charset label: `Bdddd` counts wire bytes, so
 *  turning that count back into characters needs it. Never fails, since an
 *  unreadable form keeps its bytes as content rather than costing the object. */
export function qrFdToModel(fd: string, encoding: string): QrFdParse {
  const utf8 = encoding === 'utf-8';
  const m = QR_FD_SWITCHES.exec(fd);
  // A malformed prefix is still a prefix: the firmware consumes three bytes
  // whatever they are (ZD230: `HELLO` prints `LO`, `QAHELLO` prints `ELLO`),
  // so the model must drop them too or the canvas shows more than the print.
  const switchEc = (m?.[2] ?? fd[0])?.toUpperCase();
  const errorCorrection = isQrEcLevel(switchEc) ? switchEc : QR_EC_DEFAULT;
  const payload = m ? (m[4] ?? '') : fd.slice(3);
  const content = m
    ? joinSegments(payload, m[3]?.toUpperCase() === 'M', !!m[1], utf8)
    : payload;
  return { errorCorrection, content, lossy: qrFdWire(errorCorrection, content) !== fd };
}
