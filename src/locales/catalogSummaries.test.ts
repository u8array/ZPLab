import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { ZPL_COMMANDS, commandId } from "@zplab/core/catalog";
import { LOCALE_CODES } from ".";
import { CATALOG_SUMMARY_LOCALES, loadCatalogSummaries } from "./catalogSummaries";

const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 8);

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
        expect(row?.hash, id).toBe(hashOf(entry.summary));
        expect(row?.summary.trim(), id).not.toBe("");
        expect(row?.summary, id).not.toMatch(/[(;]|ZPLab/);
      }
    });
  }
});
