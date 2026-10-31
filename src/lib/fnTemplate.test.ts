import { describe, it, expect } from "vitest";
import {
  hasTemplateMarkers,
  extractTemplateRefs,
  mapLiteralSpans,
  resolveTemplateMarkers,
  embedsToMarkers,
  markersToEmbeds,
  pickEmbedChar,
  capLiteralLength,
  literalInsertRoom,
  resolvedContentLength,
  substituteTemplateMarker,
  renameTemplateMarkers,
} from "@zplab/core/lib/fnTemplate";
import type { Variable } from "@zplab/core/types/Variable";

const vars: Variable[] = [
  { id: "a", name: "sku", fnNumber: 1, defaultValue: "DEFAULT-1" },
  { id: "b", name: "price", fnNumber: 2, defaultValue: "9.99" },
  { id: "c", name: "lot", fnNumber: 5, defaultValue: "X" },
];

describe("hasTemplateMarkers", () => {
  it("matches single marker", () => {
    expect(hasTemplateMarkers("hello «sku»")).toBe(true);
  });
  it("matches multiple markers", () => {
    expect(hasTemplateMarkers("«a» and «b»")).toBe(true);
  });
  it("returns false on plain text", () => {
    expect(hasTemplateMarkers("plain text")).toBe(false);
  });
  it("does not match an opening guillemet alone", () => {
    expect(hasTemplateMarkers("« no closer")).toBe(false);
  });
});

describe("extractTemplateRefs", () => {
  it("preserves source order and duplicates", () => {
    expect(extractTemplateRefs("«a» and «b» again «a»")).toEqual(["a", "b", "a"]);
  });
});

describe("mapLiteralSpans", () => {
  const upper = (s: string) => s.toUpperCase();
  it("transforms literals, keeps markers verbatim", () => {
    expect(mapLiteralSpans("ab«x»cd«clock:Y»ef", upper)).toBe("AB«x»CD«clock:Y»EF");
  });
  it("is identity-shaped on marker-free content", () => {
    expect(mapLiteralSpans("plain", upper)).toBe("PLAIN");
  });
  it("handles leading/trailing/adjacent markers (empty literal spans)", () => {
    expect(mapLiteralSpans("«a»«b»", upper)).toBe("«a»«b»");
    expect(mapLiteralSpans("«a»x", upper)).toBe("«a»X");
  });
  it("keeps escapable chars inside a marker body untouched", () => {
    expect(mapLiteralSpans(";«x;y»;", (s) => s.replace(/;/g, "\\;"))).toBe("\\;«x;y»\\;");
  });
  it("filters a charset on literals without eating the chip (GS1 sanitise case)", () => {
    const digits = (s: string) => s.replace(/\D/g, "");
    expect(mapLiteralSpans("(01)«gtin»99x", digits)).toBe("01«gtin»99");
  });
});

describe("resolveTemplateMarkers", () => {
  it("substitutes each marker via the resolver", () => {
    const r = resolveTemplateMarkers("«sku»-«price»", (n) =>
      n === "sku" ? "ABC" : n === "price" ? "19.99" : undefined,
    );
    expect(r).toBe("ABC-19.99");
  });
  it("leaves unknown markers literal", () => {
    const r = resolveTemplateMarkers("«known»/«missing»", (n) => (n === "known" ? "v" : undefined));
    expect(r).toBe("v/«missing»");
  });
});

describe("embedsToMarkers", () => {
  const fnToName = new Map([
    [1, "sku"],
    [2, "price"],
  ]);
  it("converts whole-field embeds with default # delimiter", () => {
    expect(embedsToMarkers("Hello #1#-#2#", "#", fnToName)).toBe("Hello «sku»-«price»");
  });
  it("converts substring embeds (slice args discarded)", () => {
    expect(embedsToMarkers("#1,0,3#", "#", fnToName)).toBe("«sku»");
  });
  it("respects a custom embedChar set via ^FE", () => {
    expect(embedsToMarkers("Hello @1@-@2@", "@", fnToName)).toBe("Hello «sku»-«price»");
  });
  it("leaves embeds for unknown FN numbers literal (loss-less round-trip)", () => {
    expect(embedsToMarkers("#9#", "#", fnToName)).toBe("#9#");
  });
});

describe("markersToEmbeds", () => {
  it("emits embeds for known variable names + reports the fnNumbers used", () => {
    const r = markersToEmbeds("«sku»-«price»", vars, "#");
    expect(r.payload).toBe("#1#-#2#");
    expect([...r.referencedFnNumbers].sort()).toEqual([1, 2]);
  });
  it("leaves markers literal when the named variable does not exist", () => {
    const r = markersToEmbeds("«sku»-«gone»", vars, "#");
    expect(r.payload).toBe("#1#-«gone»");
    expect([...r.referencedFnNumbers]).toEqual([1]);
  });
  it("dedupes referencedFnNumbers when the same name appears twice", () => {
    const r = markersToEmbeds("«sku»/«sku»", vars, "#");
    expect(r.payload).toBe("#1#/#1#");
    expect([...r.referencedFnNumbers]).toEqual([1]);
  });
  it("uses a non-default embedChar passed by the caller", () => {
    const r = markersToEmbeds("«sku»-«price»", vars, "@");
    expect(r.payload).toBe("@1@-@2@");
  });
});

describe("pickEmbedChar", () => {
  it("returns # when no payload contains it", () => {
    expect(pickEmbedChar(["plain text", "more"])).toBe("#");
  });
  it("falls back to next candidate when # appears in any payload", () => {
    expect(pickEmbedChar(["Item #SKU-1", "other"])).toBe("@");
  });
  it("returns null when every candidate is taken", () => {
    expect(pickEmbedChar(["#@|%&?!"])).toBe(null);
  });
});

