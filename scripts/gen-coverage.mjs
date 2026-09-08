// Renders the coverage tables of docs/zpl-coverage.md and the README block from
// the command catalog (packages/core/src/catalog/commands.json), so the docs and
// the app cannot disagree. Prose outside the markers stays hand-written.
//
//   node scripts/gen-coverage.mjs          # rewrite both files
//   node scripts/gen-coverage.mjs --check  # fail if either is stale vs the catalog
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, commandId, commandIds, readCatalog } from './catalog.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOC = join(ROOT, 'docs', 'zpl-coverage.md');
const README = join(ROOT, 'README.md');
const SRC_ROOTS = [join(ROOT, 'src'), join(ROOT, 'packages', 'core', 'src')];
const MARK = { yes: '[x]', planned: '[~]', no: '[ ]' };
const CAPABILITY_LABEL = { web: 'Web', desktop: 'Desktop', lint: 'Lint' };
/** README shows one figure per area: web-modelled commands, which the desktop build always covers too. */
const README_COLUMN = 'web';

// README row order and how each maps onto catalog sections; a row without a label
// takes its single section's name. The hardware bucket collapses four sections.
const README_ROWS = [
  { sections: ['Layout & flow'] },
  { sections: ['Templates & variables'] },
  { sections: ['Barcodes'] },
  { sections: ['Fields'] },
  { sections: ['Serialisation'] },
  { sections: ['Encoding & language'] },
  { sections: ['Clock & time'] },
  { sections: ['Identity & access'] },
  { sections: ['Graphics'] },
  { sections: ['Media & feed'] },
  { sections: ['Text & fonts'] },
  { sections: ['Print quality'] },
  { sections: ['Configuration & persistence'] },
  {
    label: 'Hardware / Host comm / RFID / Network',
    sections: ['Hardware control & calibration', 'Host communication', 'RFID', 'Network'],
  },
];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/** Every catalog section claimed by exactly one README row, and every claimed section present. */
function assertMappingComplete(catalog) {
  const claims = new Map();
  for (const row of README_ROWS) for (const s of row.sections) claims.set(s, (claims.get(s) ?? 0) + 1);
  const errors = README_ROWS.filter((row) => row.sections.length > 1 && !row.label).map((row) => `README row over ${row.sections.join(', ')} needs a label`);
  for (const { name } of catalog.sections) {
    const n = claims.get(name) ?? 0;
    if (n !== 1) errors.push(`catalog section "${name}" is claimed by ${n} README rows`);
  }
  for (const s of claims.keys()) {
    if (!catalog.sections.some((sec) => sec.name === s)) errors.push(`README_ROWS references "${s}", absent from the catalog`);
  }
  if (errors.length) fail('Coverage mapping is out of date:\n  ' + errors.join('\n  '));
}

const capabilityHeader = (lead) => [`| ${lead} | ${CAPABILITIES.map((cap) => CAPABILITY_LABEL[cap]).join(' | ')} |`, `|${lead.split('|').map(() => '---').join('|')}|${CAPABILITIES.map(() => ':-:').join('|')}|`];

function renderDocTables(catalog) {
  const out = [];
  for (const section of catalog.sections) {
    out.push(`## ${section.name}`, '');
    if (section.intro) out.push(...section.intro, '');
    out.push(...capabilityHeader('Command | Name'));
    for (const entry of catalog.commands.filter((e) => e.section === section.name)) {
      const cell = commandIds(entry).map((id) => `\`${id}\``).join(' / ');
      out.push(`| ${cell} | ${entry.title} | ${CAPABILITIES.map((cap) => `\`${MARK[entry.support[cap]]}\``).join(' | ')} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

const count = (entries, cap, level) => entries.filter((e) => e.support[cap] === level).length;

/** Compact README summary; the per-area table below carries the web figure only. */
function readmeIntro(commands) {
  const total = commands.length;
  const web = count(commands, 'web', 'yes');
  const desktopExtra = count(commands, 'desktop', 'yes') - web;
  const desktopPlanned = count(commands, 'desktop', 'planned');
  const lint = count(commands, 'lint', 'yes');
  const modelled = desktopExtra
    ? `${web} of the ${total} ZPL II commands are modelled in the browser; desktop covers ${desktopExtra} more with a connected printer.`
    : `${web} of the ${total} ZPL II commands are modelled in both the web and desktop builds.`;
  const planned = desktopPlanned ? `Another ${desktopPlanned} printer-side commands are planned for desktop.` : '';
  const linting = lint ? `The source editor checks parameters for ${lint} commands.` : 'The source editor does not lint command parameters yet.';
  return [modelled, planned, linting, 'See per-command coverage: [docs/zpl-coverage.md](docs/zpl-coverage.md).'].filter(Boolean).join(' ');
}

function renderReadmeBlock(catalog) {
  const rows = README_ROWS.map((row) => {
    const entries = catalog.commands.filter((e) => row.sections.includes(e.section));
    return `| ${row.label ?? row.sections[0]} | ${count(entries, README_COLUMN, 'yes')} / ${entries.length} |`;
  });
  return [readmeIntro(catalog.commands), '', '| Area | Modelled |', '|---|---|', ...rows, ''].join('\n');
}

/** Replace the lines between the coverage markers of `text`; both marker lines stay. */
function spliceCoverageBlock(text, block, fileForError) {
  const starts = [...text.matchAll(/^<!-- coverage:start.*$/gm)];
  const ends = [...text.matchAll(/^<!-- coverage:end -->$/gm)];
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    fail(`${fileForError} needs exactly one <!-- coverage:start --> line followed by one <!-- coverage:end --> line`);
  }
  const startLineEnd = starts[0].index + starts[0][0].length + 1;
  return text.slice(0, startLineEnd) + block + text.slice(ends[0].index);
}

/** Advisory only: web-supported commands with no literal anywhere in src/. */
function codeCrossCheck(catalog) {
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
  const missing = catalog.commands.filter((e) => e.support.web === 'yes' && !haystack.includes(commandId(e))).map(commandId);
  if (missing.length) {
    console.warn(`Advisory: ${missing.length} web-supported command(s) have no literal in src/ (mapping may be indirect): ${[...new Set(missing)].sort().join(', ')}`);
  }
}

let catalog;
try {
  catalog = readCatalog();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
assertMappingComplete(catalog);
// A Windows checkout carries CRLF; git normalises on commit, so compare on LF.
const lf = (s) => s.replace(/\r\n?/g, '\n');
const targets = [
  { file: DOC, current: lf(readFileSync(DOC, 'utf8')), block: renderDocTables(catalog) },
  { file: README, current: lf(readFileSync(README, 'utf8')), block: renderReadmeBlock(catalog) },
].map((target) => ({ ...target, next: spliceCoverageBlock(target.current, target.block, target.file) }));

codeCrossCheck(catalog);
if (process.argv.includes('--check')) {
  const stale = targets.filter((target) => target.next !== target.current).map((target) => target.file);
  if (stale.length) fail(`stale vs the command catalog, run \`pnpm coverage:gen\`: ${stale.join(', ')}`);
  console.log('Coverage check passed: docs and README match the command catalog.');
} else {
  for (const target of targets) writeFileSync(target.file, target.next);
  console.log('Coverage tables rewritten from the catalog.');
}
