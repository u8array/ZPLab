import { describe, it, expect } from "vitest";
import { DL_DEFAULT_DOMAIN, DL_UNSAFE, digitalLinkAddIssue, digitalLinkIssue, digitalLinkUri, isLinkDomain, linkAis, linkAisSegments, linkSegmentIssue, normalizeDomain, parseDigitalLink } from "./gs1DigitalLink";

const gtin = { ai: "01", value: "09506000134352" };

describe("digitalLinkUri", () => {
  it("writes the key, then the qualifiers in the standard's order, then the query", () => {
    const uri = digitalLinkUri("", [{ ai: "17", value: "250101" }, { ai: "21", value: "12345" }, gtin, { ai: "10", value: "ABC" }]);
    expect(uri).toBe("https://id.gs1.org/01/09506000134352/10/ABC/21/12345?17=250101");
  });

  it("keeps a complete GTIN, completes a body, rejects a wrong check digit, and keeps a marker intact", () => {
    expect(digitalLinkUri("", [{ ai: "01", value: "9506000134352" }])).toBe("https://id.gs1.org/01/09506000134352");
    expect(digitalLinkUri("", [{ ai: "01", value: "96385074" }])).toBe("https://id.gs1.org/01/00000096385074");
    expect(digitalLinkUri("", [{ ai: "01", value: "95060001343" }])).toBe("https://id.gs1.org/01/00950600013439");
    expect(linkSegmentIssue("01", "9506000134353", "9506000134353")).toBe("checkDigit");
    expect(linkSegmentIssue("01", "9506000134352", "9506000134352")).toBeNull();
    expect(linkSegmentIssue("01", "95060001343", "95060001343")).toBeNull();
    expect(digitalLinkUri("", [{ ai: "01", value: "«gtin»" }, { ai: "10", value: "L«n»/2" }])).toBe("https://id.gs1.org/01/«gtin»/10/L«n»%2F2");
  });

  it("percent-encodes the characters a path or query cannot carry", () => {
    expect(digitalLinkUri("", [gtin, { ai: "10", value: "A/B&C+D" }])).toBe("https://id.gs1.org/01/09506000134352/10/A%2FB%26C%2BD");
  });

  it("takes the qualifier alternative that fits the present AIs", () => {
    expect(digitalLinkUri("", [gtin, { ai: "235", value: "X1" }])).toBe("https://id.gs1.org/01/09506000134352/235/X1");
    expect(digitalLinkUri("", [{ ai: "414", value: "9506000134369" }, { ai: "254", value: "7" }])).toBe("https://id.gs1.org/414/9506000134369/254/7");
  });

  it("uses a brand domain as given, and falls back to id.gs1.org when empty", () => {
    expect(digitalLinkUri("https://brand.example.com/", [gtin])).toBe("https://brand.example.com/01/09506000134352");
    expect(digitalLinkUri("Brand.example.com/p", [gtin])).toBe("https://brand.example.com/p/01/09506000134352");
    expect(normalizeDomain("  ")).toBe(DL_DEFAULT_DOMAIN);
  });
});

describe("isLinkDomain", () => {
  it("accepts an origin with an optional path and nothing behind it", () => {
    expect(isLinkDomain("https://user@brand.com")).toBe(false);
    for (const ok of ["", "x.com", "https://x.com:8443/p/q", "«host»"]) expect(isLinkDomain(ok), ok).toBe(true);
    for (const bad of ["https://x.com/?a=b", "https://x.com#f", "ftp://x.com", "https://", "x.com/ p", "«host»?x"]) expect(isLinkDomain(bad), bad).toBe(false);
    // One render asks twice, so the answer must not depend on the call before.
    expect([isLinkDomain("https://«v»?a"), isLinkDomain("https://«v»?a")]).toEqual([false, false]);
  });

});

