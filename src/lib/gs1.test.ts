import { describe, it, expect } from "vitest";
import {
  gtin14WithCheck,
  mod10CheckDigit,
  validateGs1Segment,
  validateGs1SegmentResolved,
  validateGs1Segments,
  elementStringToContent,
  gtinBodyFromContent,
  segmentsToElementString,
  segmentsToContent,
  parseGs1ToSegments,
  GS1_GS,
  GS1_DATABAR_EXPANDED_SYMBOLOGIES,
  GS1_DATABAR_DEFAULT_SEGMENTS,
  GS1_AI_SPECS,
  gs1AddBlockReason,
  segmentsToZplFd,
  gs1ContentToZplFd,
  zplFdToGs1Input,
} from "@zplab/core/lib/gs1";

describe("gtin14WithCheck", () => {
  it("computes the check digit for a 13-digit body", () => {
    // GS1 mod-10 (weights 3-1 from the right): body 0112345678901 → check 1.
    expect(gtin14WithCheck("0112345678901")).toBe("01123456789011");
  });

  it("pads short input to 13 digits before computing check", () => {
    expect(gtin14WithCheck("12345")).toHaveLength(14);
  });

  it("returns the input unchanged when 14 digits are supplied", () => {
    expect(gtin14WithCheck("01123456789011")).toBe("01123456789011");
  });

  it("strips an AI 01 prefix when input is longer than 14 digits", () => {
    // "01" prefix + 14 digits → keep only the 14
    expect(gtin14WithCheck("0101123456789011")).toBe("01123456789011");
  });

  it("ignores non-digit characters", () => {
    expect(gtin14WithCheck("(01)12345")).toHaveLength(14);
  });
});

describe("mod10CheckDigit", () => {
  it("computes the GS1 mod-10 check digit", () => {
    // GTIN-14 09501101530003: body 0950110153000 → check 3 (decoder-verified).
    expect(mod10CheckDigit("0950110153000")).toBe("3");
  });
});

describe("validateGs1Segment", () => {
  it("accepts a short GTIN (auto-completed later)", () => {
    expect(validateGs1Segment("01", "12345")).toBeNull();
  });
  it("flags an over-long GTIN and non-digits", () => {
    expect(validateGs1Segment("01", "012345678901234")).toBe("tooLong");
    expect(validateGs1Segment("01", "12a45")).toBe("digitsOnly");
  });
  it("validates dates incl. DD=00", () => {
    expect(validateGs1Segment("17", "261200")).toBeNull();
    expect(validateGs1Segment("17", "261331")).toBe("dateMonth");
    expect(validateGs1Segment("17", "2612")).toBe("dateFormat");
  });
  it("enforces exact length for fixedNum and max for variable", () => {
    expect(validateGs1Segment("20", "9")).toBe("exactLength");
    expect(validateGs1Segment("20", "99")).toBeNull();
    expect(validateGs1Segment("10", "A".repeat(21))).toBe("tooLong");
    expect(validateGs1Segment("10", "ABC-123")).toBeNull();
  });

  it("validates varNum (digits only, max length) and unknown AIs", () => {
    expect(validateGs1Segment("30", "12345")).toBeNull();
    expect(validateGs1Segment("30", "12a")).toBe("digitsOnly");
    expect(validateGs1Segment("30", "123456789")).toBe("tooLong"); // max 8
    expect(validateGs1Segment("05", "x")).toBe("unknownAi"); // 05 is not a GS1 AI
  });

  it("verifies the check digit of a full GTIN and SSCC", () => {
    expect(validateGs1Segment("01", "09501101530003")).toBeNull();
    expect(validateGs1Segment("01", "09501101530004")).toBe("checkDigit");
    expect(validateGs1Segment("00", "000000000000000000")).toBeNull();
    expect(validateGs1Segment("00", "000000000000000001")).toBe("checkDigit");
  });

  it("rejects impossible calendar days but allows DD=00", () => {
    expect(validateGs1Segment("17", "170230")).toBe("dateDay"); // Feb 30
    expect(validateGs1Segment("17", "170229")).toBeNull(); // leap allowed
    expect(validateGs1Segment("17", "170200")).toBeNull(); // whole month
  });

  it("rejects parentheses in varAlnum (renderer can't escape them)", () => {
    expect(validateGs1Segment("10", "AB(C)")).toBe("charset");
  });
});

