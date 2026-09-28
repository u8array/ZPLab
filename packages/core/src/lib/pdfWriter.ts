import { zlibSync } from 'fflate';

/** One label as a 1-bit raster: `height` rows of `ceil(width / 8)` bytes, a set bit prints black, like ^GF. */
export interface PdfPage {
  widthMm: number;
  heightMm: number;
  width: number;
  height: number;
  mono: Uint8Array;
}

export interface PdfMeta {
  producer: string;
  title?: string;
  subject?: string;
}

const PT_PER_MM = 72 / 25.4;
const encoder = new TextEncoder();

/** A text string: escaped ASCII when that suffices, else UTF-16BE with a byte-order mark as a hex string. */
function literal(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  const units: string[] = ['FEFF'];
  for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'));
  return `<${units.join('')}>`;
}

function pt(mm: number): string {
  return (Math.round(mm * PT_PER_MM * 100) / 100).toString();
}

/** DeviceGray reads a set bit as white, so the rows flip before they are written. */
function invert(mono: Uint8Array): Uint8Array {
  const out = new Uint8Array(mono.length);
  for (let i = 0; i < mono.length; i++) out[i] = ~(mono[i] ?? 0) & 0xff;
  return out;
}

/** A minimal PDF 1.4 with one Flate-compressed 1-bit image per page and a cross-reference table with exact byte offsets. */
export function writePdf(pages: readonly PdfPage[], meta: PdfMeta): Uint8Array {
  if (pages.length === 0) throw new Error('a PDF needs at least one page');
  for (const p of pages) {
    if (!(p.width > 0) || !(p.height > 0)) throw new Error('a page needs a width and a height in dots');
    if (p.mono.length !== Math.ceil(p.width / 8) * p.height) throw new Error('raster length does not match its dimensions');
  }
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const text = (s: string): void => push(encoder.encode(s));
  const object = (n: number, body: string, stream?: Uint8Array): void => {
    offsets[n] = length;
    text(`${n} 0 obj\n${body}\n`);
    if (stream) {
      text('stream\n');
      push(stream);
      text('\nendstream\n');
    }
    text('endobj\n');
  };

  // Binary comment after the header, so transfer tools treat the file as binary.
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const firstPage = 4;
  const pageIds = pages.map((_, i) => firstPage + i * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const info = [`/Producer ${literal(meta.producer)}`, meta.title === undefined ? '' : `/Title ${literal(meta.title)}`, meta.subject === undefined ? '' : `/Subject ${literal(meta.subject)}`]
    .filter((s) => s !== '')
    .join(' ');
  object(3, `<< ${info} >>`);
  pages.forEach((page, i) => {
    const id = firstPage + i * 3;
    const w = pt(page.widthMm);
    const h = pt(page.heightMm);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    const image = zlibSync(invert(page.mono));
    object(
      id + 1,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode /Length ${image.length} >>`,
      image,
    );
    const content = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    object(id + 2, `<< /Length ${content.length} >>`, content);
  });

  const count = firstPage + pages.length * 3;
  const xref = length;
  text(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) text(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
