import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { importSpecs } from "@zplab/headless/testing";

// The sidecar consumes the headless facade, core and its declared runtime
// deps; the allowlist makes adding a dependency as deliberate as in package.json.
const ALLOWED = [
  /^\.\//,
  /^@zplab\/core\//,
  /^@zplab\/headless(\/testing)?$/,
  /^node:/,
  /^zod$/,
  /^@modelcontextprotocol\/sdk\//,
  /^vitest$/,
];

describe("mcp-server import contract", () => {
  it("every import is core, node, or a declared dependency", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.flatMap((f) =>
      importSpecs(readFileSync(join(dir, f), "utf8"))
        .filter((spec) => !ALLOWED.some((re) => re.test(spec)))
        .map((spec) => `${f} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
