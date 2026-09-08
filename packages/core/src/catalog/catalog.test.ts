import { describe, it, expect } from "vitest";
import raw from "./commands.json";
import { catalogSchema } from "./schema";
import { CATALOG_SECTIONS, ZPL_COMMANDS, catalogEntry, commandId, commandIds, filterCatalog } from "./index";

describe("zpl command catalog", () => {
  it("validates the checked-in data against the schema", () => {
    const result = catalogSchema.safeParse(raw);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it("tracks the whole ZPL II guide: unique ids, grouped by section in section order", () => {
    // Adding or removing a command is a deliberate act that must move this pin.
    expect(ZPL_COMMANDS).toHaveLength(225);
    const ids = ZPL_COMMANDS.flatMap(commandIds);
    expect(new Set(ids).size).toBe(ids.length);
    // The panel walks the array with the arrow keys in the order the sections render.
    const runs = ZPL_COMMANDS.map((c) => c.section).filter((s, i, all) => i === 0 || s !== all[i - 1]);
    expect(runs).toEqual(CATALOG_SECTIONS.map((s) => s.name));
  });

  it("keeps every title a short plain phrase without parentheses", () => {
    // A name, not a sentence: the panel shows it beside the command, and the en text is what translations hash against.
    const TITLE_WORD_CAP = 8;
    for (const c of ZPL_COMMANDS) {
      expect(c.title.split(/\s+/).length, c.cmd).toBeLessThanOrEqual(TITLE_WORD_CAP);
      // No parentheses by house style; a pipe would split the generated markdown row.
      expect(c.title, c.cmd).not.toMatch(/[()|]/);
      // ASCII only, so no typographic quotes or dashes travel into 32 translations.
      expect(c.title, c.cmd).not.toMatch(/[^\x20-\x7E]/);
      expect(c.title, c.cmd).not.toMatch(/ZPLab|supported/i);
    }
  });

  it("never claims less on desktop than on the web, and names why a row is out of scope", () => {
    const rank = { no: 0, planned: 1, yes: 2 } as const;
    for (const c of ZPL_COMMANDS) {
      expect(rank[c.support.desktop], c.cmd).toBeGreaterThanOrEqual(rank[c.support.web]);
      // The coverage legend promises the reason in the name: a qualifier after a comma.
      if (Object.values(c.support).every((level) => level === "no")) expect(c.title, c.cmd).toMatch(/,/);
    }
  });

  it("resolves prefixed, bare and alias lookups", () => {
    expect(catalogEntry("^LL")?.title).toBe("label length");
    expect(catalogEntry("ll")?.cmd).toBe("LL");
    expect(catalogEntry("^BO")?.cmd).toBe("B0");
    expect(catalogEntry("~HL")).toBe(catalogEntry("^HL"));
    expect(commandId(catalogEntry("~HL")!)).toBe("^HL");
    // Prefix twins with diverging support are separate entries.
    expect(catalogEntry("^PH")?.support).toEqual({ web: "yes", desktop: "yes", lint: "no" });
    expect(catalogEntry("~PH")?.support).toEqual({ web: "no", desktop: "planned", lint: "no" });
    expect(catalogEntry("^QQ")).toBeUndefined();
  });

  it("folds the device-font selectors onto the generic ^A entry", () => {
    expect(catalogEntry("^AB")?.cmd).toBe("A");
    expect(catalogEntry("^A9")?.cmd).toBe("A");
    expect(catalogEntry("^A0")?.cmd).toBe("A0");
    expect(catalogEntry("^A@")?.cmd).toBe("A@");
    expect(catalogEntry("^A?")).toBeUndefined();
    // The face substitution the import report names applies to every selector of the family.
    expect(catalogEntry("^AM")?.loss).toBe("fontFace");
    expect(filterCatalog("^AB").map((e) => e.cmd)).toContain("A");
  });

  it("searches by name with or without prefix, by alias and title", () => {
    expect(filterCatalog("^LL").map((e) => e.cmd)).toEqual(["LL"]);
    // Twins with different meanings per prefix: a typed prefix must not surface the other one.
    expect(filterCatalog("^JS").map(commandId)).toEqual(["^JS"]);
    expect(filterCatalog("~JS").map(commandId)).toEqual(["~JS"]);
    expect(filterCatalog("JS").map(commandId).sort()).toEqual(["^JS", "~JS"]);
    // The title branch must not leak the twin either.
    expect(filterCatalog("^PH").map(commandId)).toEqual(["^PH"]);
    expect(filterCatalog("~PH").map(commandId)).toEqual(["~PH"]);
    expect(filterCatalog("^A").map(commandId)).not.toContain("^WD");
    // The exported spellings carry a device letter and a colon.
    expect(filterCatalog("^DFR:").map(commandId)).toEqual(["^DF"]);
    expect(filterCatalog("^XFE:LBL.ZPL").map(commandId)).toEqual(["^XF"]);
    // One or two letters are a name search only; as prose "ab" is in "label" and matches nearly everything.
    expect(filterCatalog("a").map(commandId).sort()).toEqual(["^A", "^A0", "^A@"]);
    expect(filterCatalog("ab").map(commandId)).toEqual(["^A"]);
    expect(filterCatalog("bo").some((e) => e.cmd === "B0")).toBe(true);
    expect(filterCatalog("label length").map((e) => e.cmd)).toContain("LL");
    expect(filterCatalog("")).toHaveLength(ZPL_COMMANDS.length);
  });

  it("carries the import loss cause the report wording is keyed by", () => {
    expect(catalogEntry("^A@")?.loss).toBe("fontFace");
    expect(catalogEntry("~PH")?.loss).toBeUndefined();
  });
});
