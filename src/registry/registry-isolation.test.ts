import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
// Panels pull in Headless UI, whose react-aria dep runs global focus setup at
// import and needs DOM globals (this suite is node-env, key checks only, never
// renders). Stub it so the import chain stays node-safe.
vi.mock("@headlessui/react", () => {
  const Stub = () => null;
  return { Listbox: Stub, ListboxButton: Stub, ListboxOptions: Stub, ListboxOption: Stub };
});
import { ObjectRegistry, BARCODE_1D_TYPES, STACKED_2D_TYPES } from "@zplab/core/registry";
import { ObjectPanels } from "./panels";

describe("registry isolation baseline", () => {
  // fieldPos1d emits the gated printer anchor; a non-1d emitter calling it
  // would disagree with the BARCODE_1D_TYPES guards in home-shift/preflight.
  it("every emitter calling fieldPos1d is a 1d-class symbology", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../packages/core/src/registry");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "zplHelpers.ts")
      .filter((f) => {
        const src = readFileSync(join(dir, f), "utf-8");
        return src.includes("fieldPos1d(") && !src.includes("barcodeClass: '1d'");
      });
    expect(offenders).toEqual([]);
  });


  it("registers 34 object types", () => {
    expect(Object.keys(ObjectRegistry)).toHaveLength(34);
  });

  // Exact membership, not just size: the sets are derived from each entry's
  // barcodeClass, and emit/rotation/bounds read them, so a reclassified or
  // forgotten type must fail loudly here, not degrade silently on canvas.
  it("classifies the 1D barcodes by barcodeClass", () => {
    expect([...BARCODE_1D_TYPES].sort()).toEqual([
      "codabar", "code11", "code128", "code39", "code49", "code93", "ean13",
      "ean8", "gs1databar", "industrial2of5", "interleaved2of5", "logmars",
      "msi", "planet", "plessey", "postal", "standard2of5", "upcEanExtension",
      "upca", "upce",
    ]);
  });

  it("classifies the stacked 2D barcodes by barcodeClass", () => {
    expect([...STACKED_2D_TYPES].sort()).toEqual(["codablock", "micropdf417", "pdf417"]);
  });

  it("Core and Panels maps stay key-parallel", () => {
    expect(Object.keys(ObjectPanels).sort()).toEqual(
      Object.keys(ObjectRegistry).sort(),
    );
  });

  it("no Core entry carries a PropertiesPanel field", () => {
    for (const [type, entry] of Object.entries(ObjectRegistry)) {
      expect(entry, `Core entry for "${type}"`).not.toHaveProperty(
        "PropertiesPanel",
      );
    }
  });

  // Specs cover every import form (static `from`, side-effect, dynamic import())
  // so a breach can't hide behind an unscanned form; both tests below share
  // this ban list so their coverage can't drift apart.
  const importSpecs = (src: string): string[] => [
    ...[...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? ""),
    ...[...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? ""),
    ...[...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? ""),
  ];
  const bannedExternal = /^(react($|[-/])|zustand|konva|@headlessui\/|@heroicons\/)/;
  const bannedInternal = /(^|\/)(components|store|hooks)\/|\.panel($|\/)|\/panels$|panelTypes/;
  const banned = (spec: string) =>
    spec.startsWith(".") ? bannedInternal.test(spec) : bannedExternal.test(spec);

  // The domain graph's promise is emit/import/batch without React (CLI/Tauri).
  // Source-scan the core modules (types/ plus the non-panel registry .ts files)
  // so a react/store/panel import can't sneak back in behind the type split.
  it("core type graph stays free of react, store and panel imports", () => {
    const registryDir = fileURLToPath(new URL("../../packages/core/src/registry/", import.meta.url));
    const typesDir = fileURLToPath(new URL("../../packages/core/src/types/", import.meta.url));
    const coreFiles = [
      ...readdirSync(typesDir)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => join(typesDir, f)),
      ...readdirSync(registryDir)
        .filter(
          (f) =>
            f.endsWith(".ts") &&
            !f.endsWith(".test.ts") &&
            f !== "panels.ts" &&
            f !== "panelTypes.ts",
        )
        .map((f) => join(registryDir, f)),
    ];
    expect(coreFiles.length).toBeGreaterThan(30);
    for (const file of coreFiles) {
      expect(importSpecs(readFileSync(file, "utf8")).filter(banned), basename(file)).toEqual([]);
    }
  });

  // Unlike the flat scan above, this walks the transitive import closure of
  // the domain entrypoints, so the CLI/Tauri promise (emit/parse without
  // React, store or UI) holds across everything they pull from lib/ too.
  it("emit/parse import closure stays free of react, store and UI imports", () => {
    const srcDir = fileURLToPath(new URL("../../packages/core/src/", import.meta.url));
    // The lib/ entries beyond the emit/parse pair are headless entry points
    // (MCP server, source-edit) sitting ABOVE their closure (nothing in it
    // imports these back), so each must be listed explicitly or the scan
    // never reaches it.
    const entries = [
      "lib/zplGenerator.ts",
      "lib/zplParser.ts",
      "lib/zplImportService.ts",
      "lib/objectOverlap.ts",
      "lib/designFile.ts",
      "lib/preflight.ts",
      "lib/barcodeEncodePreflight.ts",
      "lib/anchorRepin.ts",
      "lib/templateObjects.ts",
      "lib/zplSourceEdit.ts",
      "registry/index.ts",
    ];
    // A spec that names its extension resolves as written; anything else tries
    // ts/tsx and directory-index forms. Returning null is NOT a skip: the
    // caller flags it, so the walk can never silently shrink the closure.
    const resolveRel = (fromFile: string, spec: string): string | null => {
      const base = join(dirname(fromFile), spec);
      const cands = /\.tsx?$/.test(spec)
        ? [base]
        : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
      for (const cand of cands) {
        if (existsSync(cand)) return cand;
      }
      return null;
    };
    const seen = new Set<string>();
    const queue = entries.map((e) => join(srcDir, e));
    const offenders: string[] = [];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of importSpecs(readFileSync(file, "utf8"))) {
        if (banned(spec)) {
          offenders.push(`${basename(file)} -> ${spec}`);
          continue;
        }
        if (!spec.startsWith(".")) continue;
        const resolved = resolveRel(file, spec);
        if (!resolved) offenders.push(`${basename(file)} -> ${spec} (unresolved)`);
        else if (resolved.endsWith(".tsx")) offenders.push(`${basename(file)} -> ${spec} (tsx)`);
        else queue.push(resolved);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(offenders).toEqual([]);
  });
});
