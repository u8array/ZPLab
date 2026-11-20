import { describe, it, expect } from "vitest";
import { importSpecs } from "./testing";

// The facade runs anywhere @zplab/core runs: no node builtins and no transport
// SDK, so the MCP server, the REST server and a browser can all consume it.
const ALLOWED = [/^\.\//, /^@zplab\/core\//, /^zod$/, /^bwip-js\//, /^vitest$/];

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

  it("the scanner reads static, re-export, side-effect and dynamic imports and skips prose naming a static import", () => {
    const src = [
      "import a from './a';",
      "export { b } from './b';",
      "import './c';",
      "const d = await import('./d');",
      "// say import x from './prose' in a comment",
      "// then import './prose2' first",
    ].join("\n");
    expect(importSpecs(src)).toEqual(["./a", "./b", "./c", "./d"]);
  });
});