describe("validateGs1Segments (combination rules)", () => {
  it("enforces dictionary req associations only with enforceReq (DataBar)", () => {
    expect(validateGs1Segments([], true)).toEqual({ key: "empty" });
    // 10 (LOT) req=01,02,…: standalone invalid on DataBar, fine elsewhere.
    expect(validateGs1Segments([{ ai: "10", value: "ABC123" }], true)).toMatchObject({
      key: "missingRequired", ai: "10",
    });
    expect(validateGs1Segments([
      { ai: "01", value: "09501101530003" },
      { ai: "10", value: "ABC123" },
    ], true)).toBeNull();
    expect(validateGs1Segments([{ ai: "10", value: "ABC123" }])).toBeNull();
    expect(validateGs1Segments([{ ai: "3103", value: "001500" }])).toBeNull();
  });

  it("permits req-free AIs standalone on DataBar (bwip parity: 400, 90)", () => {
    expect(validateGs1Segments([{ ai: "400", value: "ORDER1" }], true)).toBeNull();
    expect(validateGs1Segments([{ ai: "90", value: "XYZ" }], true)).toBeNull();
    expect(validateGs1Segments([{ ai: "00", value: "000000000000000000" }], true)).toBeNull();
    expect(validateGs1Segments([{ ai: "01", value: "09501101530003" }], true)).toBeNull();
  });

  it("gs1AddBlockReason mirrors the duplicate/ex verdicts for palette gating", () => {
    expect(gs1AddBlockReason("10", ["01", "10"])).toEqual({ kind: "duplicate" });
    // ex pairings block in both declaration directions.
    expect(gs1AddBlockReason("02", ["01"])).toEqual({ kind: "excludedBy", other: "01" });
    expect(gs1AddBlockReason("01", ["02"])).toEqual({ kind: "excludedBy", other: "02" });
    // 'n' wildcard family conflict (392n).
    expect(gs1AddBlockReason("3922", ["3921"])).toEqual({ kind: "excludedBy", other: "3921" });
    expect(gs1AddBlockReason("10", ["01"])).toBeNull();
  });

  it("gs1AddBlockReason never disagrees with the validator (anti-drift)", () => {
    // For conflict-free present sets, addable per the palette gate must mean
    // the superset carries no duplicate/exclusive error, and vice versa. The
    // gate is pairwise by design: violations already inside the set stay with
    // the validator, hence each seed is asserted clean first.
    const sets = [["01"], ["02"], ["01", "10"], ["3921"], ["00", "401"]];
    for (const present of sets) {
      const segs = present.map((ai) => ({ ai, value: "" }));
      expect(validateGs1Segments(segs), `seed [${present.join()}]`).toBeNull();
      for (const { ai } of GS1_AI_SPECS) {
        const block = gs1AddBlockReason(ai, present);
        const err = validateGs1Segments([...segs, { ai, value: "" }]);
        const setRejects = err?.key === "duplicateAi" || err?.key === "exclusiveAis";
        expect(!!block, `ai ${ai} into [${present.join()}]`).toBe(setRejects);
      }
    }
  });

  it("rejects ex pairings on every symbology (bwip parity: 02+01)", () => {
    const err = validateGs1Segments([
      { ai: "02", value: "09501101530003" },
      { ai: "01", value: "09501101530003" },
    ]);
    expect(err).toEqual({ key: "exclusiveAis", ai: "02", other: "01" });
  });

  it("catches (01)+(37) globally via 01's ex=255,37 (bwip parity on gs1-128)", () => {
    const err = validateGs1Segments([
      { ai: "01", value: "09501101530003" },
      { ai: "37", value: "12" },
    ]);
    expect(err).toEqual({ key: "exclusiveAis", ai: "01", other: "37" });
  });

  it("matches 'n' digit wildcards in ex patterns (392n family conflict)", () => {
    // 3920-3929 carries ex=392n: two members of the family conflict.
    const err = validateGs1Segments([
      { ai: "3921", value: "1500" },
      { ai: "3922", value: "1500" },
    ]);
    expect(err?.key).toBe("exclusiveAis");
  });

  it("blocks a req resting on an omitted AI (8111 req=255) when enforced", () => {
    // bwip rejects (8111) without (255) on DataBar and DataMatrix, so the
    // builder must too, even though 255 (multiComponent) is not addable here.
    expect(validateGs1Segments([{ ai: "8111", value: "1234" }], true)).toEqual({
      key: "missingRequired", ai: "8111", alternatives: [["255"]],
    });
    // GS1-128 stays lax (bwip renders it there).
    expect(validateGs1Segments([{ ai: "8111", value: "1234" }])).toBeNull();
  });

  it("rejects duplicate AI codes", () => {
    expect(validateGs1Segments([
      { ai: "01", value: "09501101530003" },
      { ai: "10", value: "ABC" },
      { ai: "10", value: "DEF" },
    ])).toEqual({ key: "duplicateAi" });
  });
});

