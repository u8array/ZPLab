import { describe, it, expect } from "vitest";
import { allRepeatCopies, canDecoupleRepeats, decoupledRepeats, repeatCopies, repeatCopyId, repeatCopySource, groupRepeats, repeatSwitch, repeatToggle, toggledRepeat, withRepeatCopies } from "./repeatCopies";
import { repeatCopyPlacementFindings } from "./preflight";
import { objectBoundsDots } from "./objectBounds";
import { markerOf } from "../types/Variable";
import { generateBatchZpl, generateMultiPageZPL, generateMultiPageZplWithMap, generateZPL } from "./zplGenerator";
import { importZplText } from "./zplImportService";
import { parseDesignFile, serializeDesign } from "./designFile";
import { designAsPageLabel, type LabelConfig } from "../types/LabelConfig";
import { getAllLeaves, type GroupObject, type LabelObject, type Page, ungrouped } from "../types/Group";

// Three labels of 240 dots, 16 dots apart.
const liner: LabelConfig = { widthMm: 94, heightMm: 30, dpmm: 8, labelsAcross: { count: 3, gapMm: 2 } };
const single: LabelConfig = { widthMm: 94, heightMm: 30, dpmm: 8 };

const SRC = "^XA\n^FO20,30^A0N,30,30^FDHello^FS\n^FO20,80^GB50,50,2^FS\n^XZ";

function imported(src = SRC): Page {
  const page = importZplText(src, 8).pages[0];
  if (!page) throw new Error("no page");
  return page;
}

const group = (children: LabelObject[], over: Partial<GroupObject> = {}): GroupObject => ({
  id: "g", type: "group", x: 0, y: 0, rotation: 0, children, repeat: true, ...over,
});

const fields = (zpl: string) => zpl.match(/\^FO\d+,\d+/g) ?? [];

const shiftedBy = (objects: LabelObject[], dx: number): LabelObject[] =>
  objects.map((o) => ({ ...o, x: o.x + dx }));

describe("repeatCopyId", () => {
  it("leads back to its source and leaves a design id alone", () => {
    expect(repeatCopySource(repeatCopyId("a-1", 2))).toBe("a-1");
    expect(repeatCopySource("a-1")).toBeNull();
  });

  it("takes an id for a copy only when a label number ends it", () => {
    expect(repeatCopySource("price~labelled")).toBeNull();
    expect(repeatCopySource("price~label2-old")).toBeNull();
  });
});

