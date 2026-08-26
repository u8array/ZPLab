import { describe, it, expect } from "vitest";
import {
  MAX_SOURCE_CHARS,
  MAX_SOURCE_LINE_CHARS,
  MAX_SOURCE_PAGES,
  prepareSourceApply,
  sourceEditGate,
} from "./zplSourceEdit";
import { generateMultiPageZPL } from "./zplGenerator";
import { replayRiskFindings } from "./importReport";
import type { LabelConfig } from "../types/LabelConfig";
import type { Page } from "../types/Group";
import type { PrinterProfile } from "../types/PrinterProfile";
import type { Variable } from "../types/Variable";

const label: LabelConfig = { widthMm: 70, heightMm: 40, dpmm: 8 };
const variables: Variable[] = [{ id: "v1", name: "LOT", fnNumber: 1, defaultValue: "L42" }];
const pages: Page[] = [
  {
    objects: [
      {
        id: "t1", type: "text", x: 10, y: 10, rotation: 0,
        props: { content: "Lot «LOT»", fontHeight: 30, fontWidth: 0, rotation: "N" },
      } as never,
      {
        id: "t2", type: "text", x: 10, y: 60, rotation: 0,
        props: { content: "static", fontHeight: 30, fontWidth: 0, rotation: "N" },
      } as never,
    ],
  },
];
const profile: PrinterProfile = {};

const current = (over: Partial<Parameters<typeof prepareSourceApply>[0]["current"]> = {}) => ({
  label,
  pages,
  variables,
  printerProfile: profile,
  columnMapping: null,
  ...over,
});

describe("an unchanged buffer applies losslessly", () => {
  it("re-exports byte-identically, twice", () => {
    const zpl = generateMultiPageZPL(label, pages, variables);
    const plan = prepareSourceApply({ text: zpl, current: current() });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const round1 = generateMultiPageZPL(plan.next.label, plan.next.pages, plan.next.variables);
    expect(round1).toBe(zpl);
    const plan2 = prepareSourceApply({ text: round1, current: current({ ...plan.next }) });
    expect(plan2.ok).toBe(true);
    if (!plan2.ok) return;
    expect(generateMultiPageZPL(plan2.next.label, plan2.next.pages, plan2.next.variables)).toBe(zpl);
  });
});

describe("the edit gate", () => {
  it("refuses a graphic payload line, naming the command", () => {
    const blob = `^XA\n^GFA,8000,8000,8,${"F".repeat(MAX_SOURCE_LINE_CHARS + 100)}^FS\n^XZ`;
    expect(sourceEditGate(blob)).toEqual({ ok: false, reason: "blobLine", command: "^GF" });
    const under = `^XA\n^FD${"a".repeat(MAX_SOURCE_LINE_CHARS - 10)}^FS\n^XZ`;
    expect(sourceEditGate(under).ok).toBe(true);
  });

  it("refuses an oversized document", () => {
    const big = "^FX pad\n".repeat(MAX_SOURCE_CHARS / 8 + 10);
    expect(sourceEditGate(big)).toEqual({ ok: false, reason: "tooLarge" });
    expect(prepareSourceApply({ text: big, current: current() })).toMatchObject({
      ok: false,
      reason: "tooLarge",
    });
  });
});

