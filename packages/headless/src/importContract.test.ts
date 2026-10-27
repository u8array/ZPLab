import { describe, it, expect } from "vitest";

// The facade runs anywhere @zplab/core runs: no node builtins and no transport
// SDK, so the MCP server, the REST server and a browser can all consume it.
const ALLOWED = [/^\.\//, /^@zplab\/core\//, /^zod$/, /^bwip-js\//, /^vitest$/];

// All import forms (static `from`, re-export `from`, side-effect, dynamic
// import()). A static form is matched from its line start, so quoted prose never counts.
const importSpecs = (src: string): string[] => [
  ...[...src.matchAll(/^(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? ""),
  ...[...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? ""),
  ...[...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? ""),
];

// Read through the bundler, so this test needs no node builtin either and the
// package type-checks against the browser lib alone.
const sources = import.meta.glob("./**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("headless import contract", () => {
  it("every import is core, zod, bwip-js or a sibling module", () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.flatMap((f) =>
      importSpecs(sources[f] ?? "")
        .filter((spec) => !ALLOWED.some((re) => re.test(spec)))
        .map((spec) => `${f} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
