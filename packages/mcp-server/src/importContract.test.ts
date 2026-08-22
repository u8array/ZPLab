import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// The sidecar consumes @zplab/core only, plus its declared runtime deps; the
// allowlist makes adding a dependency here as deliberate as in package.json.
const ALLOWED = [
  /^\.\//,
  /^@zplab\/core\//,
  /^node:/,
  /^zod$/,
  /^@modelcontextprotocol\/sdk\//,
  /^bwip-js\//,
  /^vitest$/,
];

// All import forms (static `from`, side-effect, dynamic import()), so a breach
// can't hide behind an unscanned form.
const importSpecs = (src: string): string[] => [
  // The closing `";` keeps prose like `"... from " +` in tool descriptions out.
  ...[...src.matchAll(/from\s+['"]([^'"]+)['"];/g)].map((m) => m[1] ?? ""),
  ...[...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? ""),
  ...[...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? ""),
];

describe("mcp-server import contract", () => {
  it("every import is core, node, or a declared dependency", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(15);
    const offenders = files.flatMap((f) =>
      importSpecs(readFileSync(join(dir, f), "utf8"))
        .filter((spec) => !ALLOWED.some((re) => re.test(spec)))
        .map((spec) => `${f} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
