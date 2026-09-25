// Deterministic generator: GS1 Barcode Syntax Dictionary -> internal AI catalog.
// Source authoritative (GS1 AISBL, from BWIPP+Zint), matches bwip-js renderer.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'scripts', 'data', 'gs1-syntax-dictionary.txt'), 'utf8');

function groupFor(ai) {
  const p3 = ai.slice(0, 3);
  // Date check first: 700x date AIs would otherwise be swallowed by the
  // logistics /^70[0-4]/ bucket.
  if (/^1[1-7]$/.test(ai) || ['7003','7006','7007','7011','8008'].includes(ai)) return 'date';
  if (ai === '00' || /^4[012]/.test(ai) || p3 === '430' || p3 === '431' || p3 === '432' || p3 === '433' || /^70[0-4]/.test(ai)) return 'logistics';
  // 31xx-36xx only; AI 30 (VAR COUNT) belongs to batchQty below.
  if (/^3[1-6]/.test(ai)) return 'measures';
  if (/^9[0-9]$/.test(ai)) return 'internal';
  if (ai === '8200') return 'url';
  if (['01','02','03'].includes(ai) || /^2[1-5]/.test(ai) || ['235','8001','8003','8004','8006','8010','8017','8018','8026','253','255','8013','8019'].includes(ai)) return 'identification';
  if (['10','20','30','37'].includes(ai) || /^39/.test(ai) || ['8020','415','8005','8011','8012'].includes(ai)) return 'batchQty';
  if (/^7[1-9]/.test(ai) || /^8[0-9]/.test(ai) || /^42[0-7]/.test(ai)) return 'attributes';
  return 'other';
}
// Value-shape linters the runtime validates (or will); others (gcppos1,
// pcenc, latitude, …) are dropped. Charset overrides derive from the type
// letter: Y = CSET 39, Z = base64url ("filesafe").
const KNOWN_LINTERS = new Set(['yesno', 'iso3166alpha2', 'csumalpha']);
function parseComponent(fmt) {
  const first = fmt.trim().split(/\s+/)[0].replace(/^\[|\]$/g, '');
  const parts = first.split(',');
  const m = parts[0].match(/^([NXYZ])(\.\.)?(\d+)$/);
  if (!m) return null;
  const mods = parts.slice(1);
  const linters = mods.filter((x) => KNOWN_LINTERS.has(x));
  if (m[1] === 'Y') linters.push('cset39');
  if (m[1] === 'Z') linters.push('cset64');
  return { type: m[1], variable: !!m[2], len: +m[3],
    csum: mods.includes('csum'),
    linters,
    isDate: mods.some((x) => /^yy/.test(x)),
    // yymmd0 permits DD=00 ("whole month"); yymmdd/yyyymmdd require a real day.
    day00: mods.some((x) => /^yy.*d0$/.test(x)),
    multi: fmt.trim().split(/\s+/).filter((t) => /^\[?[NXYZ]\.?\.?\d/.test(t)).length > 1 };
}

/** 'req=00+02,00+8026' -> [['00','02'],['00','8026']]; members may contain
 *  'n' digit wildcards (e.g. '31nn'). */
function parseReq(token) {
  return token.slice(4).split(',').map((alt) => alt.split('+'));
}
/** 'ex=01,03,392n' -> ['01','03','392n']. */
function parseEx(token) {
  return token.slice(3).split(',');
}
const out = [], skipped = [];
for (const raw of src.split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (!line || line.startsWith('#')) continue;
  const hash = line.indexOf('#');
  const title = hash >= 0 ? line.slice(hash + 1).trim() : '';
  const tokens = (hash >= 0 ? line.slice(0, hash) : line).trim().split(/\s+/);
  const ai = tokens[0];
  let idx = 1;
  if (idx < tokens.length && /^[*?]+$/.test(tokens[idx])) idx++;
  const fmtStr = tokens.slice(idx).filter((t) => /^\[?[NXYZ]\.?\.?\d/.test(t)).join(' ');
  if (!fmtStr) { skipped.push({ ai, title }); continue; }
  const c = parseComponent(fmtStr);
  if (!c) { skipped.push({ ai, title, fmtStr }); continue; }
  const isRange = /^\d+-\d+$/.test(ai);
  let kind;
  if (isRange && /^3[0-6]/.test(ai)) kind = 'decimal';
  else if (c.isDate) kind = 'date';
  else if (['01','02','03'].includes(ai)) kind = 'gtin';
  else if (c.variable) kind = c.type === 'N' ? 'varNum' : 'varAlnum';
  else kind = c.type === 'N' ? 'fixedNum' : 'fixedAlnum';
  const reqTok = tokens.find((t) => t.startsWith('req='));
  const exTok = tokens.find((t) => t.startsWith('ex='));
  // A bare 'dlpkey' has no qualifiers, while 'dlpkey=22,10,21|235' lists ordered alternatives.
  const dlTok = tokens.find((t) => t === 'dlpkey' || t.startsWith('dlpkey='));
  const dlKey = dlTok === undefined ? undefined
    : dlTok === 'dlpkey' ? [[]]
    : dlTok.slice(7).split('|').map((alt) => alt.split(','));
  out.push({ ai, kind, len: c.len,
    ...(c.csum ? { checkDigit: true } : {}),
    ...(c.linters.length ? { linters: c.linters } : {}),
    ...(c.day00 ? { day00: true } : {}),
    ...(reqTok ? { req: parseReq(reqTok) } : {}),
    ...(exTok ? { ex: parseEx(exTok) } : {}),
    ...(dlKey ? { dlKey } : {}),
    ...(c.multi ? { multiComponent: true } : {}),
    group: groupFor(isRange ? ai.split('-')[0] : ai), title });
}
const byGroup = {}; for (const e of out) byGroup[e.group] = (byGroup[e.group]||0)+1;
console.log('entries:', out.length, 'skipped:', skipped.length, JSON.stringify(skipped));
console.log('byGroup:', JSON.stringify(byGroup));

// --- emit TS data module ---
const toLine = (e) => {
  const p = [`ai: '${e.ai}'`, `kind: '${e.kind}'`, `len: ${e.len}`];
  if (e.checkDigit) p.push('checkDigit: true');
  if (e.linters) p.push(`linters: [${e.linters.map((l) => `'${l}'`).join(', ')}]`);
  if (e.day00) p.push('day00: true');
  if (e.req) p.push(`req: [${e.req.map((alt) => `[${alt.map((m) => `'${m}'`).join(', ')}]`).join(', ')}]`);
  if (e.ex) p.push(`ex: [${e.ex.map((m) => `'${m}'`).join(', ')}]`);
  if (e.dlKey) p.push(`dlKey: [${e.dlKey.map((alt) => `[${alt.map((m) => `'${m}'`).join(', ')}]`).join(', ')}]`);
  if (e.multiComponent) p.push('multiComponent: true');
  // Title is free text from the dictionary; JSON.stringify escapes quotes so a
  // future title containing ' cannot break the generated module.
  p.push(`group: '${e.group}'`, `title: ${JSON.stringify(e.title)}`);
  return '  { ' + p.join(', ') + ' },';
};
const header = `// GENERATED from the GS1 Barcode Syntax Dictionary (GS1 AISBL, Apache-2.0,
// derived from BWIPP + Zint) via scripts/gen-gs1-catalog.mjs. Do not hand-edit.
// Data only; the entry types live in gs1AiCatalog.types.ts. Consumed by
// gs1.ts (AI_BY_CODE), which expands ranges and skips multiComponent
// AIs (their extra fields are not modeled yet).

import type { Gs1AiCatalogEntry } from './gs1AiCatalog.types';

export const GS1_AI_FULL_CATALOG: readonly Gs1AiCatalogEntry[] = [`;
writeFileSync(join(ROOT, 'packages', 'core', 'src', 'lib', 'gs1AiCatalog.ts'), header + '\n' + out.map(toLine).join('\n') + '\n];\n');
console.log('wrote packages/core/src/lib/gs1AiCatalog.ts with', out.length, 'entries');
