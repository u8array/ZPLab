// Generates the README Coverage table from docs/zpl-roadmap.md, so the
// per-category counts and the "N of M" headline can't drift from the roadmap
// ticks by hand. The roadmap is the single source of truth; this only reads
// files off disk (static regex scan, no import of src/ and no app code runs).
//
//   node scripts/gen-coverage.mjs          # rewrite the README coverage block
//   node scripts/gen-coverage.mjs --check  # fail if README is stale vs the roadmap
//
// A best-effort code cross-check (roadmap `[x]` with no command literal anywhere
// in src/) prints advisory warnings but never fails; the source/handler mapping
// is honestly ambiguous (barcodes in registry, layout in the parser, config
// elsewhere), so it informs rather than gates.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROADMAP = join(ROOT, 'docs', 'zpl-roadmap.md');
const README = join(ROOT, 'README.md');
const SRC_ROOTS = [join(ROOT, 'src'), join(ROOT, 'packages', 'core', 'src')];

// README row order and how each maps onto roadmap `## sections`. Most are 1:1;
// the hardware bucket collapses four infrastructure sections into one row. Every
// roadmap section (bar the legend) must be claimed here exactly once, else the
// completeness assertion below fails rather than silently dropping a section.
const README_ROWS = [
  { label: 'Layout & flow', sections: ['Layout & flow'] },
  { label: 'Templates & variables', sections: ['Templates & variables'] },
  { label: 'Barcodes', sections: ['Barcodes'] },
  { label: 'Fields', sections: ['Fields'] },
  { label: 'Serialisation', sections: ['Serialisation'] },
  { label: 'Encoding & language', sections: ['Encoding & language'] },
  { label: 'Clock & time', sections: ['Clock & time'] },
  { label: 'Identity & access', sections: ['Identity & access'] },
  { label: 'Graphics', sections: ['Graphics'] },
  { label: 'Media & feed', sections: ['Media & feed'] },
  { label: 'Text & fonts', sections: ['Text & fonts'] },
  { label: 'Print quality', sections: ['Print quality'] },
  { label: 'Configuration & persistence', sections: ['Configuration & persistence'] },
  {
    label: 'Hardware / Host comm / RFID / Network',
    sections: ['Hardware control & calibration', 'Host communication', 'RFID', 'Network'],
  },
];

// A row counts only if it carries both a status cell and a command-token cell,
// so the status-legend and bucket example tables (prose second cell) are skipped.
const ROW_RE = /^\|\s*`\[([ x])\]`\s*\|\s*`([~^][A-Z0-9@]+)`/;

// The roadmap is a full partition of the ZPL II guide's commands;
// a row added or removed MUST consciously move this number.
const TRACKED_TOTAL = 225;

/** Parse the roadmap into { section -> { supported, total, cmds:[{cmd,ok}] } }. */
function parseRoadmap() {
  const lines = readFileSync(ROADMAP, 'utf8').split(/\r?\n/);
  const sections = new Map();
  let section = null;
  for (const line of lines) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { section = h[1]; continue; }
    const m = ROW_RE.exec(line);
    if (!m || !section) continue;
    const ok = m[1] === 'x';
    if (!sections.has(section)) sections.set(section, { supported: 0, total: 0, cmds: [] });
    const s = sections.get(section);
    s.total++; if (ok) s.supported++;
    s.cmds.push({ cmd: m[2], ok });
  }
  const total = [...sections.values()].reduce((n, s) => n + s.total, 0);
  if (total !== TRACKED_TOTAL) {
    console.error(
      `roadmap tracks ${total} commands, pin says ${TRACKED_TOTAL}; ` +
      'update TRACKED_TOTAL only for a deliberate row change',
    );
    process.exit(1);
  }
  return sections;
}

/** Fail loudly if the roadmap and README_ROWS mapping have diverged. */
function assertMappingComplete(sections) {
  const claimed = new Map();
  for (const row of README_ROWS) for (const s of row.sections) claimed.set(s, row.label);
  const errors = [];
  for (const s of sections.keys()) {
    if (!claimed.has(s)) errors.push(`roadmap section "${s}" is not mapped to any README row`);
  }
  for (const s of claimed.keys()) {
    if (!sections.has(s)) errors.push(`README_ROWS references "${s}", absent from the roadmap`);
  }
  if (errors.length) {
    console.error('Coverage mapping is out of date:\n  ' + errors.join('\n  '));
    process.exit(1);
  }
}

function renderBlock(sections) {
  let grandS = 0, grandT = 0;
  const rows = README_ROWS.map((row) => {
    let s = 0, t = 0;
    for (const name of row.sections) { const sec = sections.get(name); s += sec.supported; t += sec.total; }
    grandS += s; grandT += t;
    return `| ${row.label} | ${s} / ${t} |`;
  });
  return [
    '<!-- coverage:start (generated from docs/zpl-roadmap.md by scripts/gen-coverage.mjs; run `pnpm coverage:gen`) -->',
    `${grandS} of the ${grandT} ZPL II commands tracked in the [roadmap](docs/zpl-roadmap.md) are supported today. Categorical breakdown:`,
    '',
    '| Area | Supported |',
    '|---|---|',
    ...rows,
    '<!-- coverage:end -->',
  ].join('\n');
}

/** Splice the freshly rendered block into the marked README region. */
function spliceReadme(current, block) {
  const re = /<!-- coverage:start[\s\S]*?<!-- coverage:end -->/;
  if (!re.test(current)) {
    console.error('README.md has no <!-- coverage:start -->/<!-- coverage:end --> markers. Add them around the coverage table.');
    process.exit(1);
  }
  return current.replace(re, block);
}

/** Advisory only: roadmap `[x]` commands with no literal anywhere in src/. */
function codeCrossCheck(sections) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(p);
    }
  }
  SRC_ROOTS.forEach(walk);
  const haystack = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const missing = [];
  for (const sec of sections.values()) {
    for (const { cmd, ok } of sec.cmds) {
      if (ok && !haystack.includes(cmd)) missing.push(cmd);
    }
  }
  if (missing.length) {
    console.warn(`Advisory: ${missing.length} roadmap [x] command(s) have no literal in src/ (mapping may be indirect): ${[...new Set(missing)].sort().join(', ')}`);
  }
}

const sections = parseRoadmap();
assertMappingComplete(sections);
const block = renderBlock(sections);
const current = readFileSync(README, 'utf8');
const next = spliceReadme(current, block).replace(/\r\n?/g, '\n');

if (process.argv.includes('--check')) {
  codeCrossCheck(sections);
  if (current.replace(/\r\n?/g, '\n') !== next) {
    console.error('README.md coverage table is stale. Run `pnpm coverage:gen` and commit the result.');
    process.exit(1);
  }
  console.log('Coverage check passed: README table matches docs/zpl-roadmap.md.');
} else {
  codeCrossCheck(sections);
  writeFileSync(README, next);
  console.log(`Wrote coverage table into ${README}`);
}