describe("marker-bearing segment values (builder round-trip)", () => {
  const VARS = [
    { id: "g", name: "gtin", fnNumber: 1, defaultValue: "09501101530003" },
    { id: "l", name: "lot", fnNumber: 2, defaultValue: "AB12" },
  ];

  it("gtin14WithCheck passes a marker value through verbatim", () => {
    expect(gtin14WithCheck("«gtin»")).toBe("«gtin»");
    expect(segmentsToContent([{ ai: "01", value: "«gtin»" }])).toBe("01«gtin»");
  });

  it("parses fixed-AI markers by resolved width (round-trips exactly)", () => {
    // «gtin» default is 14 digits -> fills AI 01 exactly.
    expect(parseGs1ToSegments("01«gtin»10«lot»", VARS)).toEqual([
      { ai: "01", value: "«gtin»" },
      { ai: "10", value: "«lot»" },
    ]);
    // A default that doesn't fill the fixed width fails (blocked upstream by
    // the modal's round-trip gate before it can be stored).
    const short = [{ id: "g", name: "gtin", fnNumber: 1, defaultValue: "12345" }];
    expect(parseGs1ToSegments("01«gtin»", short)).toBeNull();
  });

  it("rejects a fixed field the marker can't fill exactly (validation backstop)", () => {
    // Mixed literal + marker and multi-marker mismatches must not round-trip,
    // so the modal's round-trip gate blocks Apply on them.
    expect(parseGs1ToSegments("01AB«gtin»", VARS)).toBeNull();
    expect(parseGs1ToSegments("11«clock:y»«clock:m»", VARS)).toBeNull(); // 4 != 6
  });

  it("round-trips clock markers composed to a fixed date AI's width", () => {
    // (11) PROD DATE is YYMMDD (6): y+m+d clock tokens = 2+2+2 = 6.
    expect(parseGs1ToSegments("11«clock:y»«clock:m»«clock:d»", VARS)).toEqual([
      { ai: "11", value: "«clock:y»«clock:m»«clock:d»" },
    ]);
  });

  it("keeps import parsing (no variables) strict about raw lengths", () => {
    expect(parseGs1ToSegments("01«gtin»")).toBeNull();
  });

  describe("validateGs1SegmentResolved (marker-aware segment verdict)", () => {
    it("requires a marker in a fixed AI to resolve to the exact width", () => {
      expect(validateGs1SegmentResolved("01", "«gtin»", "09501101530003")).toBeNull();
      expect(validateGs1SegmentResolved("01", "«gtin»", "12345")).toBe("exactLength");
    });

    it("treats an empty-resolving marker in a variable AI as runtime-valued", () => {
      expect(validateGs1SegmentResolved("10", "«lot»", "")).toBeNull();
      // A literally empty value is still an error.
      expect(validateGs1SegmentResolved("10", "", "")).toBe("empty");
    });

    it("defers non-marker values to the plain validator", () => {
      expect(validateGs1SegmentResolved("01", "0950110153000", "0950110153000")).toBeNull(); // 13 digits, autocompleted
      expect(validateGs1SegmentResolved("01", "ABC", "ABC")).toBe("digitsOnly");
    });
  });
});

describe("elementStringToContent", () => {
  it("parses a pasted element string (whitespace tolerated) to raw content with GS", () => {
    expect(elementStringToContent("  (01)09501101530003(10)ABC(21)SN\n")).toBe(
      `010950110153000310ABC${GS1_GS}21SN`,
    );
  });
  it("returns null for non-element-string input", () => {
    expect(elementStringToContent("010950110153000310ABC")).toBeNull();
    expect(elementStringToContent("(01)0950(05)X")).toBeNull(); // 05 is not a GS1 AI
  });
});

describe("gtinBodyFromContent", () => {
  it("extracts the (01) value from multi-AI content", () => {
    const content = segmentsToContent([
      { ai: "01", value: "09501101530003" },
      { ai: "10", value: "ABC123" },
    ]);
    expect(gtinBodyFromContent(content)).toBe("09501101530003");
  });
  it("falls back to the digits of unstructured content", () => {
    expect(gtinBodyFromContent("0112345678901")).toBe("0112345678901");
  });
  it("strips a leading 01 AI prefix in the unparseable fallback (no truncation)", () => {
    // 01 + 15 digits fails the parser; the GTIN must not keep the 01 prefix.
    expect(gtinBodyFromContent("01095011015300031")).toBe("09501101530003");
  });
});

