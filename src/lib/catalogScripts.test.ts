// The node-only coverage script cannot import core, so it carries twins of the id
// derivations; this pins them to the originals for every catalog entry.
import { describe, it, expect } from "vitest";
import { ZPL_COMMANDS, commandId, commandIds } from "@zplab/core/catalog";
import { commandId as scriptCommandId, commandIds as scriptCommandIds, readCatalog } from "../../scripts/catalog.mjs";

describe("coverage script twins", () => {
  it("spell every id exactly like core", () => {
    for (const entry of ZPL_COMMANDS) {
      expect(scriptCommandId(entry)).toBe(commandId(entry));
      expect(scriptCommandIds(entry)).toEqual(commandIds(entry));
    }
  });

  it("read the same catalog core bundles", () => {
    expect(readCatalog().commands).toEqual(ZPL_COMMANDS);
  });
});