describe("repeatCopies", () => {
  it("places one copy on every other label, each leaf moved by the label step", () => {
    const { objects } = imported();
    const copies = repeatCopies(group(objects), { label: designAsPageLabel(liner), variables: [] });
    expect(copies.map((c) => c.id)).toEqual([repeatCopyId("g", 1), repeatCopyId("g", 2)]);
    expect(getAllLeaves(copies).map((l) => l.x)).toEqual([20 + 256, 20 + 256, 20 + 512, 20 + 512]);
  });

  it("counts from the label the group lies on", () => {
    const { objects } = imported();
    const copies = repeatCopies(group(shiftedBy(objects, 256)), { label: designAsPageLabel(liner), variables: [] });
    expect(copies.map((c) => c.id)).toEqual([repeatCopyId("g", 0), repeatCopyId("g", 2)]);
    expect(getAllLeaves(copies).map((l) => l.x)).toEqual([20, 20, 20 + 512, 20 + 512]);
  });

  it("picks the label by a barcode's measured width, not by its estimate", () => {
    // A QR is estimated far wider than it prints. Its estimated centre lies in the gap.
    const { objects } = imported("^XA^FO150,30^BQN,2,4^FDQA,hello^FS^XZ");
    const copies = repeatCopies(group(objects), { label: designAsPageLabel(liner), variables: [] });
    expect(getAllLeaves(copies).map((l) => l.x)).toEqual([150 + 256, 150 + 512]);
  });

  it("counts a group that starts on a label's left edge to that label, on a row without gaps", () => {
    const gapless = designAsPageLabel({ ...liner, widthMm: 90, labelsAcross: { count: 3, gapMm: 0 } });
    const { objects } = imported("^XA^FO240,30^GB50,50,2^FS^XZ");
    expect(getAllLeaves(repeatCopies(group(objects), { label: gapless, variables: [] })).map((l) => l.x)).toEqual([0, 480]);
  });

  it("copies a leaf that repeats without a group", () => {
    const [text] = imported().objects;
    if (!text) throw new Error("fixture");
    const copies = repeatCopies({ ...text, repeat: true }, { label: designAsPageLabel(liner), variables: [] });
    expect(copies.map((c) => [c.id, c.x])).toEqual([[repeatCopyId(text.id, 1), 20 + 256], [repeatCopyId(text.id, 2), 20 + 512]]);
    expect(copies.some((c) => "repeat" in c)).toBe(false);
  });

  it("counts a right-justified field to the label left of its origin, which is its right edge", () => {
    const gapless = designAsPageLabel({ ...liner, widthMm: 90, labelsAcross: { count: 3, gapMm: 0 } });
    const [text] = imported().objects;
    if (!text) throw new Error("fixture");
    const flushRight: LabelObject = { ...text, x: 240, fieldJustify: "R", repeat: true };
    expect(repeatCopies(flushRight, { label: gapless, variables: [] }).map((c) => c.x)).toEqual([480, 720]);
  });

  it("counts a right-justified box by its origin, which stays its left edge", () => {
    const gapless = designAsPageLabel({ ...liner, widthMm: 90, labelsAcross: { count: 3, gapMm: 0 } });
    const [, box] = imported().objects;
    if (!box) throw new Error("fixture");
    const onSecond: LabelObject = { ...box, x: 240, fieldJustify: "R", repeat: true };
    expect(repeatCopies(onSecond, { label: gapless, variables: [] }).map((c) => c.x)).toEqual([0, 480]);
  });

  it("counts a rotated right-justified text to the label it prints on", () => {
    const [text] = imported("^XA^FO230,30,1^A0R,30,30^FDHello^FS^XZ").objects;
    if (!text) throw new Error("fixture");
    expect(text.x).toBeGreaterThan(256);
    expect(fields(generateZPL(liner, [{ ...text, repeat: true }]))).toEqual(["^FO230,30", "^FO486,30", "^FO742,30"]);
  });

  it("counts a rotated text to the label it prints on", () => {
    const gapless = designAsPageLabel({ ...liner, widthMm: 90, labelsAcross: { count: 3, gapMm: 0 } });
    for (const rotation of ["R", "I"]) {
      const [text] = imported(`^XA^FO180,30^A0${rotation},30,30^FDHi^FS^XZ`).objects;
      if (!text) throw new Error("fixture");
      expect(text.x, rotation).toBeGreaterThan(180);
      // Its right edge ends on the first label.
      const flush: LabelObject = { ...text, x: 240, repeat: true };
      expect(repeatCopies(flush, { label: gapless, variables: [] }).map((c) => c.x), rotation).toEqual([480, 720]);
    }
  });

  it("counts a right-justified ^FT text rotated I or B by where it prints", () => {
    const gapless = { ...liner, widthMm: 90, labelsAcross: { count: 3, gapMm: 0 } };
    const origins = (src: string) => {
      const [field] = imported(src).objects;
      if (!field) throw new Error("fixture");
      return (generateZPL(gapless, [{ ...field, repeat: true }]).match(/\^FT-?\d+/g) ?? []).sort();
    };
    expect(origins("^XA^FT300,100,1^A0I,30,30^FDHello^FS^XZ")).toEqual(["^FT300", "^FT540", "^FT780"]);
    expect(origins("^XA^FT255,200,1^A0B,30,30^FDHello^FS^XZ")).toEqual(["^FT255", "^FT495", "^FT735"]);
  });

  it("counts a bound field by the value it prints", () => {
    const [literal] = getAllLeaves(imported("^XA^FO300,30,1^A0I,30,30^FDX^FS^XZ").objects);
    if (!literal) throw new Error("fixture");
    const variables = [{ id: "v", name: "aVeryLongVariableName", fnNumber: 1, defaultValue: "X" }];
    const bound = { ...literal, props: { ...literal.props, content: markerOf("aVeryLongVariableName") }, repeat: true } as LabelObject;
    const origins = (zpl: string) => (zpl.match(/\^FO-?\d+/g) ?? []).sort();
    expect(origins(generateZPL(liner, [bound], variables))).toEqual(origins(generateZPL(liner, [{ ...literal, repeat: true }])));
  });

  it("counts a rotated right-justified ^FT barcode by its measured width", () => {
    const gapless = { ...liner, widthMm: 90, labelsAcross: { count: 3, gapMm: 0 } };
    const [symbol] = imported("^XA^FT380,200,1^BXI,5,200^FDhello^FS^XZ").objects;
    if (!symbol) throw new Error("fixture");
    // Estimated, the barcode would lie on the first label.
    expect(objectBoundsDots(symbol, { label: designAsPageLabel(gapless), variables: [] })).toMatchObject({ x: 80, width: 150 });
    expect((generateZPL(gapless, [{ ...symbol, repeat: true }]).match(/\^FT-?\d+/g) ?? []).sort()).toEqual(["^FT140", "^FT380", "^FT620"]);
  });

  it("counts a line that points left by its left end", () => {
    const gapless = designAsPageLabel({ ...liner, widthMm: 90, labelsAcross: { count: 3, gapMm: 0 } });
    const line: LabelObject = { id: "l", type: "line", x: 240, y: 30, rotation: 0, props: { angle: 180, length: 100, thickness: 3, color: "B" }, repeat: true };
    expect(repeatCopies(line, { label: gapless, variables: [] }).map((c) => c.x)).toEqual([480, 720]);
  });

  it("leaves a leaf that stays out of the export out of the choice of label", () => {
    const [note, box] = imported().objects;
    if (!note || !box) throw new Error("fixture");
    const onSecond = group([{ ...note, includeInExport: false }, { ...box, x: box.x + 256 }]);
    expect(fields(generateZPL(liner, [onSecond]))).toEqual(["^FO276,80", "^FO20,80", "^FO532,80"]);
  });

  it("counts a group that prints nothing by all its leaves", () => {
    const hidden = group(imported().objects, { includeInExport: false });
    expect(repeatCopies(hidden, { label: designAsPageLabel(liner), variables: [] })).toHaveLength(2);
  });

  it("has no copies of an empty group", () => {
    expect(repeatCopies(group([]), { label: designAsPageLabel(liner), variables: [] })).toEqual([]);
  });

  it("gives every leaf of a nested group an id of its own", () => {
    const { objects } = imported();
    const copies = repeatCopies(group([group(objects, { id: "inner" })]), { label: designAsPageLabel(liner), variables: [] });
    const ids = getAllLeaves(copies).map((l) => l.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => repeatCopySource(id) !== null)).toBe(true);
  });

  it("is empty on a liner with one label", () => {
    expect(repeatCopies(group(imported().objects), { label: designAsPageLabel(single), variables: [] })).toEqual([]);
  });
});

