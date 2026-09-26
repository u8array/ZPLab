import { describe, it, expect } from "vitest";
import { importZplText } from "./zplImportService";
import { generateBatchZpl, generateMultiPageZPL, generateMultiPageZplWithMap } from "./zplGenerator";
import { parseZPL } from "./zplParser";
import { parseDesignFile, serializeDesign } from "./designFile";
import { prepareSourceApply, type SourceDocumentState } from "./zplSourceEdit";
import { canonicalStoredFormatPath, isRecallableFormatPath, storedFormatPathSchema } from "./storagePath";
import { pageLabelConfig, type LabelObject, type Page } from "../types/Group";
import type { LabelConfig, PageLabel } from "../types/LabelConfig";

const label: LabelConfig = { widthMm: 50, heightMm: 30, dpmm: 8 };
const text = (id: string, content: string): LabelObject =>
  ({ id, type: "text", x: 10, y: 10, rotation: 0, props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as never;
const field = "^FO10,10^A0N,30,30^FDa^FS";
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const block = (df: string | null, body: string, jm = "") =>
  ["^XA", ...(df === null ? [] : [`^DF${df}`]), ...(jm ? [jm] : []), body, "^XZ"].join(NL);
const dfLines = (zpl: string) => zpl.split(/\r?\n/).filter((l) => l.startsWith("^DF"));
const withLabel = (imported: ReturnType<typeof importZplText>): LabelConfig => ({ ...label, ...imported.labelConfig });
const span = (start: number, end: number, path?: string, caret = "^") => ({ start, end, caret, ...(path ? { path } : {}) });
/** The pages with page `i` storing under `path`, or nowhere. */
const storing = (pages: Page[], i: number, path: string | undefined): Page[] =>
  pages.map((p, k) => {
    if (k !== i) return p;
    const { storedFormatPath: _old, ...rest } = p;
    return path === undefined ? rest : { ...rest, storedFormatPath: path };
  });

describe("^DF on import", () => {
  it("lands on the page its block stores under, canonical, and is no finding", () => {
    const zpl = [block("E:ONE.ZPL", field), block("r:two", field), block(null, field)].join(NL);
    const imported = importZplText(zpl, 8);
    expect(imported.labelConfig).not.toHaveProperty("storedFormatPath");
    expect(imported.pages.map((p) => p.storedFormatPath)).toEqual(["E:ONE.ZPL", "R:TWO.ZPL", undefined]);
    expect(imported.pages.map((p) => p.overlay?.head?.dfSpans)).toEqual([[span(4, 16, "E:ONE.ZPL")], [span(4, 12, "R:TWO.ZPL")], undefined]);
    expect(imported.report.findings.filter((f) => f.kind === "unknown")).toEqual([]);
  });

  it("reports a ^DF outside the head or with an unusable path, replays it, and reads ^XF as the block's recall", () => {
    const r = parseZPL(`^XA${NL}${field}${NL}^DFE:LATE.ZPL${NL}^XZ${NL}^XA${NL}^DFE:MY LABEL.ZPL${NL}^XFE:X.ZPL^FS${NL}^XZ`, 8);
    expect(r.pages.map((p) => p.storedFormatPath)).toEqual([undefined, undefined]);
    expect(r.pages.map((p) => p.recallFormatPath)).toEqual([undefined, "E:X.ZPL"]);
    expect(r.pages.flatMap((p) => p.findings).map((f) => `${f.kind}:${f.command}`)).toEqual(expect.arrayContaining(["partial:^DF"]));
    expect(r.pages.flatMap((p) => p.findings).some((f) => f.kind === "unknown")).toBe(false);
    const imported = importZplText(block("E:MY LABEL.ZPL", field), 8);
    expect(generateMultiPageZPL(withLabel(imported), imported.pages)).toBe(block("E:MY LABEL.ZPL", field));
  });

  it("reads a wrapper-less stream and a device-less path as the printer does, on R:", () => {
    const imported = importZplText(`^DFlbl.zpl${NL}${field}`, 8);
    expect(imported.pages[0]?.storedFormatPath).toBe("R:LBL.ZPL");
    expect(generateMultiPageZPL(withLabel(imported), imported.pages)).toContain(`^XA${NL}^DFR:LBL.ZPL${NL}`);
    const src = block("LBL.ZPL", field);
    const kept = importZplText(src, 8);
    expect(kept.pages[0]?.storedFormatPath).toBe("R:LBL.ZPL");
    expect(generateMultiPageZPL(withLabel(kept), kept.pages)).toBe(src);
  });

  it("refuses a path the printer could not store, and spells an accepted one one way", () => {
    for (const bad of ["E:X.ZPL\n^FO0,0^GB500,500,20^FS", "Z:X.ZPL", "E:ABCDEFGHIJKLMNOPQ.ZPL", "E:X.GRF", "E:", "X Y"]) {
      expect(storedFormatPathSchema().safeParse(bad).success, bad).toBe(false);
    }
    expect(storedFormatPathSchema().parse("r:lbl")).toBe("R:LBL.ZPL");
    expect(storedFormatPathSchema().parse("lbl.zpl")).toBe("R:LBL.ZPL");
    expect(canonicalStoredFormatPath(" e:Job ")).toBe("E:JOB.ZPL");
    for (const ok of ["ABCDEFGH", "R:ABCDEFGH.ZPL", "e:abcdefgh"]) expect(isRecallableFormatPath(ok), ok).toBe(true);
    for (const long of ["ABCDEFGHI", "R:ABCDEFGHI.ZPL"]) expect(isRecallableFormatPath(long), long).toBe(false);
    const page = (storedFormatPath: string): Page => ({ objects: [text("a", "A")], storedFormatPath });
    expect(parseDesignFile(serializeDesign(label, [page("E:X.ZPL~JB")])).ok).toBe(false);
    const ok = parseDesignFile(serializeDesign(label, [page("r:ok.zpl"), { objects: [text("b", "B")] }]));
    expect(ok.ok && ok.value.pages.map((p) => p.storedFormatPath)).toEqual(["R:OK.ZPL", undefined]);
  });
});

describe("^DF on export", () => {
  it("sits between ^XA and ^JM, without ^FS, and the ^JM span still lands", () => {
    const out = generateMultiPageZplWithMap({ ...label, jmDensity: "B" }, [{ objects: [text("a", "A")], storedFormatPath: "E:LBL.ZPL" }]);
    expect(out.text.startsWith(`^XA${NL}^DFE:LBL.ZPL${NL}^JMB${NL}`)).toBe(true);
    const parsed = parseZPL(out.text, 8);
    expect(parsed.labelConfig.jmDensity).toBe("B");
    expect(parsed.pages[0]?.storedFormatPath).toBe("E:LBL.ZPL");
    const again = importZplText(out.text, 8);
    expect(generateMultiPageZPL(withLabel(again), again.pages)).toBe(out.text);
  });

  it("gives every block its own page's path, or none", () => {
    const pages: Page[] = [{ objects: [text("a", "A")], storedFormatPath: "E:A.ZPL" }, { objects: [text("b", "B")] }, { objects: [text("c", "C")], storedFormatPath: "R:C.ZPL" }];
    expect(dfLines(generateMultiPageZPL(label, pages))).toEqual(["^DFE:A.ZPL", "^DFR:C.ZPL"]);
  });

  it("rewrites, cuts or inserts the ^DF of a replayed block, byte-stable around it", () => {
    const src = [block("E:ONE.ZPL", field, "^JMB"), block(null, "^FO10,10^A0N,30,30^FDb^FS")].join(NL);
    const imported = importZplText(src, 8);
    const pages = imported.pages;
    expect(generateMultiPageZPL(withLabel(imported), pages)).toBe(src);
    const renamed = generateMultiPageZPL(withLabel(imported), storing(storing(pages, 0, "E:NEW.ZPL"), 1, "R:B.ZPL"));
    expect(renamed).toBe(src.replace("^DFE:ONE.ZPL", "^DFE:NEW.ZPL").replace(`^XA${NL}^FO10,10^A0N,30,30^FDb`, `^XA^DFR:B.ZPL${NL}^FO10,10^A0N,30,30^FDb`));
    const cut = generateMultiPageZPL(withLabel(imported), storing(pages, 0, undefined));
    expect(cut).toBe(src.replace(`^DFE:ONE.ZPL${NL}`, ""));
    expect(parseZPL(renamed, 8).labelConfig.jmDensity).toBe("B");
  });

  it("puts a fresh ^JM behind an inserted ^DF, inside the stored format", () => {
    const imported = importZplText(block(null, field), 8);
    const out = generateMultiPageZPL({ ...withLabel(imported), jmDensity: "B" }, storing(imported.pages, 0, "E:X.ZPL"));
    expect(out.startsWith(`^XA^DFE:X.ZPL^JMB${NL}`)).toBe(true);
    expect(parseZPL(out, 8).labelConfig.jmDensity).toBe("B");
  });

  it("owns every ^DF of a head once the model changes, and replays them untouched otherwise", () => {
    const src = `^XA${NL}^DFE:A.ZPL${NL}^DFE:B.ZPL${NL}${field}${NL}^XZ`;
    const imported = importZplText(src, 8);
    expect(imported.pages[0]?.storedFormatPath).toBe("E:A.ZPL");
    expect(generateMultiPageZPL(withLabel(imported), imported.pages)).toBe(src);
    expect(generateMultiPageZPL(withLabel(imported), storing(imported.pages, 0, "E:NEW.ZPL"))).toBe(`^XA${NL}^DFE:NEW.ZPL${NL}${field}${NL}^XZ`);
    expect(generateMultiPageZPL(withLabel(imported), storing(imported.pages, 0, undefined))).toBe(`^XA${NL}${field}${NL}^XZ`);
  });

  it("keeps a ^JM ahead of the ^DF, and one between two, in place through a rename and a density change", () => {
    const ahead = `^XA^JMA^DFE:LBL.ZPL${NL}${field}${NL}^XZ`;
    const a = importZplText(ahead, 8);
    expect(generateMultiPageZPL({ ...withLabel(a), jmDensity: "B" }, storing(a.pages, 0, "E:OTHER.ZPL"))).toBe(`^XA^JMB^DFE:OTHER.ZPL${NL}${field}${NL}^XZ`);
    const between = `^XA^DFE:A.ZPL^JMA^DFE:B.ZPL${NL}${field}${NL}^XZ`;
    const b = importZplText(between, 8);
    expect(generateMultiPageZPL({ ...withLabel(b), jmDensity: "B" }, storing(b.pages, 0, "E:C.ZPL"))).toBe(`^XA^DFE:C.ZPL^JMB${field}${NL}^XZ`);
    const cut = generateMultiPageZPL({ ...withLabel(b), jmDensity: "B" }, storing(b.pages, 0, undefined));
    expect(cut).toBe(`^XA^JMB${field}${NL}^XZ`);
    expect(parseZPL(cut, 8).labelConfig.jmDensity).toBe("B");
  });

  it("puts a fresh ^JM behind the ^DF even when the head's own ^JM is unreadable", () => {
    const imported = importZplText(`^XA^JMX^DFE:A.ZPL${NL}${field}${NL}^XZ`, 8);
    const out = generateMultiPageZPL({ ...withLabel(imported), jmDensity: "B" }, imported.pages);
    expect(out.startsWith("^XA^JMX^DFE:A.ZPL^JMB")).toBe(true);
  });

  it("keeps a head ^DF it could not take until the page names a path, then owns it, along with a usable one", () => {
    const src = `^XA${NL}^DFE:A.ZPL,9${NL}${field}${NL}^XZ`;
    const imported = importZplText(src, 8);
    expect(imported.pages[0]?.storedFormatPath).toBeUndefined();
    expect(generateMultiPageZPL(withLabel(imported), imported.pages)).toBe(src);
    expect(generateMultiPageZPL(withLabel(imported), storing(imported.pages, 0, "E:GOOD.ZPL"))).toBe(src.replace("E:A.ZPL,9", "E:GOOD.ZPL"));
    const mixed = `^XA${NL}^DFE:A.ZPL,9${NL}^DFE:B.ZPL${NL}${field}${NL}^XZ`;
    const m = importZplText(mixed, 8);
    expect(m.pages[0]?.storedFormatPath).toBe("E:B.ZPL");
    expect(generateMultiPageZPL(withLabel(m), m.pages)).toBe(mixed);
    expect(dfLines(generateMultiPageZPL(withLabel(m), storing(m.pages, 0, "E:C.ZPL")))).toEqual(["^DFE:C.ZPL"]);
    expect(generateMultiPageZPL(withLabel(m), storing(m.pages, 0, undefined))).toBe(`^XA${NL}${field}${NL}^XZ`);
  });

  it("cuts and renames across CRLF and a ^CC remap without stray bytes", () => {
    const crlf = `^XA${CR}${NL}^DFE:A.ZPL${CR}${NL}^JMB${CR}${NL}${field}${CR}${NL}^XZ`;
    const c = importZplText(crlf, 8);
    expect(generateMultiPageZPL(withLabel(c), storing(c.pages, 0, undefined))).toBe(`^XA${CR}${NL}^JMB${CR}${NL}${field}${CR}${NL}^XZ`);
    expect(generateMultiPageZPL(withLabel(c), storing(c.pages, 0, "E:B.ZPL"))).toBe(crlf.replace("E:A.ZPL", "E:B.ZPL"));
    const remapped = `^XA${NL}^CC#${NL}#DFE:A.ZPL${NL}#JMB${NL}#FO10,10#A0N,30,30#FDa#FS${NL}#XZ`;
    const r = importZplText(remapped, 8);
    expect(r.pages[0]?.storedFormatPath).toBe("E:A.ZPL");
    expect(generateMultiPageZPL(withLabel(r), r.pages)).toBe(remapped);
    expect(generateMultiPageZPL(withLabel(r), storing(r.pages, 0, "E:B.ZPL"))).toBe(remapped.replace("#DFE:A.ZPL", "#DFE:B.ZPL"));
  });

  it("refuses a persisted span that reaches past the ^DF, and regenerates instead of cutting", () => {
    const imported = importZplText(block("E:A.ZPL", field), 8);
    const raw = JSON.parse(serializeDesign(label, imported.pages)) as { pages: { overlay: { head: { dfSpans: { end: number }[] } } }[] };
    raw.pages[0]!.overlay.head.dfSpans[0]!.end += field.length + 1;
    const loaded = parseDesignFile(JSON.stringify(raw));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const out = generateMultiPageZPL(loaded.value.label, storing(loaded.value.pages, 0, "E:B.ZPL"));
    expect(out).toContain("^DFE:B.ZPL");
    expect(out).toContain("^FDa^FS");
  });

  it("stores the batch template under the page's recallable name, once, and recalls it bare", () => {
    const named = generateBatchZpl({ ...label, storedFormatPath: "E:JOB.ZPL" } as PageLabel, [text("a", "A")], [], { headers: [], rows: [[], []] }, { bindings: {} });
    expect(dfLines(named)).toEqual(["^DFE:JOB.ZPL"]);
    expect(named.match(/\^XFE:JOB\.ZPL/g)).toHaveLength(2);
    // No ^FS ahead of the ^XF: the recalled ^JM counts only before the first one (p.269).
    expect(named).toContain(`^XA${NL}^XFE:JOB.ZPL${NL}`);
    const unnamed = generateBatchZpl(label as PageLabel, [text("a", "A")], [], { headers: [], rows: [[]] }, { bindings: {} });
    expect(dfLines(unnamed)).toEqual(["^DFR:LBL.ZPL"]);
    // A name ^XF cannot read (p.372) stays a ^DF for export, but the batch falls back to the volatile default.
    const long = generateBatchZpl({ ...label, storedFormatPath: "E:ABCDEFGHIJ.ZPL" } as PageLabel, [text("a", "A")], [], { headers: [], rows: [[]] }, { bindings: {} });
    expect(dfLines(long)).toEqual(["^DFR:LBL.ZPL"]);
  });
});

describe("^DF in the design file, the source pane and the page label", () => {
  it("round-trips the page field and reads a legacy raw ^DF into the model", () => {
    const pages: Page[] = [{ objects: [text("a", "A")], storedFormatPath: "E:A.ZPL" }, { objects: [text("b", "B")] }];
    const parsed = parseDesignFile(serializeDesign(label, pages));
    expect(parsed.ok && parsed.value.pages.map((p) => p.storedFormatPath)).toEqual(["E:A.ZPL", undefined]);

    const imported = importZplText(block("E:OLD.ZPL", field), 8);
    const legacy = JSON.parse(serializeDesign(label, imported.pages)) as { pages: { storedFormatPath?: string; overlay?: { head?: Record<string, unknown> } }[] };
    delete legacy.pages[0]?.storedFormatPath;
    delete legacy.pages[0]?.overlay?.head?.dfSpans;
    const loaded = parseDesignFile(JSON.stringify(legacy));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages[0]?.storedFormatPath).toBe("E:OLD.ZPL");
    expect(loaded.value.pages[0]?.overlay?.head?.dfSpans).toEqual([span(4, 16, "E:OLD.ZPL")]);
  });

  it("follows the pane in both directions", () => {
    const pages: Page[] = [{ objects: [text("a", "A")] }];
    const current = (p: Page[]): SourceDocumentState => ({ label, pages: p, variables: [], printerProfile: {}, columnMapping: null });
    const baseline = generateMultiPageZPL(label, pages);
    const added = prepareSourceApply({ text: baseline.replace(`^XA${NL}`, `^XA${NL}^DFE:PANE.ZPL${NL}`), baseline, current: current(pages) });
    expect(added.ok && added.next.pages[0]?.storedFormatPath).toBe("E:PANE.ZPL");
    const stored = generateMultiPageZPL(label, storing(pages, 0, "E:PANE.ZPL"));
    const removed = prepareSourceApply({ text: stored.replace(`^DFE:PANE.ZPL${NL}`, ""), baseline: stored, current: current(storing(pages, 0, "E:PANE.ZPL")) });
    expect(removed.ok && removed.next.pages[0]?.storedFormatPath).toBeUndefined();
  });

  it("folds the page's ^DF into its label and never another page's", () => {
    expect(pageLabelConfig(label, {})).toBe(label);
    expect(pageLabelConfig(label, { storedFormatPath: "R:B.ZPL" }).storedFormatPath).toBe("R:B.ZPL");
    const carried = pageLabelConfig(label, { storedFormatPath: "R:B.ZPL" });
    expect(pageLabelConfig(carried, {}).storedFormatPath).toBeUndefined();
  });
});
