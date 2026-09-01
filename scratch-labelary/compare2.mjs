import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const dir = import.meta.dirname;
const png = (n) => decodePng(join(dir, n));

function decodePng(path) {
  const buf = readFileSync(path);
  let off = 8;
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const colorType = ihdr[9];
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      }
      cur[x] = v;
    }
    prev = cur;
  }
  return { width, height, bpp, pixels: out };
}

function diffPng(a, b, labelA, labelB) {
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${labelA} vs ${labelB}: DIFFERENT DIMENSIONS ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    return null;
  }
  let diff = 0;
  let minX = a.width, maxX = 0, minY = a.height, maxY = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * (a.bpp || 1);
      if (a.pixels[i] !== b.pixels[i]) {
        diff++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const total = a.pixels.length;
  const pct = (100 * diff / total).toFixed(3);
  console.log(`${labelA} vs ${labelB}: ${diff} px of ${total} (${pct}%) bbox x[${minX}..${maxX}] y[${minY}..${maxY}]`);
  return diff;
}

const t1 = png('t1_bare.png');
const t2 = png('t2_sealed.png');
const t6 = png('t6_embed.png');
const t7 = png('t7_qr.png');
const ctrl_sku = png('ctrl_sku.png');
const ctrl_def = png('ctrl_default.png');
const ctrl_embed = png('ctrl_embed.png');
const ctrl_qr = png('ctrl_qr.png');

console.log('--- bare slot + recall vs flat render (the fix) ---');
diffPng(t1, ctrl_sku, 't1 bare+recall', 'ctrl SKU-42');
console.log('--- sealed default + recall: which text prints? ---');
const d1 = diffPng(t2, ctrl_def, 't2 sealed+recall', 'ctrl DEFAULT');
const d2 = diffPng(t2, ctrl_sku, 't2 sealed+recall', 'ctrl SKU-42');
console.log('   => recall overrides sealed default on Labelary:', d2 === 0, '| keeps default:', d1 === 0);
console.log('--- embed case ---');
diffPng(t6, ctrl_embed, 't6 embed+recall', 'ctrl PRESKU-42POST');
console.log('--- QR case ---');
diffPng(t7, ctrl_qr, 't7 qr+recall', 'ctrl QR MA,A1');
console.log('--- baseline: DEFAULT vs SKU-42 flat renders ---');
diffPng(ctrl_def, ctrl_sku, 'ctrl DEFAULT', 'ctrl SKU-42');
