import { describe, it, expect } from "vitest";
import { prepareSourceApply, type SourceDocumentState } from "./zplSourceEdit";
import { generateMultiPageZPL } from "./zplGenerator";
import { importZplText } from "./zplImportService";
import type { LabelConfig } from "../types/LabelConfig";
import type { LabelObject, Page } from "../types/Group";
import type { Variable } from "../types/Variable";

const NL = String.fromCharCode(10);
const label: LabelConfig = { widthMm: 70, heightMm: 40, dpmm: 8 };
type Over = Partial<Omit<LabelObject, "props">> & { props?: unknown };
const textProps = (content: string) => ({ content, fontHeight: 30, fontWidth: 0, rotation: "N" });
const leaf = (id: string, over: Over = {}): LabelObject =>
  ({ id, type: "text", x: 20, y: 90, rotation: 0, props: textProps(id), ...over }) as never;
const hidden = (id: string, over: Over = {}): LabelObject => leaf(id, { includeInExport: false, ...over });
const content = (o: LabelObject | undefined) => (o as { props?: { content?: string } } | undefined)?.props?.content;
const group = (id: string, children: LabelObject[], over: Partial<LabelObject> = {}): LabelObject =>
  ({ id, type: "group", x: 0, y: 0, rotation: 0, children, ...over }) as never;

const current = (pages: Page[], variables: Variable[] = []): SourceDocumentState =>
  ({ label, pages, variables, printerProfile: {}, columnMapping: null });

/** Apply `edit(baseline)` as the buffer; the baseline is the export of `pages`. */
const apply = (pages: Page[], edit: (baseline: string) => string = (b) => b, variables: Variable[] = []) => {
  const baseline = generateMultiPageZPL(label, pages, variables);
  const plan = prepareSourceApply({ text: edit(baseline), baseline, current: current(pages, variables) });
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error("refused");
  return plan;
};
const ids = (page: Page | undefined) => (page?.objects ?? []).map((o) => o.id);
const hiddenIds = (page: Page | undefined) => (page?.objects ?? []).filter((o) => o.includeInExport === false).map((o) => o.id);
const line = (id: string) => `^FD${id}^FS`;
/** The whole emitted line that prints `id`, including its line break. */
const lineOf = (text: string, id: string): string => {
  const at = text.indexOf(line(id));
  const start = text.lastIndexOf(NL, at) + 1;
  const end = text.indexOf(NL, at);
  return text.slice(start, end === -1 ? text.length : end + 1);
};