describe("segments serialize/parse", () => {
  const segs = [
    { ai: "01", value: "09501101530003" },
    { ai: "10", value: "ABC123" },
    { ai: "21", value: "12345" },
  ];

  it("builds the parenthesized element string", () => {
    expect(segmentsToElementString(segs)).toBe("(01)09501101530003(10)ABC123(21)12345");
  });

  it("auto-completes a short GTIN without folding the AI into the body", () => {
    expect(segmentsToElementString([{ ai: "01", value: "12345" }])).toBe("(01)00000000123457");
    expect(segmentsToContent([{ ai: "01", value: "12345" }])).toBe("0100000000123457");
  });

  it("raw parser preserves a '(' in a value (round-trip); the validator rejects it separately", () => {
    expect(parseGs1ToSegments("10ABC(123)")).toEqual([{ ai: "10", value: "ABC(123)" }]);
  });

  it("builds raw content with a GS after a non-last variable AI only", () => {
    expect(segmentsToContent(segs)).toBe(`010950110153000310ABC123${GS1_GS}2112345`);
  });

  it("round-trips raw content back to segments (fixed + variable + mixed)", () => {
    expect(parseGs1ToSegments(segmentsToContent(segs))).toEqual(segs);
  });

  it("parses the parenthesized form", () => {
    expect(parseGs1ToSegments("(01)09501101530003(10)ABC123")).toEqual([
      { ai: "01", value: "09501101530003" },
      { ai: "10", value: "ABC123" },
    ]);
  });

  it("returns null for non-GS1 content (fallback to free text)", () => {
    expect(parseGs1ToSegments("hello world")).toBeNull();
    expect(parseGs1ToSegments("0112")).toBeNull(); // fixed AI too short
  });
});

describe("constants", () => {
  it("treats only 6 and 7 as Expanded variants", () => {
    expect(GS1_DATABAR_EXPANDED_SYMBOLOGIES.has(6)).toBe(true);
    expect(GS1_DATABAR_EXPANDED_SYMBOLOGIES.has(7)).toBe(true);
    expect(GS1_DATABAR_EXPANDED_SYMBOLOGIES.has(1)).toBe(false);
  });

  it("uses the spec-maximum 22 as the Expanded Stacked segments default", () => {
    expect(GS1_DATABAR_DEFAULT_SEGMENTS).toBe(22);
    expect(GS1_DATABAR_DEFAULT_SEGMENTS % 2).toBe(0);
  });
});

describe("segmentsToZplFd / gs1ContentToZplFd (mode D ^FD form)", () => {
  const content = "0104012345678901" + "1020260707" + GS1_GS + "17261231" + "30144";

  it("adds the >8 FNC1 invocation only after non-final variable AIs", () => {
    expect(gs1ContentToZplFd(content)).toBe(
      "(01)04012345678901(10)20260707>8(17)261231(30)144",
    );
  });

  it("passes unparseable content through verbatim (no re-escape corruption)", () => {
    // A foreign mode-D field kept verbatim on import must round-trip byte-stable;
    // re-escaping > here would turn >8 into >08 and corrupt the FNC1.
    expect(gs1ContentToZplFd(">;>80100003486")).toBe(">;>80100003486");
  });

  it("inserts >8 for the element-string form too, not just raw content", () => {
    // The parenthesized form must not bypass segment parsing into the fallback.
    expect(gs1ContentToZplFd("(01)04012345678901(10)20260707(17)261231(30)144")).toBe(
      "(01)04012345678901(10)20260707>8(17)261231(30)144",
    );
  });

  it("adds no separator for a single or final variable AI", () => {
    expect(gs1ContentToZplFd("1020260707")).toBe("(10)20260707");
    expect(gs1ContentToZplFd("010401234567890110ABC")).toBe("(01)04012345678901(10)ABC");
  });

  it("escapes a literal > in values as >0", () => {
    const segs = parseGs1ToSegments("10A>B" + GS1_GS + "30144");
    expect(segs).not.toBeNull();
    expect(segmentsToZplFd(segs!)).toBe("(10)A>0B>8(30)144");
  });

  it("zplFdToGs1Input undoes the invocations, including the >08 edge", () => {
    expect(zplFdToGs1Input("(10)A>0B>8(30)144")).toBe("(10)A>B(30)144");
    // >08 is an escaped > followed by a data 8, not an FNC1.
    expect(zplFdToGs1Input("(10)A>08>8(30)144")).toBe("(10)A>8(30)144");
  });
});