describe("withRepeatCopies", () => {
  it("returns the objects themselves when nothing repeats", () => {
    const { objects } = imported();
    expect(withRepeatCopies(objects, { label: designAsPageLabel(liner), variables: [] })).toBe(objects);
    const grouped = [group(objects)];
    expect(withRepeatCopies(grouped, { label: designAsPageLabel(single), variables: [] })).toBe(grouped);
  });

  it("adds nothing on a second pass", () => {
    const once = withRepeatCopies([group(imported().objects)], { label: designAsPageLabel(liner), variables: [] });
    expect(withRepeatCopies(once, { label: designAsPageLabel(liner), variables: [] })).toBe(once);
  });

  it("leaves a repeating group below the top level alone", () => {
    const nested = [group([group(imported().objects, { id: "inner" })], { repeat: undefined })];
    expect(withRepeatCopies(nested, { label: designAsPageLabel(liner), variables: [] })).toBe(nested);
  });
});

describe("repeatToggle", () => {
  const plain = () => [group(imported().objects, { repeat: undefined })];

  it("turns a selected top-level group on where the liner has a row", () => {
    expect(repeatToggle(plain(), ["g"], designAsPageLabel(liner))).toEqual({ ids: ["g"], turnOn: true });
    expect(repeatToggle(plain(), ["g"], designAsPageLabel(single))).toBeNull();
  });

  it("turns a repeating group off, with or without a row", () => {
    const on = [group(imported().objects)];
    expect(repeatToggle(on, ["g"], designAsPageLabel(liner))).toEqual({ ids: ["g"], turnOn: false });
    expect(repeatToggle(on, ["g"], designAsPageLabel(single))).toEqual({ ids: ["g"], turnOn: false });
  });

  it("turns on every selected top-level object, a leaf as well as a group", () => {
    const { objects } = imported();
    const [text, box] = objects;
    if (!text || !box) throw new Error("fixture");
    const row = designAsPageLabel(liner);
    expect(repeatToggle(objects, [text.id], row)).toEqual({ ids: [text.id], turnOn: true });
    expect(repeatToggle([{ ...text, repeat: true }, box], [text.id, box.id], row)).toEqual({ ids: [text.id, box.id], turnOn: true });
  });

  it("turns off what repeats in a mixed selection once the liner has one label", () => {
    const [text, box] = imported().objects;
    if (!text || !box) throw new Error("fixture");
    expect(repeatToggle([{ ...text, repeat: true }, box], [text.id, box.id], designAsPageLabel(single))).toEqual({ ids: [text.id], turnOn: false });
  });

  it("has nothing to do for a locked object or one below the top level", () => {
    const { objects } = imported();
    const row = designAsPageLabel(liner);
    expect(repeatToggle([group(objects, { locked: true })], ["g"], row)).toBeNull();
    expect(repeatToggle([group(objects, { repeat: undefined })], [objects[0]!.id], row)).toBeNull();
    expect(repeatToggle([group([group(objects, { id: "inner" })])], ["inner"], row)).toBeNull();
  });
});