describe("capLiteralLength", () => {
  it("caps a purely-literal value to maxLength", () => {
    expect(capLiteralLength("123456789", 5)).toBe("12345");
  });
  it("leaves a short value untouched", () => {
    expect(capLiteralLength("12", 5)).toBe("12");
  });
  it("never caps when a marker is present (printed length is the variable's)", () => {
    expect(capLiteralLength("«sku»0123456789", 3)).toBe("«sku»0123456789");
  });
  it("is a no-op when no cap is set", () => {
    expect(capLiteralLength("123456789", undefined)).toBe("123456789");
  });
});

const VARS = [
  { id: "v1", name: "sku", fnNumber: 1, defaultValue: "12345" },
  { id: "v2", name: "lot", fnNumber: 2, defaultValue: "AB" },
];

describe("resolvedContentLength", () => {
  it("inherits a variable's defaultValue length", () => {
    // x="12345" -> 5; "12345«x»" -> 5 literal + 5 inherited = 10.
    expect(resolvedContentLength("12345«sku»", VARS)).toBe(10);
    expect(resolvedContentLength("«sku»-«lot»", VARS)).toBe(8);
  });
  it("counts clock markers at their fixed token width", () => {
    expect(resolvedContentLength("«clock:y»«clock:m»«clock:d»", [])).toBe(6);
    expect(resolvedContentLength("«clock:Y»", [])).toBe(4);
    expect(resolvedContentLength("«clock2:j»", [])).toBe(3);
  });
  it("counts an unknown marker literally (it stays literal on emit)", () => {
    expect(resolvedContentLength("«ghost»", [])).toBe("«ghost»".length);
  });
  it("counts a control chip as 1 byte only with ctrlAsByte (emitter parity)", () => {
    // Incapable/GS1 fields keep the chip literal at emit, so the length gate
    // must count the full marker text there.
    expect(resolvedContentLength("A«ctrl:TAB»B", [], true)).toBe(3);
    expect(resolvedContentLength("A«ctrl:TAB»B", [])).toBe("A«ctrl:TAB»B".length);
  });
  it("counts a bound value's chips as bytes only on a lone bind", () => {
    const bound = [{ id: "v", name: "v", fnNumber: 1, defaultValue: "A«ctrl:TAB»B" }];
    expect(resolvedContentLength("«v»", bound, true)).toBe(3);
    expect(resolvedContentLength("«v»", bound)).toBe("A«ctrl:TAB»B".length);
    expect(resolvedContentLength("x«v»y", bound, true)).toBe("xA«ctrl:TAB»By".length);
  });
  it("handles empty defaults and plain literals", () => {
    expect(resolvedContentLength("abc", VARS)).toBe(3);
    expect(resolvedContentLength("«e»", [{ id: "v", name: "e", fnNumber: 3, defaultValue: "" }])).toBe(0);
  });
});

describe("literalInsertRoom", () => {
  it("returns remaining room accounting for the replaced selection", () => {
    expect(literalInsertRoom("123", "", 5, [])).toBe(2);
    expect(literalInsertRoom("123", "23", 5, [])).toBe(4);
  });
  it("clamps to zero when the field is already full", () => {
    expect(literalInsertRoom("12345", "", 5, [])).toBe(0);
  });
  it("returns Infinity when no cap is set", () => {
    expect(literalInsertRoom("123", "", undefined, [])).toBe(Infinity);
  });
  it("counts the value's markers at their resolved width", () => {
    // «sku» resolves to 5 chars, so cap 8 leaves room for 3 literals.
    expect(literalInsertRoom("«sku»", "", 8, VARS)).toBe(3);
    // Replacing the marker itself frees its 5 resolved chars.
    expect(literalInsertRoom("«sku»", "«sku»", 8, VARS)).toBe(8);
  });
});

describe("substituteTemplateMarker", () => {
  it("replaces a marker with the literal replacement", () => {
    expect(substituteTemplateMarker("Hello «sku»", "sku", "ABC")).toBe("Hello ABC");
  });
  it("replaces every occurrence", () => {
    expect(substituteTemplateMarker("«sku»-«sku»", "sku", "X")).toBe("X-X");
  });
  it("leaves other markers untouched", () => {
    expect(substituteTemplateMarker("«sku» «lot»", "sku", "X")).toBe("X «lot»");
  });
  it("is identity-preserving when the name is absent", () => {
    const s = "no markers here";
    expect(substituteTemplateMarker(s, "sku", "X")).toBe(s);
  });
  it("can delete a marker by replacing with empty string", () => {
    expect(substituteTemplateMarker("a«sku»b", "sku", "")).toBe("ab");
  });
});

describe("renameTemplateMarkers (single pass, collision-safe)", () => {
  it("swaps two names without cascading", () => {
    const out = renameTemplateMarkers("«a»-«b»", new Map([["a", "b"], ["b", "a"]]));
    expect(out).toBe("«b»-«a»");
  });

  it("renames a chain by original name only (a->b, b->c)", () => {
    const out = renameTemplateMarkers("«a» «b»", new Map([["a", "b"], ["b", "c"]]));
    expect(out).toBe("«b» «c»");
  });

  it("leaves unmapped markers (incl. clock) untouched", () => {
    const out = renameTemplateMarkers("«a» «clock:Y» «x»", new Map([["a", "z"]]));
    expect(out).toBe("«z» «clock:Y» «x»");
  });

  it("is identity on an empty map", () => {
    expect(renameTemplateMarkers("«a»", new Map())).toBe("«a»");
  });
});
