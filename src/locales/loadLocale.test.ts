import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "./en";
import { isLocaleCode, LOCALE_CODES, loadLocale, localeOptions } from "./index";

/** Dotted key paths of every leaf; arrays count as leaves. */
function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/** The leaf a dotted path names. */
function leafAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], obj);
}

const enKeys = keyPaths(en as unknown as Record<string, unknown>).sort();
const placeholders = (value: unknown) => String(value).match(/\{\w+\}/g)?.sort() ?? [];
const placeholderPaths = enKeys.map((path) => [path, placeholders(leafAt(en, path))] as const).filter(([, found]) => found.length > 0);

describe("locale registry", () => {
  it("offers every locale under a label no other locale uses", () => {
    const labels = localeOptions().map((o) => o.label);
    expect(labels.length).toBe(LOCALE_CODES.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).toMatch(/\S/);
  });

  // The loader map is the only place a code meets its file, and a dynamic import
  // cannot be asked which module it names, so the source line is the evidence.
  it.each(["index.ts", "catalogSummaries.ts"])("%s loads each code from the file of the same name", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const loaders = [...source.matchAll(/^\s+["']?([a-z-]+)["']?: \(\) => import\(["'](.+?)["']\)/gm)];
    expect(loaders.length, file).toBe(LOCALE_CODES.length - 1);
    for (const [, code, path] of loaders) expect(path?.replace(/^\.\/(?:catalog\/)?|\.json$/g, ""), file).toBe(code);
  });

  it("loads a dictionary of its own for every locale", { timeout: 10_000 }, async () => {
    const dictionaries = await Promise.all(LOCALE_CODES.map((code) => loadLocale(code)));
    expect(new Set(dictionaries).size).toBe(LOCALE_CODES.length);
  });

  it("caches loaded locales (same identity on repeat loads)", async () => {
    const a = await loadLocale("de");
    const b = await loadLocale("de");
    expect(b).toBe(a);
  });

  it("rejects prototype keys as locale codes", () => {
    expect(isLocaleCode("constructor")).toBe(false);
    expect(isLocaleCode("toString")).toBe(false);
    expect(isLocaleCode("de")).toBe(true);
  });

  // Own timeout: the first load of a locale is a dynamic import, transform-bound
  // once the rest of the suite runs alongside.
  it.each(LOCALE_CODES)("%s matches the en key structure exactly", { timeout: 10_000 }, async (code) => {
    // Replaces the compile-time guarantee the old eager map gave implicitly.
    const t = await loadLocale(code);
    expect(keyPaths(t as unknown as Record<string, unknown>).sort()).toEqual(enKeys);
  });

  it.each(LOCALE_CODES)("%s translates every string to a non-empty one", async (code) => {
    const t = await loadLocale(code);
    for (const path of enKeys) expect(String(leafAt(t, path)).trim(), path).not.toBe("");
  });

  it.each(LOCALE_CODES)("%s keeps each placeholder of the English string", async (code) => {
    const t = await loadLocale(code);
    for (const [path, expected] of placeholderPaths) expect(placeholders(leafAt(t, path)), path).toEqual(expected);
  });
});