describe("digitalLinkIssue", () => {
  it("names the key count, a duplicate and mixed qualifier alternatives as the link's issue", () => {
    expect(digitalLinkUri("", [{ ai: "10", value: "ABC" }])).toBeNull();
    expect(digitalLinkIssue([{ ai: "10", value: "ABC" }])).toEqual({ kind: "noPrimaryKey" });
    expect(digitalLinkIssue([gtin, { ai: "00", value: "1" }])).toEqual({ kind: "twoPrimaryKeys" });
    expect(digitalLinkIssue([gtin, { ai: "10", value: "A" }, { ai: "10", value: "B" }])).toEqual({ kind: "duplicateAi", ai: "10" });
    expect(digitalLinkIssue([gtin, gtin])).toEqual({ kind: "duplicateAi", ai: "01" });
    expect(digitalLinkIssue([gtin, { ai: "10", value: "A" }, { ai: "235", value: "X" }])).toEqual({ kind: "mixedQualifiers", ai: "235" });
    expect(digitalLinkIssue([gtin, { ai: "10", value: "ABC" }, { ai: "17", value: "250101" }])).toBeNull();
  });
});

describe("linkSegmentIssue", () => {
  it("keeps a link GTIN at its own length, needs all 14 digits from a marker, and follows the GS1 rule elsewhere", () => {
    expect(linkSegmentIssue("01", "9506000134352", "9506000134352")).toBeNull();
    expect(linkSegmentIssue("01", "9506000134353", "9506000134353")).toBe("checkDigit");
    expect(linkSegmentIssue("01", "«g»", "9506000134352")).toBe("exactLength");
    expect(linkSegmentIssue("01", "«g»", "09506000134352")).toBeNull();
    expect(linkSegmentIssue("01", "«g»", "«g»")).toBeNull();
    expect(linkSegmentIssue("10", "«lot»", "")).toBeNull();
    expect(linkSegmentIssue("10", "«lot»", "", false)).toBe("empty");
    expect(linkSegmentIssue("17", "251345", "251345")).toBe("dateMonth");
  });
});

describe("digitalLinkAddIssue", () => {
  it("refuses a second key and a qualifier of another alternative, but not a conflict the list already has", () => {
    expect(digitalLinkAddIssue("00", ["01"])).toEqual({ kind: "twoPrimaryKeys" });
    expect(digitalLinkAddIssue("235", ["01", "10"])).toEqual({ kind: "mixedQualifiers", ai: "235" });
    expect(digitalLinkAddIssue("10", ["01", "235"])).toEqual({ kind: "mixedQualifiers", ai: "10" });
    expect(digitalLinkAddIssue("10", ["01"])).toBeNull();
    expect(digitalLinkAddIssue("00", ["01", "10", "10"])).toEqual({ kind: "twoPrimaryKeys" });
    expect(digitalLinkAddIssue("21", ["01", "10", "10"])).toBeNull();
    expect(digitalLinkAddIssue("11", ["01", "235", "10"])).toBeNull();
    expect(digitalLinkAddIssue("01", [])).toBeNull();
  });
});

describe("linkAis", () => {
  it("writes the values verbatim, a short GTIN included, and reads back parens and markers as one value", () => {
    const segments = [{ ai: "01", value: "9506000134352" }, { ai: "10", value: "A" }];
    expect(linkAis(segments)).toBe("(01)9506000134352(10)A");
    expect(linkAisSegments("(01)9506000134352(10)A")).toEqual(segments);
    for (const value of ["A(11)250101", "A(B", "x\\y", "«a(11)b»", "«lot»)", "«a", "b»c"]) {
      expect(linkAisSegments(linkAis([{ ai: "10", value }])), value).toEqual([{ ai: "10", value }]);
    }
    expect(linkAis([{ ai: "10", value: "«a(11)b»(" }])).toBe("(10)«a(11)b»\\(");
    expect(linkAisSegments(linkAis([{ ai: "01", value: "«a" }, { ai: "10", value: "b»c" }]))).toEqual([{ ai: "01", value: "«a" }, { ai: "10", value: "b»c" }]);
    expect(linkAisSegments("garbage")).toEqual([]);
  });
});

