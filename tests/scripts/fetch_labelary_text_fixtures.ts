/*
 * Generates the Labelary reference PNGs for the text visual-regression
 * suite.
 *
 * Workflow:
 *   1. Upload src/assets/fonts/PrintLabZPL-Bold.ttf to Labelary's
 *      /v1/fonts endpoint. The response is ZPL `~DU` commands that
 *      register the font under printer path R:PRINTLAB.TTF.
 *   2. For every entry in tests/fixtures/textTestCases.ts, build a
 *      ZPL label that references the uploaded font via `^A@...,R:PRINTLAB.TTF`
 *      and renders it on a 4×4 inch 8-dpmm canvas.
 *   3. Save the resulting PNG to tests/fixtures/labelary_text_images/.
 *
 * The test (src/test/textVisualRegression.test.ts) compares each
 * fixture against a local @napi-rs/canvas render of the same content
 * using the same TTF. With both sides loading the identical font, the
 * remaining pixel diff is anti-aliasing noise — small enough to use
 * as a reliable regression signal.
 *
 * Run: npx --yes tsx tests/scripts/fetch_labelary_text_fixtures.ts
 *
 * The script skips test cases whose fixture PNG already exists, so
 * re-runs only fetch new entries.
 */
import * as fs from 'fs';
import * as path from 'path';
import { textTestCases } from '../fixtures/textTestCases';
import { PRINTLAB_FONT_PATH } from '../lib/printLabFont';
const FIXTURES_DIR = path.resolve('tests/fixtures/labelary_text_images');
const FONT_UPLOAD_URL = 'http://api.labelary.com/v1/fonts';
const RENDER_URL = 'http://api.labelary.com/v1/printers/8dpmm/labels/4x4/0/';
const RATE_LIMIT_MS = 1000;

async function uploadFont(): Promise<string> {
  const file = fs.readFileSync(PRINTLAB_FONT_PATH);
  const form = new FormData();
  form.append('file', new Blob([file]), 'PrintLabZPL.ttf');
  form.append('path', 'R:PRINTLAB.TTF');
  console.log(`Uploading ${PRINTLAB_FONT_PATH} (${file.length} bytes) to Labelary...`);
  const res = await fetch(FONT_UPLOAD_URL, { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(`Font upload ${res.status}: ${await res.text()}`);
  }
  const zpl = await res.text();
  console.log(`Got ${zpl.length} chars of ~DU font-download ZPL back.`);
  return zpl;
}

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

async function main(): Promise<void> {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  // Decide upfront which cases are still missing — saves one font
  // upload if everything is already cached.
  const missing = textTestCases.filter(
    (tc) => !fs.existsSync(path.join(FIXTURES_DIR, `${tc.id}.png`)),
  );
  if (missing.length === 0) {
    console.log('All fixtures already present. Nothing to fetch.');
    return;
  }
  console.log(`Need to fetch ${missing.length} fixture(s).`);

  const fontDownloadZpl = await uploadFont();
  await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));

  for (const tc of missing) {
    const zpl =
      `^XA${fontDownloadZpl}^FO${tc.x},${tc.y}` +
      `^A@${tc.rotation},${tc.fontHeight},${tc.fontHeight},R:PRINTLAB.TTF` +
      `^FD${tc.text}^FS^XZ`;
    const png = await fetchLabel(zpl);
    const outPath = path.join(FIXTURES_DIR, `${tc.id}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`  ${tc.id}.png  (${png.length} bytes)`);
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`\nWrote ${missing.length} fixture(s) to ${FIXTURES_DIR}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