describe("hidden objects across a source apply", () => {
  it("stay in place on a value edit, with byte-identical re-export", () => {
    const plan = apply([{ objects: [leaf("a"), hidden("h"), leaf("b")] }], (b) => b.replace("^FDb^FS", "^FDB^FS"));
    expect(hiddenIds(plan.next.pages[0])).toEqual(["h"]);
    expect(ids(plan.next.pages[0]).indexOf("h")).toBe(1);
    expect(plan.loss.excludedLost).toBe(0);
  });

  it("survive when every printing field of the page is edited", () => {
    const plan = apply([{ objects: [leaf("a"), hidden("h")] }], (b) => b.replace(line("a"), line("A")));
    expect(ids(plan.next.pages[0]).indexOf("h")).toBe(1);
  });

  it("keep their z-order when the field below them is deleted", () => {
    const plan = apply([{ objects: [leaf("a"), hidden("h"), leaf("b")] }], (b) => b.replace(lineOf(b, "a"), ""));
    expect(ids(plan.next.pages[0]).indexOf("h")).toBe(0);
  });

  it("stay right behind their predecessor when a field is inserted after it", () => {
    const plan = apply([{ objects: [leaf("a"), hidden("h"), leaf("b")] }], (b) =>
      b.replace(line("a"), `${line("a")}${NL}^FO20,10^A0N,30,30${line("new")}`));
    const order = ids(plan.next.pages[0]);
    expect(order.indexOf("h")).toBe(1);
    expect(order).toHaveLength(4);
  });

  it("keep two adjacent hidden siblings in order", () => {
    const plan = apply([{ objects: [leaf("a"), hidden("h1"), hidden("h2")] }]);
    const order = ids(plan.next.pages[0]);
    expect(order).toHaveLength(3);
    expect(order.slice(1)).toEqual(["h1", "h2"]);
  });

  it("stay above identical neighbours", () => {
    const dup = (id: string) => leaf(id, { props: textProps("dup") });
    const plan = apply([{ objects: [dup("d1"), dup("d2"), hidden("h")] }]);
    expect(ids(plan.next.pages[0]).indexOf("h")).toBe(2);
  });

  it("follow their page when two blocks are swapped", () => {
    const pages: Page[] = [{ objects: [leaf("a"), hidden("h")] }, { objects: [leaf("z1"), leaf("z2")] }];
    const plan = apply(pages, () => generateMultiPageZPL(label, [pages[1]!, pages[0]!]));
    expect(hiddenIds(plan.next.pages[0])).toEqual([]);
    expect(hiddenIds(plan.next.pages[1])).toEqual(["h"]);
    expect(plan.loss.excludedLost).toBe(0);
  });

  it("survive on an untouched page when another page is added or removed", () => {
    const pages: Page[] = [{ objects: [leaf("a")] }, { objects: [leaf("b"), hidden("h")] }];
    const added = apply(pages, () => generateMultiPageZPL(label, [pages[0]!, { objects: [leaf("n")] }, pages[1]!]));
    expect(hiddenIds(added.next.pages[2])).toEqual(["h"]);
    const removed = apply(pages, () => generateMultiPageZPL(label, [pages[1]!]));
    expect(hiddenIds(removed.next.pages[0])).toEqual(["h"]);
    expect(removed.loss.excludedLost).toBe(0);
  });

  it("drop with the page the edit removed, and say so, whatever trails the last ^XZ", () => {
    const pages: Page[] = [{ objects: [leaf("a")] }, { objects: [leaf("b"), hidden("h")] }];
    for (const tail of ["", NL, " ", `${NL}${NL}`]) {
      const plan = apply(pages, () => generateMultiPageZPL(label, [pages[0]!]) + tail);
      expect(plan.next.pages).toHaveLength(1);
      expect(hiddenIds(plan.next.pages[0])).toEqual([]);
      expect(plan.loss.excludedLost).toBe(1);
    }
  });

  it("stay on a hidden-only page through a no-op, a page appended, a page prepended and a page removed elsewhere", () => {
    const pages: Page[] = [{ objects: [leaf("a")] }, { objects: [hidden("h")] }, { objects: [leaf("z")] }];
    expect(hiddenIds(apply(pages).next.pages[1])).toEqual(["h"]);
    const appended = apply(pages, () => generateMultiPageZPL(label, [...pages, { objects: [leaf("tail")] }]));
    expect(appended.next.pages.map(hiddenIds)).toEqual([[], ["h"], [], []]);
    const prepended = apply(pages, () => generateMultiPageZPL(label, [{ objects: [leaf("head")] }, ...pages]));
    expect(prepended.next.pages.map(hiddenIds)).toEqual([[], [], ["h"], []]);
    const removed = apply(pages, () => generateMultiPageZPL(label, [pages[1]!, pages[2]!]));
    expect(removed.next.pages.map(hiddenIds)).toEqual([["h"], []]);
    expect(removed.loss.excludedLost).toBe(0);
    const before = apply(pages, () => generateMultiPageZPL(label, [pages[0]!, { objects: [leaf("n")] }, pages[1]!, pages[2]!]));
    expect(before.next.pages.map(hiddenIds)).toEqual([[], [], ["h"], []]);
  });

  it("stay on their page when only lines repeated on every page survive there", () => {
    const pages: Page[] = [{ objects: [leaf("A"), leaf("B"), leaf("C"), hidden("H0")] }, { objects: [leaf("A"), leaf("B"), leaf("D"), hidden("H1")] }];
    const plan = apply(pages, () => generateMultiPageZPL(label, [{ objects: [leaf("A"), leaf("B")] }, { objects: [leaf("A"), leaf("B"), leaf("E")] }]));
    expect(plan.next.pages.map(hiddenIds)).toEqual([["H0"], ["H1"]]);
    expect(plan.loss.excludedLost).toBe(0);
  });

  it("stay in place on equal pages when one of them is edited", () => {
    const pages: Page[] = [{ objects: [leaf("p0a", { props: textProps("A") }), leaf("p0b", { props: textProps("B") }), hidden("H0")] }, { objects: [leaf("p1a", { props: textProps("A") }), leaf("p1b", { props: textProps("B") }), hidden("H1")] }];
    const plan = apply(pages, (b) => b.replace("^FDB^FS", "^FDZ^FS"));
    expect(plan.next.pages.map(hiddenIds)).toEqual([["H0"], ["H1"]]);
    expect(plan.loss.excludedLost).toBe(0);
  });

  it("stay put when only shared lines print and bytes trail the last ^XZ", () => {
    const pages: Page[] = [{ objects: [leaf("s1", { props: textProps("same") }), hidden("H0")] }, { objects: [leaf("s2", { props: textProps("same") }), leaf("t", { props: textProps("same2") }), hidden("H1")] }, { objects: [leaf("s3", { props: textProps("same") }), hidden("H2")] }];
    for (const tail of [`${NL}${NL}`, " ", `${NL}^FXpad^FS`, " ^FXpad^FS", "~JA"]) {
      const plan = apply(pages, (b) => b.replace(lineOf(b, "same2"), "") + tail);
      expect(plan.next.pages.map(hiddenIds)).toEqual([["H0"], ["H1"], ["H2"]]);
    }
  });

  it("follow a hidden-only page moved backwards", () => {
    const pages: Page[] = [{ objects: [leaf("a"), leaf("b")] }, { objects: [hidden("h")] }];
    const plan = apply(pages, () => generateMultiPageZPL(label, [{ objects: [] }, { objects: [leaf("a"), leaf("b")] }]));
    expect(plan.next.pages.map(hiddenIds)).toEqual([["h"], []]);
  });

  it("stay put when a reprint sits on the page their anchor moved to", () => {
    const pages: Page[] = [
      { objects: [leaf("a0", { props: textProps("ANCHOR0") }), leaf("c0", { props: textProps("COMMON") }), hidden("h0", { props: textProps("H0") })] },
      { objects: [leaf("a1", { props: textProps("ANCHOR1") }), leaf("c1", { props: textProps("COMMON") })] },
      { objects: [leaf("a2", { props: textProps("ANCHOR2") }), leaf("c2", { props: textProps("COMMON") })] },
    ];
    const plan = apply(pages, () => generateMultiPageZPL(label, [
      { objects: [leaf("x", { props: textProps("ANCHOR2") }), leaf("y", { props: textProps("COMMON") })] },
      { objects: [leaf("p", { props: textProps("ANCHOR0") }), leaf("q", { props: textProps("COMMONX") }), leaf("r", { props: textProps("H0") })] },
      { objects: [leaf("s", { props: textProps("ANCHOR1") }), leaf("t", { props: textProps("COMMON") })] },
    ]));
    expect(plan.next.pages.map((p) => p.objects.map((o) => [content(o), o.includeInExport]))).toEqual([
      [["ANCHOR2", undefined], ["COMMON", undefined]],
      [["ANCHOR0", undefined], ["COMMONX", undefined], ["H0", false]],
      [["ANCHOR1", undefined], ["COMMON", undefined]],
    ]);
  });

  it("stay on a page that lost its only printing field, first or last", () => {
    const pages: Page[] = [{ objects: [leaf("a"), hidden("h")] }, { objects: [leaf("b"), hidden("k")] }];
    for (const id of ["a", "b"]) {
      const plan = apply(pages, (b) => b.replace(lineOf(b, id), ""));
      expect(plan.next.pages.map(hiddenIds)).toEqual([["h"], ["k"]]);
      expect(plan.loss.excludedLost).toBe(0);
    }
  });

  it("anchor behind the previous field when their predecessor turned into a non-field line", () => {
    const plan = apply([{ objects: [leaf("a"), leaf("b"), hidden("h")] }], (b) => b.replace(lineOf(b, "b").trimEnd(), "^LH0,0"));
    expect(ids(plan.next.pages[0])).toHaveLength(2);
    expect(ids(plan.next.pages[0]).indexOf("h")).toBe(1);
  });

  it("get their editor state back when an older buffer prints them again", () => {
    const x = hidden("x", { name: "Watermark", locked: true, visible: false, comment: "keep" });
    const plan = apply([{ objects: [leaf("a"), x] }], () => generateMultiPageZPL(label, [{ objects: [leaf("a"), leaf("x", { comment: "old" })] }]));
    const objects = plan.next.pages[0]?.objects ?? [];
    expect(objects).toHaveLength(2);
    // Editor state from the model, the ^FX comment from the buffer: it is what the user pasted.
    expect(objects.find((o) => o.includeInExport === false)).toMatchObject({ name: "Watermark", locked: true, visible: false, comment: "old" });
    expect(plan.loss.excludedLost).toBe(0);
  });

  it("recognise a reprint before their successor and at the tail of a page", () => {
    const lead = apply([{ objects: [hidden("h"), leaf("a")] }], () => generateMultiPageZPL(label, [{ objects: [leaf("h"), leaf("a")] }]));
    expect(lead.next.pages[0]?.objects.map((o) => [content(o), o.includeInExport])).toEqual([["h", false], ["a", undefined]]);
    const tail = apply([{ objects: [hidden("x"), hidden("y")] }], () => generateMultiPageZPL(label, [{ objects: [leaf("x"), leaf("y")] }]));
    expect(tail.next.pages[0]?.objects.map((o) => [content(o), o.includeInExport])).toEqual([["x", false], ["y", false]]);
  });

  it("recognise a reprinted hidden field bound to a variable", () => {
    const variables: Variable[] = [{ id: "v1", name: "LOT", fnNumber: 1, defaultValue: "L42" }];
    const pages: Page[] = [{ objects: [leaf("t", { props: textProps("Lot «LOT»") }), hidden("h", { name: "H", props: textProps("Hid «LOT»") })] }];
    const older = generateMultiPageZPL(label, [{ objects: [leaf("t", { props: textProps("Lot «LOT»") }), leaf("h", { props: textProps("Hid «LOT»") })] }], variables);
    const plan = apply(pages, () => older, variables);
    expect(plan.next.pages[0]?.objects).toHaveLength(2);
    expect(plan.next.pages[0]?.objects[1]).toMatchObject({ name: "H", includeInExport: false });
  });

  it("recognise a reprint under a ^LH or ^LT the buffer added", () => {
    for (const header of ["^LH10,0", "^LT10"]) {
      const older = generateMultiPageZPL(label, [{ objects: [leaf("A"), leaf("X")] }]).replace("^PW560", `${header}${NL}^PW560`);
      const plan = apply([{ objects: [leaf("A"), hidden("X")] }], () => older);
      expect(plan.next.pages[0]?.objects.map((o) => [content(o), o.includeInExport])).toEqual([["A", undefined], ["X", false]]);
    }
  });

  it("unfold a candidate with the ^LH in force where it was parsed, not the page's last", () => {
    const pages: Page[] = [{ objects: [leaf("a"), hidden("w", { x: 10, props: textProps("WM") }), leaf("b")] }];
    const typed = (b: string) => b.replace(lineOf(b, "a"), `${lineOf(b, "a")}^FO20,90^A0N,30,0^FDWM^FS${NL}`).replace(lineOf(b, "b"), `${lineOf(b, "b")}^LH10,0${NL}`);
    const plan = apply(pages, typed);
    expect(generateMultiPageZPL(plan.next.label, plan.next.pages, plan.next.variables)).toContain("^FDWM^FS");
    expect(hiddenIds(plan.next.pages[0])).toEqual(["w"]);
  });

  it("unfold a candidate with the ^LH its opener saw, even when ^LH sits inside the field", () => {
    const pages: Page[] = [{ objects: [leaf("a"), hidden("w", { x: 20, props: textProps("WM") }), leaf("b")] }];
    const plan = apply(pages, (b) => b.replace(lineOf(b, "b"), `^FO30,90^A0N,30,0^LH10,0^FDWM^FS${NL}${lineOf(b, "b")}`));
    expect(generateMultiPageZPL(plan.next.label, plan.next.pages, plan.next.variables)).toContain("^FDWM^FS");
    expect(hiddenIds(plan.next.pages[0])).toEqual(["w"]);
  });

  it("recognise reprints with a new field typed between them", () => {
    const older = generateMultiPageZPL(label, [{ objects: [leaf("a"), leaf("x"), leaf("y")] }]);
    const text = older.replace(lineOf(older, "y"), `^FO20,10^A0N,30,30^FDnew^FS${NL}${lineOf(older, "y")}`);
    const plan = apply([{ objects: [leaf("a"), hidden("x"), hidden("y")] }], () => text);
    expect(plan.next.pages[0]?.objects.map((o) => [content(o), o.includeInExport])).toEqual([["a", undefined], ["x", false], ["y", false], ["new", undefined]]);
  });

  it("recognise a run reprinted in another order", () => {
    const plan = apply([{ objects: [leaf("a"), hidden("x"), hidden("y")] }], () => generateMultiPageZPL(label, [{ objects: [leaf("a"), leaf("y"), leaf("x")] }]));
    expect(plan.next.pages[0]?.objects.map((o) => [content(o), o.includeInExport])).toEqual([["a", undefined], ["x", false], ["y", false]]);
  });

  it("map two reprinted identical hidden siblings one to one", () => {
    const dup = (id: string, over: Over = {}) => leaf(id, { props: textProps("dup"), ...over });
    const plan = apply([{ objects: [leaf("a"), dup("d1", { includeInExport: false }), dup("d2", { includeInExport: false })] }],
      () => generateMultiPageZPL(label, [{ objects: [leaf("a"), dup("d1"), dup("d2")] }]));
    expect(hiddenIds(plan.next.pages[0])).toHaveLength(2);
    expect(generateMultiPageZPL(plan.next.label, plan.next.pages, plan.next.variables)).not.toContain("^FDdup^FS");
  });

  it("rebuild a partly reprinted hidden group as a group, its lock and exclusion staying on the group", () => {
    const g = group("g", [leaf("c1"), group("gg", [leaf("c2")])], { includeInExport: false, locked: true });
    for (const edit of [(b: string) => b, () => generateMultiPageZPL(label, [{ objects: [leaf("a"), leaf("c1")] }])]) {
      const plan = apply([{ objects: [leaf("a"), g] }], edit);
      const back = (plan.next.pages[0]?.objects ?? []).filter((o) => o.includeInExport === false);
      expect(back).toHaveLength(1);
      expect(back[0]).toMatchObject({ id: "g", locked: true });
      const children = (back[0] as { children: LabelObject[] }).children;
      const nested = (children[1] as { children: LabelObject[] }).children;
      for (const o of [...children, ...nested]) expect([o.locked, o.includeInExport]).toEqual([undefined, undefined]);
    }
  });

  it("rename markers like the reparse and keep a variable only they reference", () => {
    const variables: Variable[] = [{ id: "v1", name: "LOT", fnNumber: 1, defaultValue: "L42" }];
    const bound = leaf("t", { props: textProps("Lot «LOT»") });
    const hid = hidden("h", { props: { content: "Hid «LOT»", fontHeight: 30, fontWidth: 0, rotation: "N" } } as never);
    const renamed = apply([{ objects: [bound, hid] }], (b) => b, variables);
    const name = renamed.next.variables.find((v) => v.fnNumber === 1)?.name;
    expect((renamed.next.pages[0]?.objects.find((o) => o.id === "h") as { props: { content: string } }).props.content).toBe(`Hid «${name}»`);
    const only = apply([{ objects: [leaf("a"), hid] }], (b) => b, variables);
    expect(only.next.variables.map((v) => v.name)).toEqual(["LOT"]);
  });

  it("replay foreign bytes verbatim around a carried object", () => {
    const src = ["^XA", "^PW800", "^FXnote", "^FO50,50^A0N,30,30^FDHello^FS", "^XZ"].join(NL);
    const imported = importZplText(src, label.dpmm);
    const pages: Page[] = [{ ...imported.pages[0]!, objects: [...imported.pages[0]!.objects, hidden("h")] }];
    const baseline = generateMultiPageZPL(label, pages);
    expect(baseline).toBe(src);
    const plan = prepareSourceApply({ text: src, baseline, current: current(pages) });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(hiddenIds(plan.next.pages[0])).toEqual(["h"]);
    expect(generateMultiPageZPL(plan.next.label, plan.next.pages, plan.next.variables)).toBe(src);
  });

  it("keep their z-order and their group when an older export reprints a member", () => {
    const g = group("g", [leaf("c1"), leaf("c2")], { includeInExport: false, name: "Grp", locked: true });
    const pages: Page[] = [{ objects: [leaf("a"), g] }];
    const reprint = (id: string) => (b: string) => b.replace(line("a"), `${line("a")}${NL}${lineOf(generateMultiPageZPL(label, [{ objects: [leaf(id)] }]), id).trimEnd()}`);
    for (const id of ["c1", "c2"]) {
      const plan = apply(pages, reprint(id));
      const objects = plan.next.pages[0]?.objects ?? [];
      expect(objects).toHaveLength(2);
      const back = objects[1]!;
      expect(back).toMatchObject({ type: "group", name: "Grp", includeInExport: false });
      expect((back as { children: LabelObject[] }).children.map(content)).toEqual(["c1", "c2"]);
      expect(plan.loss.excludedLost).toBe(0);
    }
  });

  it("leave a field the user typed alone, even when its bytes equal a hidden object's", () => {
    const pages: Page[] = [{ objects: [leaf("a"), hidden("w", { props: textProps("WM") }), leaf("b")] }];
    const typed = lineOf(generateMultiPageZPL(label, [{ objects: [leaf("w", { props: textProps("WM") })] }]), "WM").trimEnd();
    // Typed below b, away from the hidden object's slot: it prints, the hidden one is carried.
    const plan = apply(pages, (b) => b.replace(line("b"), `${line("b")}${NL}${typed}`));
    expect(generateMultiPageZPL(plan.next.label, plan.next.pages, plan.next.variables)).toContain("^FDWM^FS");
    expect(hiddenIds(plan.next.pages[0])).toEqual(["w"]);
  });

  it("do not carry without a usable baseline", () => {
    const pages: Page[] = [{ objects: [leaf("a"), hidden("h")] }];
    const plan = prepareSourceApply({ text: generateMultiPageZPL(label, pages), current: current(pages) });
    expect(plan.ok && hiddenIds(plan.next.pages[0])).toEqual([]);
  });
});