describe("parseDigitalLink", () => {
  it("round-trips the encoder's output", () => {
    const segments = [gtin, { ai: "10", value: "A/B&C" }, { ai: "21", value: "12345" }, { ai: "17", value: "250101" }];
    const uri = digitalLinkUri("https://brand.example.com/p", segments);
    expect(parseDigitalLink(uri ?? "")).toEqual({ domain: "https://brand.example.com/p", segments, foreignQuery: [] });
  });

  it("keeps a marker in the host, the prefix and a value as typed", () => {
    expect(parseDigitalLink("https://«host»/«p»/01/09506000134352/10/«lot»?4300=«to»")).toEqual({
      domain: "https://«host»/«p»",
      segments: [{ ai: "01", value: "09506000134352" }, { ai: "10", value: "«lot»" }, { ai: "4300", value: "«to»" }],
      foreignQuery: [],
    });
    expect(parseDigitalLink("https://«a:b c»/01/09506000134352")?.domain).toBe("https://«a:b c»");
    expect(parseDigitalLink("https://zplabm0m/01/09506000134352/10/«pw»")).toMatchObject({ domain: "https://zplabm0m", segments: [{ ai: "01", value: "09506000134352" }, { ai: "10", value: "«pw»" }] });
    expect(parseDigitalLink("https://cdn.example.com/img/401/abcdefghij")?.domain).toBe("https://cdn.example.com/img");
  });

  it("reads a link on any host behind any prefix and reports foreign query keys and the fragment", () => {
    expect(parseDigitalLink("http://example.com/a/b/00/123456789012345675?linkType=gs1:pip&3103=000123#x")).toEqual({
      domain: "http://example.com/a/b",
      segments: [{ ai: "00", value: "123456789012345675" }, { ai: "3103", value: "000123" }],
      foreignQuery: [["linkType", "gs1:pip"], ["#", "x"]],
    });
    expect(parseDigitalLink("https://id.gs1.org/01/09506000134352?4300=A+B")?.segments[1]).toEqual({ ai: "4300", value: "A+B" });
  });

  it("is a link only with a complete key value, a marker behind a prefix only with a second pair", () => {
    expect(parseDigitalLink("https://example.com/about")).toBeNull();
    expect(parseDigitalLink("https://example.com/01/x")).toBeNull();
    expect(parseDigitalLink("https://example.com/01/12")).toBeNull();
    expect(parseDigitalLink("https://id.gs1.org/01/3234234234")).toBeNull();
    expect(parseDigitalLink("https://example.com/01/09506000134352")?.segments).toEqual([{ ai: "01", value: "09506000134352" }]);
    expect(parseDigitalLink("https://blog.example.com/2024/01/12")).toBeNull();
    expect(parseDigitalLink("https://brand.example.com/p/01/3234234234")).toBeNull();
    expect(parseDigitalLink("https://brand.example.com/p/01/09506000134352")?.domain).toBe("https://brand.example.com/p");
    expect(parseDigitalLink("https://u:p@id.gs1.org/01/09506000134352")).toBeNull();
    expect(parseDigitalLink("https://example.com/01/«gtin»")?.segments).toEqual([{ ai: "01", value: "«gtin»" }]);
    expect(parseDigitalLink("https://blog.example.com/2024/01/«day»")).toBeNull();
    expect(parseDigitalLink("https://brand.example.com/p/01/«gtin»/21/«sn»")?.segments).toHaveLength(2);
    expect(parseDigitalLink("https://id.gs1.org/01/09506000134352/10")).toBeNull();
    expect(parseDigitalLink("https://id.gs1.org/01/09506000134352/99999/x")).toBeNull();
    expect(parseDigitalLink("ftp://id.gs1.org/01/09506000134352")).toBeNull();
    expect(parseDigitalLink("https://id.gs1.org/01/%E0%A4%A")).toBeNull();
  });
});

describe("DL_UNSAFE", () => {
  it("flags what encodeURIComponent would change, plus the tilde and the parens", () => {
    for (const s of ["abc-_.!*'", "A1"]) expect(s.match(DL_UNSAFE)).toBeNull();
    expect("a/b c&d~()".match(DL_UNSAFE)).toEqual(["/", " ", "&", "~", "(", ")"]);
  });
});
