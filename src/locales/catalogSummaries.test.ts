import { describe, it, expect } from "vitest";
import { ZPL_COMMANDS, commandId } from "@zplab/core/catalog";
import { LOCALE_CODES } from ".";
import { CATALOG_SUMMARY_LOCALES, loadCatalogSummaries } from "./catalogSummaries";
import { referenceHash, referenceTokens, textHash } from "../../scripts/catalog-reference-hash.mjs";

describe("catalog summary translations", () => {
  it("exist for every UI locale except en", () => {
    expect([...CATALOG_SUMMARY_LOCALES].sort()).toEqual(LOCALE_CODES.filter((c) => c !== "en").sort());
  });

  it("resolve en to the catalog's own text", async () => {
    expect(await loadCatalogSummaries("en")).toEqual({});
  });

  for (const locale of CATALOG_SUMMARY_LOCALES) {
    it(`${locale}: covers every command and was translated from the current English text`, async () => {
      const rows = await loadCatalogSummaries(locale);
      expect(Object.keys(rows)).toHaveLength(ZPL_COMMANDS.length);
      for (const entry of ZPL_COMMANDS) {
        const id = commandId(entry);
        const row = rows[id];
        expect(row, id).toBeDefined();
        // A hash mismatch means the English text moved on and this translation did not.
        expect(row?.hash, id).toBe(textHash(entry.summary));
        expect(row?.summary.trim(), id).not.toBe("");
        expect(row?.summary, id).not.toMatch(/[(;]|ZPLab/);
      }
    });

    it(`${locale}: translates every parameter table from the current English block and keeps its tokens`, async () => {
      const rows = await loadCatalogSummaries(locale);
      for (const entry of ZPL_COMMANDS) {
        if (!entry.reference?.params.length) continue;
        const id = commandId(entry);
        const table = rows[id]?.reference;
        expect(table, id).toBeDefined();
        expect(table?.hash, id).toBe(referenceHash(entry.reference));
        expect(table?.params, id).toHaveLength(entry.reference.params.length);
        entry.reference.params.forEach((p, i) => {
          const got = table?.params[i];
          expect(got?.meaning.trim(), `${id} ${p.name}`).not.toBe("");
          expect(got?.values.trim(), `${id} ${p.name}`).not.toBe("");
          expect(got?.default === undefined, `${id} ${p.name} default`).toBe(p.default === undefined);
          for (const field of ["values", "default"] as const) {
            const source = p[field];
            if (!source) continue;
            for (const token of referenceTokens(source)) expect(got?.[field], `${id} ${p.name} ${field}`).toContain(token);
          }
        });
      }
    });
  }
});