describe("unchanged printing objects across a source apply", () => {
  it("keep name, lock and hiding when their lines survived the edit", () => {
    const named = leaf("n", { name: "Title", locked: true, visible: false });
    const plan = apply([{ objects: [named, leaf("b")] }], (b) => b.replace(line("b"), line("B")));
    const kept = plan.next.pages[0]?.objects[0];
    expect(kept).toMatchObject({ name: "Title", locked: true, visible: false, type: "text" });
    expect(plan.loss.namesLost + plan.loss.lockedLost + plan.loss.hiddenLost).toBe(0);
  });

  it("lose them when their own line was edited, and say so", () => {
    const named = leaf("n", { name: "Title" });
    const plan = apply([{ objects: [named]}], (b) => b.replace(line("n"), line("N")));
    expect(plan.loss.namesLost).toBe(1);
  });

  it("keep a rotated QR a QR through its sidecar, with its name, commented or not", () => {
    for (const comment of [undefined, "scan me"]) {
      const qr = { id: "q", type: "qrcode", x: 10, y: 10, rotation: 90, name: "Code", locked: true, comment,
        props: { content: "https://example.test", magnification: 4, errorCorrection: "M", model: 2, rotation: "R" } } as never as LabelObject;
      const plan = apply([{ objects: [qr, leaf("b")] }], (b) => b.replace(line("b"), line("B")));
      expect(plan.next.pages[0]?.objects[0]).toMatchObject({ type: "qrcode", name: "Code", locked: true });
    }
  });

  it("take markers, coordinates and comments from the buffer, never from the model", () => {
    const variables: Variable[] = [{ id: "v1", name: "LOT", fnNumber: 1, defaultValue: "L42" }];
    const bound = leaf("t", { name: "Field", props: textProps("Lot «LOT»") });
    const noop = apply([{ objects: [bound, hidden("h")] }], (b) => b, variables);
    const name = noop.next.variables.find((v) => v.fnNumber === 1)?.name;
    expect(content(noop.next.pages[0]?.objects[0])).toBe(`Lot «${name}»`);
    expect(noop.next.pages[0]?.objects[0]).toMatchObject({ name: "Field" });
    expect(generateMultiPageZPL(noop.next.label, noop.next.pages.map((p) => ({ ...p, overlay: undefined })), noop.next.variables)).toContain("^FN1");

    const home = apply([{ objects: [leaf("a", { name: "K" }), leaf("b"), hidden("h")] }], (b) => b.replace("^PW560", `^LH80,80${NL}^PW560`).replace(line("b"), line("B")));
    const xs = (home.next.pages[0]?.objects ?? []).filter((o) => o.includeInExport !== false).map((o) => o.x);
    expect(new Set(xs).size).toBe(1);

    const commented = apply([{ objects: [leaf("n", { name: "Title" }), hidden("h")] }], (b) => b.replace(lineOf(b, "n"), `^FXhello^FS${NL}${lineOf(b, "n")}`));
    expect(commented.next.pages[0]?.objects[0]).toMatchObject({ name: "Title", comment: "hello" });
  });

  it("keep identity across a ^CC, ^CT or ^CD remap of the whole buffer", () => {
    const pages: Page[] = [{ objects: [leaf("a", { name: "Title", locked: true }), hidden("h")] }];
    const remapFrom = (b: string, cmd: string, edit: (tail: string) => string) => {
      const at = b.indexOf(NL) + 1;
      return `${b.slice(0, at)}${cmd}${NL}${edit(b.slice(at))}`;
    };
    const remaps: ((b: string) => string)[] = [
      (b) => remapFrom(b, "^CC!", (t) => t.replace(/\^/g, "!")),
      (b) => remapFrom(b, "^CD;", (t) => t.split(NL).map((l) => (l.startsWith("^FO") ? l.replace(/,/g, ";") : l)).join(NL)),
      (b) => remapFrom(b, "^CT|", (t) => t),
    ];
    for (const remap of remaps) {
      const plan = apply(pages, remap);
      expect(plan.next.pages[0]?.objects[0]).toMatchObject({ name: "Title", locked: true });
      expect(hiddenIds(plan.next.pages[0])).toEqual(["h"]);
      expect(plan.loss.namesLost + plan.loss.lockedLost).toBe(0);
    }
  });

  it("keep identity when only the ^FX comment of a field changes", () => {
    const plan = apply([{ objects: [leaf("n", { name: "Title", locked: true, comment: "old" }), hidden("h")] }], (b) => b.replace("^FXold", "^FXnew"));
    expect(plan.next.pages[0]?.objects[0]).toMatchObject({ name: "Title", locked: true, comment: "new" });
    expect(plan.loss.namesLost + plan.loss.lockedLost).toBe(0);
  });

  it("never let an inserted line borrow a commented field's identity", () => {
    const pages: Page[] = [{ objects: [leaf("a", { name: "Aname", comment: "note" }), leaf("b")] }];
    const plan = apply(pages, (b) => b.replace("^FXnote", `^FXnote${NL}^FO60,95^A0N,30,30^FDNEW^FS`));
    const contents = (plan.next.pages[0]?.objects ?? []).map(content);
    expect(contents).toEqual(["NEW", "a", "b"]);
    expect(plan.next.pages[0]?.objects[1]).toMatchObject({ name: "Aname" });
  });

  it("carry a variable under a name the reparse left free", () => {
    const variables: Variable[] = [{ id: "v1", name: "LOT", fnNumber: 1, defaultValue: "L42" }, { id: "v2", name: "field_1", fnNumber: 3, defaultValue: "x" }];
    const bound = leaf("t", { props: textProps("Lot «LOT»") });
    const hid = hidden("h", { props: textProps("Hid «field_1»") });
    const plan = apply([{ objects: [bound, hid] }], (b) => b.replace("^LL320", "^LL400"), variables);
    const names = plan.next.variables.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    const carriedName = plan.next.variables.find((v) => v.fnNumber === 3)?.name;
    const keptName = plan.next.variables.find((v) => v.fnNumber === 1)?.name;
    expect(content(plan.next.pages[0]?.objects.find((o) => o.id === "h"))).toBe(`Hid «${carriedName}»`);
    expect(content(plan.next.pages[0]?.objects[0])).toBe(`Lot «${keptName}»`);
    expect(generateMultiPageZPL(plan.next.label, plan.next.pages.map((p) => ({ ...p, overlay: undefined })), plan.next.variables)).toContain("^FN1^FDL42^FS");
  });

  it("carry through an LF-normalised buffer of a CRLF baseline", () => {
    const pages: Page[] = [{ objects: [leaf("n", { name: "Title" }), hidden("h")] }];
    const baseline = generateMultiPageZPL(label, pages).replace(/\n/g, "\r\n");
    const crlfCurrent = current(pages);
    // The baseline must be the regenerated text: model this with a CRLF overlay page.
    const imported = importZplText(baseline, label.dpmm);
    const crlfPages: Page[] = [{ ...imported.pages[0]!, objects: [...imported.pages[0]!.objects.map((o, i) => (i === 0 ? { ...o, name: "Title" } : o)), hidden("h")] }];
    const base = generateMultiPageZPL(label, crlfPages);
    expect(base).toBe(baseline);
    const plan = prepareSourceApply({ text: base.replace(/\r\n/g, "\n"), baseline: base, current: { ...crlfCurrent, pages: crlfPages } });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next.pages[0]?.objects[0]).toMatchObject({ name: "Title" });
    expect(hiddenIds(plan.next.pages[0])).toEqual(["h"]);
  });
});

