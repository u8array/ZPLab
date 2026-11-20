import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { importSpecs } from "@zplab/headless/testing";

// The server reaches core only through the facade, so a second ZPL entry point cannot appear here.
// The allowlist makes a new dependency as deliberate as in package.json.
const ALLOWED = [/^\.\//, /^node:/, /^hono(\/|$)/, /^@hono\//, /^zod$/, /^@zplab\/headless(\/testing)?$/, /^vitest$/];

describe("server import contract", () => {
  it("every import is the facade, hono, zod, node or a sibling module", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(3);
    const offenders = files.flatMap((f) =>
      importSpecs(readFileSync(join(dir, f), "utf8"))
        .filter((spec) => !ALLOWED.some((re) => re.test(spec)))
        .map((spec) => `${f} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
