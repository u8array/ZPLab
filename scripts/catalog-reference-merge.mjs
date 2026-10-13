#!/usr/bin/env node
// The only writer that may stamp a reference hash.
// Usage: node scripts/catalog-reference-merge.mjs todo <locale>            prints the blocks still to translate
//        node scripts/catalog-reference-merge.mjs merge <locale> <in.json>  writes them into src/locales/catalog/<locale>.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, commandId, readCatalog } from "./catalog.mjs";
import { referenceHash } from "./catalog-reference-hash.mjs";

const [mode, locale, input] = process.argv.slice(2);
if (!["todo", "merge"].includes(mode) || !locale || (mode === "merge" && !input)) throw new Error("usage: todo <locale> | merge <locale> <in.json>");
const catalog = readCatalog().commands.filter((c) => c.reference?.params.length);
const file = join(ROOT, "src", "locales", "catalog", `${locale}.json`);
const rows = JSON.parse(readFileSync(file, "utf8"));
const current = (c) => rows[commandId(c)]?.reference?.hash === referenceHash(c.reference);

if (mode === "todo") {
  const todo = Object.fromEntries(
    catalog.filter((c) => !current(c)).map((c) => [commandId(c), c.reference.params.map((p) => ({ name: p.name, meaning: p.meaning, values: p.values, ...(p.default ? { default: p.default } : {}) }))]),
  );
  process.stdout.write(JSON.stringify(todo, null, 1) + "\n");
} else {
  const translated = JSON.parse(readFileSync(input, "utf8"));
  const known = new Set(catalog.map(commandId));
  const unknown = Object.keys(translated).filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`no table to translate for ${unknown.join(", ")}`);
  for (const c of catalog) {
    const id = commandId(c);
    const params = translated[id];
    if (!params) continue;
    if (!rows[id]) throw new Error(`${id}: no summary row to attach the table to`);
    checkParams(id, params, c.reference.params);
    rows[id] = {
      ...rows[id],
      reference: { hash: referenceHash(c.reference), params: params.map((p) => ({ meaning: p.meaning, values: p.values, ...(p.default !== undefined ? { default: p.default } : {}) })) },
    };
  }
  // The catalog order keeps the diff readable. A row whose command left the catalog drops out.
  const ordered = Object.fromEntries(readCatalog().commands.map((c) => [commandId(c), rows[commandId(c)]]).filter(([, row]) => row));
  writeFileSync(file, JSON.stringify(ordered, null, 2) + "\n");
  console.log(`${locale}: ${Object.keys(translated).length} reference blocks written`);
}

function checkParams(id, params, english) {
  if (params.length !== english.length) throw new Error(`${id}: ${params.length} params, catalog has ${english.length}`);
  // Siblings often share values and default, so only the slot name tells a reordered table apart.
  params.forEach((p, i) => {
    if (p.name !== undefined && p.name !== english[i].name) throw new Error(`${id}: slot ${i} is ${p.name}, catalog has ${english[i].name}`);
    if (!p.meaning?.trim() || !p.values?.trim()) throw new Error(`${id} ${english[i].name}: empty meaning or values`);
    if ((p.default === undefined) !== (english[i].default === undefined)) throw new Error(`${id} ${english[i].name}: default presence differs from the catalog`);
  });
}