describe("repeatSwitch", () => {
  const row = designAsPageLabel(liner);

  it("shows a top-level object's state and whether a toggle acts", () => {
    const { objects } = imported();
    expect(repeatSwitch(objects, objects[0]!.id, row)).toEqual({ active: false, canToggle: true });
    expect(repeatSwitch([group(objects, { locked: true })], "g", row)).toEqual({ active: true, canToggle: false });
    expect(repeatSwitch([group(objects)], "g", designAsPageLabel(single))).toEqual({ active: true, canToggle: true });
  });

  it("shows none for a nested object or a plain one without a row", () => {
    const { objects } = imported();
    expect(repeatSwitch([group(objects)], objects[0]!.id, row)).toBeNull();
    expect(repeatSwitch(objects, objects[0]!.id, designAsPageLabel(single))).toBeNull();
  });
});

describe("toggledRepeat", () => {
  const row = designAsPageLabel(liner);

  it("sets the mark, drops it again and keeps the objects where it has nothing to do", () => {
    const off = [group(imported().objects, { repeat: undefined })];
    const on = toggledRepeat(off, ["g"], row);
    expect(on[0]?.repeat).toBe(true);
    expect("repeat" in toggledRepeat(on, ["g"], row)[0]!).toBe(false);
    expect(toggledRepeat(off, ["g"], designAsPageLabel(single))).toBe(off);
  });

  it("leaves a locked group alone", () => {
    const locked = [group(imported().objects, { repeat: undefined, locked: true })];
    expect(toggledRepeat(locked, ["g"], row)).toBe(locked);
  });
});

describe("groupRepeats", () => {
  const row = designAsPageLabel(liner);
  const [text, box] = imported().objects.map((o) => ({ ...o, repeat: true }));
  if (!text || !box) throw new Error("fixture");

  it("holds where every member repeats from the same label", () => {
    expect(groupRepeats([text, box], { label: row, variables: [] })).toBe(true);
    expect(fields(generateZPL(liner, [group([text, box])])).sort()).toEqual(fields(generateZPL(liner, [text, box])).sort());
  });

  it("fails where a member does not repeat or lies on another label", () => {
    expect(groupRepeats([text, { ...box, repeat: undefined }], { label: row, variables: [] })).toBe(false);
    expect(groupRepeats([text, { ...box, x: box.x + 256 }], { label: row, variables: [] })).toBe(false);
    expect(groupRepeats([], { label: row, variables: [] })).toBe(false);
  });
});

describe("ungrouped", () => {
  it("hands the mark of a repeating group to its children", () => {
    const { objects } = imported();
    const on = group(objects);
    expect(ungrouped(on).every((c) => c.repeat === true)).toBe(true);
    expect(fields(generateZPL(liner, ungrouped(on))).sort()).toEqual(fields(generateZPL(liner, [on])).sort());
    const off = group(objects, { repeat: undefined });
    expect(ungrouped(off)).toBe(off.children);
  });
});

