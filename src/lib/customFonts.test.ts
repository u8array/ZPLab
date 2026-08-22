import { describe, it, expect } from "vitest";
import {
  builtinFontFamily,
  dropLegacyFontBindings,
  formatFontDownloadFromPath,
  getAvailableFontIds,
  isBuiltinFontId,
  nextFreeAlias,
  normalizeAlias,
  resolveDefaultPrinterFontName,
  resolvePreviewFontName,
  upsertCustomFontMapping,
} from "@zplab/core/lib/customFonts";
import { loadFontFile, removeFont, EMBED_WARN_FONT_BYTES } from "@zplab/core/lib/fontCache";

describe("dropLegacyFontBindings", () => {
  it("returns undefined for undefined or empty input", () => {
    expect(dropLegacyFontBindings(undefined)).toBeUndefined();
    expect(dropLegacyFontBindings([])).toBeUndefined();
  });

  it("removes path-less legacy bindings, keeps real entries", () => {
    const kept = { alias: "A", path: "E:ARIAL.TTF" };
    expect(dropLegacyFontBindings([kept, { alias: "B", previewFontName: "X.TTF" }])).toEqual([kept]);
  });

  it("returns undefined when only legacy bindings remain", () => {
    expect(dropLegacyFontBindings([{ alias: "A", previewFontName: "X.TTF" }])).toBeUndefined();
  });
});

describe("formatFontDownloadFromPath", () => {
  const fileOf = (name: string, bytes: number) =>
    new File([new Uint8Array(bytes)], name, { type: "font/ttf" });

  it("emits a ~DY line with the byte count", async () => {
    await loadFontFile(fileOf("small.ttf", 64), "SMALL.TTF");
    const line = formatFontDownloadFromPath("E:SMALL.TTF");
    expect(line?.startsWith("~DYE:SMALL,A,T,64,,")).toBe(true);
    removeFont("SMALL.TTF");
  });

  it("still emits a large font (printer is the target; size only warns in the UI)", async () => {
    await loadFontFile(fileOf("big.ttf", EMBED_WARN_FONT_BYTES + 1), "BIG.TTF");
    const line = formatFontDownloadFromPath("E:BIG.TTF");
    expect(line?.startsWith("~DYE:BIG,A,T,")).toBe(true);
    removeFont("BIG.TTF");
  });

  it("strips command and slot terminators from the ~DY target", async () => {
    await loadFontFile(fileOf("safe.ttf", 8), "SAFE.TTF");
    const line = formatFontDownloadFromPath("E:BAD^FS,NAME.TTF", "SAFE.TTF");
    expect(line?.startsWith("~DYE:BADFSNAME,A,T,8,,")).toBe(true);
    removeFont("SAFE.TTF");
  });
});

describe("builtinFontFamily", () => {
  it("maps device fonts to their Labelary-matching faces", () => {
    expect(builtinFontFamily("A")).toContain("Vera Mono");
    expect(builtinFontFamily("B")).toContain("Vera Mono Bold");
    expect(builtinFontFamily("E")).toContain("OCRB");
    expect(builtinFontFamily("H")).toContain("OCRA");
  });

  it("leaves Font 0 on the default face (no override)", () => {
    expect(builtinFontFamily("0")).toBeUndefined();
  });

  it("returns undefined for non-built-in or empty ids", () => {
    expect(builtinFontFamily("Z")).toBeUndefined();
    expect(builtinFontFamily(undefined)).toBeUndefined();
  });
});

describe("normalizeAlias", () => {
  it("uppercases letters", () => {
    expect(normalizeAlias("m")).toBe("M");
  });

  it("strips non-alphanumeric characters", () => {
    expect(normalizeAlias("!@#")).toBe("");
    expect(normalizeAlias(" m ")).toBe("M");
  });

  it("keeps only the first valid character", () => {
    expect(normalizeAlias("ab")).toBe("A");
    expect(normalizeAlias("#7q")).toBe("7");
  });

  it("accepts digits", () => {
    expect(normalizeAlias("0")).toBe("0");
  });
});

describe("upsertCustomFontMapping", () => {
  it("appends a new mapping when path is absent", () => {
    expect(
      upsertCustomFontMapping(
        [{ alias: "A", path: "E:A.TTF" }],
        "E:B.TTF",
        "B",
      ),
    ).toEqual([
      { alias: "A", path: "E:A.TTF" },
      { alias: "B", path: "E:B.TTF" },
    ]);
  });

  it("replaces an existing mapping for the same path", () => {
    expect(
      upsertCustomFontMapping(
        [{ alias: "A", path: "E:FOO.TTF" }],
        "E:FOO.TTF",
        "M",
      ),
    ).toEqual([{ alias: "M", path: "E:FOO.TTF" }]);
  });

  it("removes the mapping when alias is empty", () => {
    expect(
      upsertCustomFontMapping(
        [
          { alias: "A", path: "E:A.TTF" },
          { alias: "B", path: "E:B.TTF" },
        ],
        "E:A.TTF",
        "",
      ),
    ).toEqual([{ alias: "B", path: "E:B.TTF" }]);
  });

  it("treats undefined list as empty", () => {
    expect(upsertCustomFontMapping(undefined, "E:X.TTF", "X")).toEqual([
      { alias: "X", path: "E:X.TTF" },
    ]);
  });
});