describe("foreign text without the ZPLLAB sidecar", () => {
  it("inherits the open label's dpmm; a sidecar wins over it", () => {
    const foreign = "^XA^FO10,10^A0N,30,30^FDX^FS^XZ";
    const at12 = prepareSourceApply({
      text: foreign,
      current: current({ label: { ...label, dpmm: 12 } }),
    });
    expect(at12.ok).toBe(true);
    if (at12.ok) expect(at12.next.label.dpmm).toBe(12);

    const withSidecar = generateMultiPageZPL(label, pages, variables);
    const applied = prepareSourceApply({
      text: withSidecar,
      current: current({ label: { ...label, dpmm: 12 } }),
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.next.label.dpmm).toBe(8);
  });
});

describe("setup commands in the buffer", () => {
  it("stay in the label and surface as replayRisk, never silently", () => {
    const plan = prepareSourceApply({
      text: "^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ",
      current: current(),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(replayRiskFindings(plan.report).length).toBeGreaterThan(0);
    expect(plan.next.pages[0]?.overlay).toBeDefined();
  });
});

describe("a value-only edit of the app's own export applies without a dialog", () => {
  it("carries no lossyEdit caveat for the generator's ^BY-before-^FO shape", () => {
    // 1D barcode + template field: the generator's own emit shape marks the
    // block non-regen-safe on re-import; that caveat is about future canvas
    // edits and must not stop a source apply over a one-value change.
    const zpl = [
      "^XA",
      '^FXZPLLAB:{"dpmm":8,"wMm":70,"hMm":40}^FS',
      "^PW560",
      "^LL320",
      "^FN1^FDAB1234^FS",
      "^BY2^FO100,40^BCN,60,Y,N,N^FE#^FD#1#-X^FS",
      "^XZ",
    ].join("\n");
    const edited = zpl.replace("AB1234", "AB234");
    const plan = prepareSourceApply({ text: edited, baseline: zpl, current: current() });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.report.findings.filter((f) => f.kind === "lossyEdit")).toEqual([]);
  });
});

describe("deleting a command from the buffer clears its field", () => {
  it("drops the label/profile keys the baseline set and the edit removed, keeping UI-only fields", () => {
    const withCmds = "^XA^MD10^JZY^FO10,10^A0N,30,30^FDX^FS^XZ";
    const without = "^XA^FO10,10^A0N,30,30^FDX^FS^XZ";
    const cur = current({
      label: { ...label, darkness: 10 },
      printerProfile: { reprintAfterError: "Y", headTestInterval: 5 },
    });
    const plan = prepareSourceApply({ text: without, baseline: withCmds, current: cur });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next.label.darkness).toBeUndefined();
    expect(plan.next.printerProfile.reprintAfterError).toBeUndefined();
    // Never in the baseline stream (Settings-UI only): survives untouched.
    expect(plan.next.printerProfile.headTestInterval).toBe(5);
  });

  it("keeps the geometry trio when the edit deletes the sidecar (and ^PW/^LL)", () => {
    const baseline = generateMultiPageZPL(label, pages, []);
    const without = baseline
      .split("\n")
      .filter((l) => !l.includes("ZPLLAB") && !/^\^PW|^\^LL/.test(l))
      .join("\n");
    const plan = prepareSourceApply({ text: without, baseline, current: current() });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Document identity, not a deletable command: the strip must skip it.
    expect(plan.next.label.widthMm).toBe(70);
    expect(plan.next.label.heightMm).toBe(40);
    expect(plan.next.label.dpmm).toBe(8);
  });

  it("keeps inherited fields when no baseline is given", () => {
    const plan = prepareSourceApply({
      text: "^XA^FO10,10^A0N,30,30^FDX^FS^XZ",
      current: current({ label: { ...label, darkness: 10 } }),
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.next.label.darkness).toBe(10);
  });
});

describe("the current profile survives an apply", () => {
  it("keeps existing setup fonts when the buffer brings none", () => {
    const plan = prepareSourceApply({
      text: "^XA^FO10,10^A0N,30,30^FDX^FS^XZ",
      current: current({ printerProfile: { setupFonts: [{ path: "E:LOGO.TTF" }] } }),
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.next.printerProfile.setupFonts).toEqual([{ path: "E:LOGO.TTF" }]);
  });
});

describe("unbalanced position and kind", () => {
  const refusalOf = (text: string) => {
    const plan = prepareSourceApply({ text, current: current() });
    expect(plan.ok).toBe(false);
    return !plan.ok && plan.reason === "unbalanced" ? plan.unbalanced : undefined;
  };

  it("stray ^XZ points at the ^XZ", () => {
    const text = "^XZ^XA^FO10,10^A0N,30,30^FDX^FS^XZ";
    expect(refusalOf(text)).toEqual({ kind: "strayXz", at: 0, cmd: "^XZ" });
  });

  it("a second ^XA blames the format it interrupts, not itself", () => {
    // The user forgot the ^XZ between two labels; deleting the second ^XA
    // would fuse them, so the marker points at the unterminated opener.
    const text = "^XA^FDa^FS^XA^FDb^FS^XZ";
    expect(refusalOf(text)).toEqual({
      kind: "unclosedXa",
      at: 0,
      cmd: "^XA",
      // Where the missing ^XZ belongs, a whole label away from the opener.
      related: { at: text.indexOf("^XA", 1), cmd: "^XA" },
    });
  });

  it("unclosed format points at its opening ^XA", () => {
    const text = "^XA^FDx^FS^XZ\n^XA^FO10,10^A0N,30,30^FDy^FS";
    expect(refusalOf(text)).toEqual({ kind: "unclosedXa", at: text.indexOf("^XA", 3), cmd: "^XA" });
  });
});

describe("format balance", () => {
  it("refuses unbalanced ^XA/^XZ instead of baking broken bytes into the overlay", () => {
    const cases = [
      "^XA^FO10,10^A0N,30,30^FDX^FS",
      "^XZ^XA^FO10,10^A0N,30,30^FDX^FS^XZ",
      "^XA^FDX^FS^XZ\n^XA^FDY^FS",
      "^XA^XA^FDX^FS^XZ",
    ];
    for (const text of cases) {
      expect(prepareSourceApply({ text, current: current() }), text).toMatchObject({
        ok: false,
        reason: "unbalanced",
      });
    }
  });

  it("judges balance through the parser, so a ^CC caret remap cannot fool it", () => {
    // Balanced under a remapped caret: must apply.
    const remapClosed = "^XA^CC/ /FO10,10/A0N,30,30/FDX/FS/XZ";
    expect(prepareSourceApply({ text: remapClosed, current: current() }).ok).toBe(true);
    // Genuinely unterminated under a remapped caret: must refuse.
    const remapOpen = "^XA^CC/ /FO10,10/A0N,30,30/FDX/FS";
    expect(prepareSourceApply({ text: remapOpen, current: current() })).toMatchObject({
      ok: false,
      reason: "unbalanced",
    });
  });
});

describe("the page cap", () => {
  it("refuses past the MCP boundary's limit", () => {
    const many = "^XA^FO10,10^A0N,30,30^FDX^FS^XZ\n".repeat(MAX_SOURCE_PAGES + 1);
    expect(prepareSourceApply({ text: many, current: current() })).toMatchObject({
      ok: false,
      reason: "tooManyPages",
    });
  });
});

describe("implausible geometry", () => {
  it("drops a head-impossible ^PW/^LL with a finding, same bound as the sidecar", () => {
    const plan = prepareSourceApply({
      text: "^XA^PW999999^LL999999^FO10,10^A0N,30,30^FDX^FS^XZ",
      current: current(),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next.label.widthMm).toBe(70);
    expect(plan.next.label.heightMm).toBe(40);
    const partials = plan.report.findings.filter((f) => f.kind === "partial").map((f) => f.command);
    expect(partials).toContain("^PW");
    expect(partials).toContain("^LL");
  });
});

describe("degenerate buffers", () => {
  it("flags empty and content-free text apart", () => {
    expect(prepareSourceApply({ text: "   \n ", current: current() })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(prepareSourceApply({ text: "no zpl here", current: current() })).toMatchObject({
      ok: false,
      reason: "noContent",
    });
  });

  it("keeps a config-only block as an overlay-bearing page", () => {
    const plan = prepareSourceApply({ text: "^XA^PW800^XZ", current: current() });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next.pages).toHaveLength(1);
    expect(plan.next.pages[0]?.objects).toEqual([]);
    expect(plan.next.pages[0]?.overlay).toBeDefined();
  });

  it("never returns zero pages", () => {
    // A bare setup-only stream produces no page at all, only profile fields.
    const plan = prepareSourceApply({ text: "^JZY", current: current() });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.next.pages).toEqual([{ objects: [] }]);
  });
});
