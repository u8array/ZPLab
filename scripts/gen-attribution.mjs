// Generates THIRD-PARTY-LICENSES.md from the actual production dependency tree,
// so attribution stays exact as deps come and go. The npm section is derived
// from the scoped pnpm licenses read in lib/pnpm-licenses.mjs, reading each package's own license
// text out of its install path; the vendored-font notices (assets npm doesn't
// track) are read from src/assets/fonts so editing one is caught by the drift
// check too. The preamble and IBM Plex note live here as the source of truth.
//
//   node scripts/gen-attribution.mjs          # rewrite THIRD-PARTY-LICENSES.md
//   node scripts/gen-attribution.mjs --check  # fail if the committed file is stale
//
// Everything is sorted by codepoint and normalised to LF so the output is
// byte-identical across the Windows commit host and the Linux CI runner; that
// is what lets --check string-compare without false drift.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProdLicenses } from './lib/pnpm-licenses.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'THIRD-PARTY-LICENSES.md');
const FONTS_DIR = join(ROOT, 'src', 'assets', 'fonts');
const DATA_DIR = join(ROOT, 'scripts', 'data');

const PREAMBLE = `# Third-party licenses

ZPLab's own source is under the license in \`LICENSE\`. This file records
third-party material redistributed in the built app (\`dist/\`) and its
attribution terms, and it ships in \`dist/\` so the notices accompany the code
and fonts they cover. The npm section is generated from the production
dependency tree by \`scripts/gen-attribution.mjs\`; a \`pnpm attribution:check\`
gate (run in CI) fails the build if it drifts from the installed deps, and
\`pnpm licenses:check\` separately blocks any non-permissive license from
shipping.

To refresh after a dependency or font-notice change: \`pnpm attribution:gen\`.
`;

const FONTS_INTRO = `## Fonts

### IBM Plex Sans, IBM Plex Mono
Bundled via \`@fontsource/ibm-plex-sans\` and \`@fontsource/ibm-plex-mono\` (the
\`.woff2\` files ship in \`dist/\`). The OFL-1.1 license text is reproduced in the
npm section below under those packages.

Copyright (c) 2017 IBM Corp. with Reserved Font Name "IBM Plex", licensed under
the SIL Open Font License, Version 1.1 (OFL-1.1). OFL-1.1 permits bundling and
redistributing these fonts (including commercial, desktop/Tauri, and app-store
distribution) provided the copyright and license notice accompany them, the
fonts are not sold on their own, and the Reserved Font Name is not used for a
modified version. We do neither of the latter two.

### Vendored fonts (\`src/assets/fonts/\`)
Font files vendored directly (not npm packages) that ship in \`dist/\`. Each
notice is reproduced verbatim from its \`*-NOTICE.md\` source.`;

// A fenced block whose fence is longer than any backtick run inside the text,
// so a license body that itself contains ``` can't terminate the block early.
function fenced(text) {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

// Pick the license/notice file(s) inside a package dir. Names are sorted first
// so the choice is deterministic when several match (readdirSync order is
// OS-dependent). Apache requires the NOTICE file too, so it's appended.
function licenseTextFor(dir) {
  if (!dir) return null;
  let names;
  try { names = readdirSync(dir).sort(); } catch { return null; }
  const license = names.find((n) => /^(licen[sc]e|copying)/i.test(n));
  const notice = names.find((n) => /^notice/i.test(n));
  const parts = [];
  for (const n of [license, notice]) {
    if (!n) continue;
    try { parts.push(readFileSync(join(dir, n), 'utf8').trimEnd()); } catch { /* unreadable */ }
  }
  return parts.length ? parts.join('\n\n---\n\n') : null;
}

function fontsSection() {
  let files;
  try { files = readdirSync(FONTS_DIR).filter((n) => /NOTICE\.md$/.test(n)).sort(); } catch { files = []; }
  const blocks = [FONTS_INTRO];
  for (const f of files) {
    const text = readFileSync(join(FONTS_DIR, f), 'utf8').trimEnd();
    blocks.push(`#### ${f}\n\n${fenced(text)}`);
  }
  return blocks.join('\n\n');
}

// Vendored data files (not npm packages) whose derived output ships in the
// bundle, e.g. the GS1 Syntax Dictionary behind the generated AI catalog.
function dataSection() {
  let files;
  try { files = readdirSync(DATA_DIR).filter((n) => /NOTICE\.md$/.test(n)).sort(); } catch { files = []; }
  if (files.length === 0) return null;
  const blocks = [
    `## Vendored data (\`scripts/data/\`)\n\nData files vendored directly (not npm packages) whose derived artifacts ship\nin \`dist/\`. Each notice is reproduced verbatim from its \`*-NOTICE.md\` source.`,
  ];
  for (const f of files) {
    const text = readFileSync(join(DATA_DIR, f), 'utf8').trimEnd();
    blocks.push(`#### ${f}\n\n${fenced(text)}`);
  }
  return blocks.join('\n\n');
}

function npmSection() {
  const byLicense = readProdLicenses();
  const pkgs = [];
  for (const list of Object.values(byLicense)) for (const e of list) pkgs.push(e);
  // Codepoint sort (not localeCompare, which is ICU/locale-dependent).
  pkgs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const blocks = [`## npm dependencies\n\n${pkgs.length} production packages ship in the bundle, each listed with its\nSPDX license and the verbatim license text from its package.`];
  for (const p of pkgs) {
    const lines = [`### ${p.name} ${(p.versions || []).join(', ')}`, '', `- License: ${p.license || '(none)'}`];
    if (p.author) lines.push(`- Author: ${p.author}`);
    if (p.homepage) lines.push(`- Homepage: ${p.homepage}`);
    const path = (p.paths || []).slice().sort()[0] || '';
    const text = licenseTextFor(path);
    lines.push('', fenced(text || '(no license file found in package)'));
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function render() {
  const body = [PREAMBLE, fontsSection(), dataSection(), npmSection()]
    .filter(Boolean)
    .join('\n');
  // Single LF normalisation so the committed file is byte-stable regardless of
  // the checkout's line endings (core.autocrlf) or a vendored file's endings.
  return body.replace(/\r\n?/g, '\n').trimEnd() + '\n';
}

const content = render();

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing -> stale */ }
  if (current.replace(/\r\n?/g, '\n') !== content) {
    console.error('THIRD-PARTY-LICENSES.md is stale. Run `pnpm attribution:gen` and commit the result.');
    process.exit(1);
  }
  console.log('Attribution check passed: THIRD-PARTY-LICENSES.md matches the production dependency tree.');
} else {
  writeFileSync(OUT, content);
  console.log(`Wrote ${OUT}`);
}