describe("the applied model prints what the buffer says", () => {
  const rnd = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const printed = (zpl: string) => [...zpl.matchAll(/\^F[DN]([^^]*)/g)].map((m) => m[1]).sort();

  it("holds over random single-line edits (fuzz)", () => {
    const rand = rnd(7);
    let checked = 0;
    for (let i = 0; i < 150; i++) {
      const n = 2 + Math.floor(rand() * 4);
      const variables: Variable[] = rand() < 0.5 ? [{ id: "v1", name: "LOT", fnNumber: 1, defaultValue: "L42" }, { id: "v2", name: "field_1", fnNumber: 3, defaultValue: "S" }] : [];
      const objects: LabelObject[] = [];
      for (let j = 0; j < n; j++) {
        const id = `o${j}`;
        const over: Over = {};
        if (rand() < 0.4) over.name = `N${j}`;
        if (rand() < 0.3) over.comment = `c${j}`;
        if (rand() < 0.3) over.includeInExport = false;
        if (variables.length > 0 && rand() < 0.5) over.props = textProps(`${id} «${rand() < 0.5 ? "LOT" : "field_1"}»`);
        objects.push(leaf(id, { y: 20 + j * 30, ...over }));
      }
      const pages: Page[] = [{ objects }];
      const baseline = generateMultiPageZPL(label, pages, variables);
      const lines = baseline.split(NL);
      const fieldIdx = lines.map((l, k) => (l.includes("^FD") ? k : -1)).filter((k) => k >= 0);
      if (fieldIdx.length === 0) continue;
      const pick = fieldIdx[Math.floor(rand() * fieldIdx.length)]!;
      const op = Math.floor(rand() * 4);
      const edited = [...lines];
      if (op === 0) edited.splice(pick, 1);
      else if (op === 1) edited.splice(pick, 0, lines[pick]!);
      else if (op === 2) edited[pick] = lines[pick]!.replace(/\^FD([^^]*)\^FS/, "^FD$1x^FS");
      else if (fieldIdx.length > 1) {
        const other = fieldIdx[(fieldIdx.indexOf(pick) + 1) % fieldIdx.length]!;
        [edited[pick], edited[other]] = [edited[other]!, edited[pick]!];
      }
      const text = edited.join(NL);
      const plan = prepareSourceApply({ text, baseline, current: current(pages, variables) });
      if (!plan.ok) continue;
      checked++;
      const applied = generateMultiPageZPL(plan.next.label, plan.next.pages.map((p) => ({ ...p, overlay: undefined })), plan.next.variables);
      const reparsed = importZplText(text, label.dpmm);
      const regenerated = generateMultiPageZPL(label, reparsed.pages.map((p) => ({ ...p, overlay: undefined })), reparsed.variables);
      expect(printed(applied), `iteration ${i}, op ${op}`).toEqual(printed(regenerated));
    }
    expect(checked).toBeGreaterThan(100);
  });
});