describe("decoupledRepeats", () => {
  const fresh = (copy: LabelObject): LabelObject => ({ ...copy, id: `new:${copy.id}` });

  it("turns the copies into groups of the design and prints the same", () => {
    const { objects } = imported();
    const [text, box] = objects;
    if (!text || !box) throw new Error("fixture");
    const before = [group([text]), box];
    const after = decoupledRepeats(before, ["g"], { label: designAsPageLabel(liner), variables: [] }, fresh);
    expect(after.map((o) => o.id)).toEqual(["g", box.id, `new:${repeatCopyId("g", 1)}`, `new:${repeatCopyId("g", 2)}`]);
    expect(after.some((o) => o.repeat)).toBe(false);
    expect(generateZPL(liner, after)).toBe(generateZPL(liner, before));
  });

  it("turns the copies of a leaf into leaves", () => {
    const [text, box] = imported().objects;
    if (!text || !box) throw new Error("fixture");
    const before = [{ ...text, repeat: true }, box];
    const after = decoupledRepeats(before, [text.id], { label: designAsPageLabel(liner), variables: [] }, fresh);
    expect(after.map((o) => o.type)).toEqual(["text", "box", "text", "text"]);
    expect(after.some((o) => o.repeat)).toBe(false);
    expect(generateZPL(liner, after)).toBe(generateZPL(liner, before));
  });

  it("leaves the objects alone when no selected object repeats", () => {
    const off = [group(imported().objects, { repeat: undefined })];
    expect(canDecoupleRepeats(off, ["g"], designAsPageLabel(liner))).toBe(false);
    expect(decoupledRepeats(off, ["g"], { label: designAsPageLabel(liner), variables: [] }, fresh)).toBe(off);
    expect(canDecoupleRepeats([group(imported().objects)], ["g"], designAsPageLabel(liner))).toBe(true);
  });

  it("has no copies to decouple on a liner with one label", () => {
    const on = [group(imported().objects)];
    expect(canDecoupleRepeats(on, ["g"], designAsPageLabel(single))).toBe(false);
    expect(decoupledRepeats(on, ["g"], { label: designAsPageLabel(single), variables: [] }, fresh)).toBe(on);
  });
});

describe("a repeating object in the export", () => {
  it("prints its fields once per label and appends the copies after every other object", () => {
    const { objects } = imported();
    const [text, box] = objects;
    if (!text || !box) throw new Error("fixture");
    const out = generateZPL(liner, [group([text]), box]);
    expect(fields(out)).toEqual(["^FO20,30", "^FO20,80", "^FO276,30", "^FO532,30"]);
  });

  it("prints once on a liner with one label", () => {
    expect(fields(generateZPL(single, [group(imported().objects)]))).toEqual(["^FO20,30", "^FO20,80"]);
  });

  it("prints a locked group once per label on every export path", () => {
    const locked = [group(imported().objects, { locked: true })];
    expect(fields(generateZPL(liner, locked))).toHaveLength(6);
    expect(fields(generateMultiPageZPL(liner, [{ objects: locked }]))).toHaveLength(6);
    expect(fields(generateBatchZpl(designAsPageLabel(liner), locked, [], { headers: [], rows: [[]] }, { bindings: {} }))).toHaveLength(6);
  });

  it("skips the copies of a group that stays out of the export", () => {
    const out = generateZPL(liner, [group(imported().objects, { includeInExport: false })]);
    expect(fields(out)).toEqual([]);
  });

  it("maps every copy to a span of its own", () => {
    const { objects } = imported();
    const { text, spans } = generateMultiPageZplWithMap(liner, [{ objects: [group(objects)] }]);
    expect(new Set(spans.map((s) => s.objectId)).size).toBe(6);
    const copy = spans.find((s) => s.objectId === repeatCopyId(objects[0]!.id, 2));
    expect(text.slice(copy!.start, copy!.end)).toContain("^FO532,30");
  });

  it("keeps an imported page's bytes and appends the copies", () => {
    const page = imported();
    const out = generateMultiPageZPL(liner, [{ ...page, objects: [group(page.objects)] }]);
    expect(out.startsWith(SRC.slice(0, SRC.lastIndexOf("^XZ")))).toBe(true);
    expect(fields(out)).toEqual(["^FO20,30", "^FO20,80", "^FO276,30", "^FO276,80", "^FO532,30", "^FO532,80"]);
  });

  it("keeps the bytes of an imported leaf that repeats on its own", () => {
    const page = imported();
    const [text, box] = page.objects;
    if (!text || !box) throw new Error("fixture");
    const out = generateMultiPageZPL(liner, [{ ...page, objects: [{ ...text, repeat: true }, box] }]);
    expect(out.startsWith(SRC.slice(0, SRC.lastIndexOf("^XZ")))).toBe(true);
    expect(fields(out)).toEqual(["^FO20,30", "^FO20,80", "^FO276,30", "^FO532,30"]);
  });

  it("counts each repeating object from the label it lies on", () => {
    const [text, box] = imported().objects;
    if (!text || !box) throw new Error("fixture");
    const out = generateZPL(liner, [{ ...text, repeat: true }, { ...box, x: box.x + 512, repeat: true }]);
    expect(fields(out)).toEqual(["^FO20,30", "^FO532,80", "^FO276,30", "^FO532,30", "^FO20,80", "^FO276,80"]);
  });

  it("replays an imported page verbatim while the liner has one label", () => {
    const page = imported();
    expect(generateMultiPageZPL(single, [{ ...page, objects: [group(page.objects)] }])).toBe(SRC);
  });

  it("stores the copies in a batch template", () => {
    const out = generateBatchZpl(designAsPageLabel(liner), [group(imported().objects)], [], { headers: [], rows: [[]] }, { bindings: {} });
    expect(fields(out)).toHaveLength(6);
  });
});

