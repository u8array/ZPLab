/*
 * Generates Labelary reference PNGs rendered with the DEFAULT Zebra
 * font (^A0, CG Triumvirate Condensed Bold) for the box-match test
 * suite. No custom font is uploaded — the printer-resident font is
 * what end users actually print with, so this is the ground truth for
 * "what will land on the label".
 *
 * Run: npx --yes tsx tests/scripts/fetch_labelary_default_text_fixtures.ts
 *
 * Skips cases whose fixture already exists, so re-runs only fill gaps.
 */
import * as fs from 'fs';
import * as path from 'path';
import { textBoxMatchCases } from '../fixtures/textBoxMatchCases';
import { deviceFontBoxMatchCases } from '../fixtures/deviceFontBoxMatchCases';
import { font0GlyphCoverageCases } from '../fixtures/font0GlyphCoverageCases';

const FIXTURES_DIR = path.resolve('tests/fixtures/labelary_text_default_images');
const DEVICE_FIXTURES_DIR = path.resolve(
  'tests/fixtures/labelary_devicefont_images',
);
const RENDER_URL = 'http://api.labelary.com/v1/printers/8dpmm/labels/4x4/0/';
const RATE_LIMIT_MS = 1000;

async function fetchLabel(zpl: string): Promise<Buffer> {
  const res = await fetch(RENDER_URL, {
    method: 'POST',
    headers: {
      Accept: 'image/png',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: zpl,
  });
  if (!res.ok) {
    throw new Error(`Labelary ${res.status}: ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

interface FetchJob {
  dir: string;
  id: string;
  zpl: string;
}

/** ^ and ~ terminate ^FD, so such payloads go through ^FH hex escapes;
 *  non-ASCII needs ^CI28 (UTF-8). */
function fdFor(text: string): { ci: string; fd: string } {
  const ci = /[^\x20-\x7e]/.test(text) ? '^CI28' : '';
  if (!/[\^~\\_]/.test(text)) return { ci, fd: `^FD${text}` };
  const hex = [...text]
    .map((c) => {
      const b = Buffer.from(c, 'utf8');
      return /[\^~\\_]/.test(c)
        ? [...b].map((x) => `_${x.toString(16).padStart(2, '0')}`).join('')
        : c;
    })
    .join('');
  return { ci, fd: `^FH^FD${hex}` };
}

async function main(): Promise<void> {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.mkdirSync(DEVICE_FIXTURES_DIR, { recursive: true });

  const jobs: FetchJob[] = [
    ...[...textBoxMatchCases, ...font0GlyphCoverageCases].map((tc) => {
      const { ci, fd } = fdFor(tc.text);
      return {
        dir: FIXTURES_DIR,
        id: tc.id,
        zpl:
          `^XA${ci}^FO${tc.x},${tc.y}` +
          `^A0${tc.rotation},${tc.fontHeight},${tc.fontWidth || tc.fontHeight}` +
          `${fd}^FS^XZ`,
      };
    }),
    // Device fonts: width stays 0 so the firmware derives it from the
    // cell matrix, matching what deviceFontMetrics does locally.
    ...deviceFontBoxMatchCases.map((tc) => ({
      dir: DEVICE_FIXTURES_DIR,
      id: tc.id,
      zpl:
        `^XA^FO${tc.x},${tc.y}` +
        `^A${tc.fontId}${tc.rotation},${tc.fontHeight},${tc.fontWidth || ''}` +
        `^FD${tc.text}^FS^XZ`,
    })),
  ];

  // The case lists share ids on purpose (see fixtureIdContract).
  const byFile = new Map<string, FetchJob>();
  for (const job of jobs) {
    const file = path.join(job.dir, `${job.id}.png`);
    if (!byFile.has(file)) byFile.set(file, job);
  }
  const missing = [...byFile.entries()]
    .filter(([file]) => !fs.existsSync(file))
    .map(([, job]) => job);
  if (missing.length === 0) {
    console.log('All fixtures already present.');
    return;
  }
  console.log(`Fetching ${missing.length} fixture(s) from Labelary...`);

  for (const job of missing) {
    const png = await fetchLabel(job.zpl);
    fs.writeFileSync(path.join(job.dir, `${job.id}.png`), png);
    console.log(`  ${job.id}.png`);
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`\nWrote ${missing.length} fixture(s).`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
