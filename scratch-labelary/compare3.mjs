import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const dir = import.meta.dirname;
function decodePng(name) {
  const buf = readFileSync(join(dir, name));
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
    console.log(`${labelA} vs ${labelB}: DIFFERENT DIMENSIONS`);
    return;
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
  console.log(`${labelA} vs ${labelB}: ${diff} px bbox x[${minX}..${maxX}] y[${minY}..${maxY}]`);
}

const p = (n) => decodePng(n);
const t6 = p('t6_embed.png');
const e1 = p('e1_flat_embed_default.png');
const e2 = p('e2_stored_embed_recall.png');
const e4 = p('e4_flat_unresolved.png');
const e5 = p('e5_ctrl_predefaultpost.png');
const ctrl_sku_embed = p('ctrl_embed.png');

console.log('--- flat ^FE embed + header default vs flat PREDEFAULTPOST ---');
diffPng(e1, e5, 'e1 flat embed+default', 'ctrl PREDEFAULTPOST');
console.log('--- stored embed (header default) + recall SKU-42 vs flat PREDEFAULTPOST ---');
diffPng(e2, e5, 'e2 stored+recall', 'ctrl PREDEFAULTPOST');
console.log('--- stored embed (header default) + recall SKU-42 vs flat PRESKU-42POST ---');
diffPng(e2, ctrl_sku_embed, 'e2 stored+recall', 'ctrl PRESKU-42POST');
console.log('--- stored embed (header default) + recall vs flat embed + default ---');
diffPng(e2, e1, 'e2 stored+recall', 'e1 flat embed+default');
console.log('--- t6 (bare embed) + recall vs unresolved flat embed ---');
diffPng(t6, e4, 't6 bare+recall', 'e4 unresolved');
console.log('--- t6 (bare embed) + recall vs PRESKU-42POST ---');
diffPng(t6, ctrl_sku_embed, 't6 bare+recall', 'ctrl PRESKU-42POST');