describe("nextFreeAlias", () => {
  it("returns I when nothing is taken (first non-built-in)", () => {
    expect(nextFreeAlias([])).toBe("I");
  });

  it("skips taken aliases in the preferred range", () => {
    expect(nextFreeAlias(["I", "J", "K"])).toBe("L");
  });

  it("avoids built-in font letters until the unreserved range is exhausted", () => {
    // I-Z + 1-9 = 26 chars; if all are taken the helper falls back to
    // the built-in letters.
    const taken = "IJKLMNOPQRSTUVWXYZ123456789".split("");
    expect(nextFreeAlias(taken)).toBe("0");
  });

  it("returns empty when all 36 valid characters are taken", () => {
    const all =
      "0ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789".split("");
    expect(nextFreeAlias(all)).toBe("");
  });
});

describe("isBuiltinFontId", () => {
  it.each(["0", "A", "B", "C", "D", "E", "F", "G", "H"])(
    "treats '%s' as built-in",
    (id) => {
      expect(isBuiltinFontId(id)).toBe(true);
    },
  );

  it.each(["I", "M", "Z", "1", "9"])(
    "treats '%s' as non-built-in",
    (id) => {
      expect(isBuiltinFontId(id)).toBe(false);
    },
  );

  it("treats the empty string as non-built-in (String.includes trap)", () => {
    expect(isBuiltinFontId("")).toBe(false);
  });
});

describe("resolvePreviewFontName", () => {
  it("returns the explicit previewFontName when set", () => {
    expect(
      resolvePreviewFontName(
        {
          customFonts: [
            { alias: "M", path: "E:MYFONT.TTF", previewFontName: "CUSTOM.TTF" },
          ],
        },
        "M",
      ),
    ).toBe("CUSTOM.TTF");
  });

  it("falls back to the path filename when previewFontName is unset", () => {
    expect(
      resolvePreviewFontName(
        { customFonts: [{ alias: "M", path: "E:MYFONT.TTF" }] },
        "M",
      ),
    ).toBe("MYFONT.TTF");
  });

  it("returns previewFontName for built-in aliases (path-less binding)", () => {
    expect(
      resolvePreviewFontName(
        { customFonts: [{ alias: "A", previewFontName: "MY_A.TTF" }] },
        "A",
      ),
    ).toBe("MY_A.TTF");
  });

  it("returns undefined for an alias with neither path nor preview", () => {
    expect(
      resolvePreviewFontName({ customFonts: [{ alias: "M" }] }, "M"),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown fontId", () => {
    expect(
      resolvePreviewFontName(
        { customFonts: [{ alias: "M", path: "E:X.TTF" }] },
        "Q",
      ),
    ).toBeUndefined();
  });

  it("returns undefined when fontId is empty / undefined", () => {
    expect(
      resolvePreviewFontName({ customFonts: [] }, undefined),
    ).toBeUndefined();
  });
});

describe("getAvailableFontIds", () => {
  it("lists all nine built-in IDs when customFonts is empty", () => {
    const ids = getAvailableFontIds({});
    expect(ids.map((o) => o.id)).toEqual([
      "0", "A", "B", "C", "D", "E", "F", "G", "H",
    ]);
    expect(ids.every((o) => o.builtin)).toBe(true);
  });

  it("appends custom aliases after the built-ins", () => {
    const ids = getAvailableFontIds({
      customFonts: [{ alias: "M", path: "E:MYFONT.TTF" }],
    });
    const m = ids.find((o) => o.id === "M");
    expect(m).toEqual({
      id: "M",
      builtin: false,
      path: "E:MYFONT.TTF",
      previewFontName: undefined,
    });
  });

  it("merges a built-in override (no duplicate row)", () => {
    const ids = getAvailableFontIds({
      customFonts: [{ alias: "A", previewFontName: "MY_A.TTF" }],
    });
    expect(ids.filter((o) => o.id === "A")).toHaveLength(1);
    expect(ids.find((o) => o.id === "A")).toEqual({
      id: "A",
      builtin: true,
      path: undefined,
      previewFontName: "MY_A.TTF",
    });
  });
});

describe("resolveDefaultPrinterFontName", () => {
  it("returns the filename for a default alias that maps to a custom font", () => {
    expect(
      resolveDefaultPrinterFontName({
        defaultFontId: "M",
        customFonts: [{ alias: "M", path: "E:MYFONT.TTF" }],
      }),
    ).toBe("MYFONT.TTF");
  });

  it("strips any single-letter drive prefix, not just E:", () => {
    expect(
      resolveDefaultPrinterFontName({
        defaultFontId: "M",
        customFonts: [{ alias: "M", path: "R:RAMFONT.TTF" }],
      }),
    ).toBe("RAMFONT.TTF");
  });

  it("returns undefined for a built-in font id with no matching mapping", () => {
    expect(
      resolveDefaultPrinterFontName({
        defaultFontId: "0",
        customFonts: [{ alias: "M", path: "E:MYFONT.TTF" }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined when defaultFontId is unset", () => {
    expect(
      resolveDefaultPrinterFontName({
        customFonts: [{ alias: "M", path: "E:MYFONT.TTF" }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined when customFonts is missing", () => {
    expect(
      resolveDefaultPrinterFontName({ defaultFontId: "M" }),
    ).toBeUndefined();
  });
});