describe("repeatCopyPlacementFindings", () => {
  const row = designAsPageLabel(liner);
  const copyLeaves = (objects: LabelObject[]) => getAllLeaves(allRepeatCopies(objects, { label: row, variables: [] }));

  it("flags a copy that prints off its label", () => {
    expect(repeatCopyPlacementFindings(copyLeaves([group(imported().objects)]), { label: row, variables: [] }, "mm")).toEqual([]);
    // 300 dots wide on labels of 240 dots.
    const wide = [group(imported("^XA^FO10,30^GB300,50,2^FS^XZ").objects)];
    const found = repeatCopyPlacementFindings(copyLeaves(wide), { label: row, variables: [] }, "mm");
    expect(found.map((f) => f.kind)).toEqual(["offLabelClipped", "offLabelClipped"]);
    expect(found.every((f) => repeatCopySource(f.objectId) !== null)).toBe(true);
  });

  it("measures a copy by the footprint of its source", () => {
    const { objects } = imported("^XA^FO150,30^BQN,2,4^FDQA,hello^FS^XZ");
    const leaves = copyLeaves([group(objects)]);
    // Estimated, the QR reaches over its label.
    expect(repeatCopyPlacementFindings(leaves, { label: row, variables: [] }, "mm")).not.toEqual([]);
    const measured = new Map([[objects[0]!.id, { width: 60, height: 60 }]]);
    expect(repeatCopyPlacementFindings(leaves, { label: row, measured, variables: [] }, "mm")).toEqual([]);
  });
});

describe("the repeat mark in a design file", () => {
  it("survives a save and a load", () => {
    const loaded = parseDesignFile(serializeDesign(liner, [{ objects: [group(imported().objects)] }]));
    if (!loaded.ok) throw new Error("load failed");
    expect(loaded.value.pages[0]?.objects[0]?.repeat).toBe(true);
  });

  it("loads a leaf inside a group without the mark", () => {
    const [text] = imported().objects;
    if (!text) throw new Error("fixture");
    const loaded = parseDesignFile(serializeDesign(liner, [{ objects: [group([{ ...text, repeat: true }], { repeat: undefined }), { ...text, id: "top", repeat: true }] }]));
    if (!loaded.ok) throw new Error("load failed");
    const [outer, top] = loaded.value.pages[0]?.objects ?? [];
    expect("repeat" in ((outer as GroupObject).children[0] ?? {})).toBe(false);
    expect(top?.repeat).toBe(true);
  });

  it("loads a group inside a group without the mark", () => {
    const nested = group([group(imported().objects, { id: "inner" })], { repeat: undefined });
    const loaded = parseDesignFile(serializeDesign(liner, [{ objects: [nested] }]));
    if (!loaded.ok) throw new Error("load failed");
    const outer = loaded.value.pages[0]?.objects[0] as GroupObject;
    expect(outer.children[0]).toMatchObject({ id: "inner" });
    expect("repeat" in (outer.children[0] as GroupObject)).toBe(false);
  });
});
