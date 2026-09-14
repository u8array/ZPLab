import { describe, it, expect } from "vitest";
import { importZplText } from "@zplab/core/lib/zplImportService";
import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";
import type { LabelObject, Page } from "@zplab/core/types/Group";

const LABEL: LabelConfig = { widthMm: 100, heightMm: 60, dpmm: 8 };

/** Import one block and return its single page (with overlay attached). */
function importedPage(zpl: string): Page {
  const r = importZplText(zpl, LABEL.dpmm);
  expect(r.pages).toHaveLength(1);
  return r.pages[0]!;
}

/** Mark a leaf edited the way applyObjectChanges would (emit-affecting change). */
function edit(page: Page, predicate: (o: LabelObject) => boolean, patch: Partial<LabelObject>): LabelObject {
  const leaf = page.objects.find(predicate)!;
  Object.assign(leaf, patch, { dirty: true });
  return leaf;
}

describe("overlay replay of one page", () => {
  it("replays an untouched block byte-identically", () => {
    const src = "^XA\n^PW800\n^LL400\n^FXnote\n^FO50,50^A0N,30,30^FDHello^FS\n^FO50,120^GB200,80,3^FS\n^XZ";
    const page = importedPage(src);
    expect(generateMultiPageZPL(LABEL, [page])).toBe(src);
  });

  it("regenerates only the edited field, neighbours stay verbatim", () => {
    const src = "^XA\n^FO50,50^A0N,30,30^FDHello^FS\n^FO50,120^GB200,80,3^FS\n^XZ";
    const page = importedPage(src);
    edit(page, (o) => o.type === "text", { x: 99 });
    const out = generateMultiPageZPL(LABEL, [page]);
    expect(out).not.toContain("^FO50,50^A0N,30,30^FDHello^FS");
    expect(out).toContain("^FO99,");
    expect(out).toContain("^FO50,120^GB200,80,3^FS"); // box untouched
  });

  it("drops a deleted object's segment, leaving neighbours intact", () => {
    const src = "^XA\n^FO50,50^A0N,30,30^FDHello^FS\n^FO50,120^GB200,80,3^FS\n^XZ";
    const page = importedPage(src);
    page.objects = page.objects.filter((o) => o.type !== "text");
    const out = generateMultiPageZPL(LABEL, [page]);
    expect(out).not.toContain("^FDHello");
    expect(out).toContain("^FO50,120^GB200,80,3^FS");
    expect(out.endsWith("^XZ")).toBe(true);
  });

  it("appends a new object before ^XZ, leaving existing segments verbatim", () => {
    const src = "^XA\n^FO50,50^A0N,30,30^FDHello^FS\n^XZ";
    const page = importedPage(src);
    const added: LabelObject = {
      id: "new-1",
      type: "text",
      x: 10,
      y: 200,
      rotation: 0,
      props: { content: "NEW", fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as unknown as LabelObject;
    page.objects = [...page.objects, added];
    const out = generateMultiPageZPL(LABEL, [page]);
    expect(out).toContain("^FO50,50^A0N,30,30^FDHello^FS"); // original verbatim
    expect(out).toContain("^FDNEW");
    expect(out.indexOf("^FDNEW")).toBeLessThan(out.lastIndexOf("^XZ"));
  });

  it("appends a new object before a lowercase ^xz terminator", () => {
    const src = "^XA\n^FO50,50^A0N,30,30^FDHi^FS\n^xz";
    const page = importedPage(src);
    const added: LabelObject = {
      id: "new-2",
      type: "text",
      x: 10,
      y: 200,
      rotation: 0,
      props: { content: "NEW", fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as unknown as LabelObject;
    page.objects = [...page.objects, added];
    const out = generateMultiPageZPL(LABEL, [page]);
    // The new field must land inside the block, before the lowercase terminator.
    expect(out.indexOf("^FDNEW")).toBeLessThan(out.toUpperCase().lastIndexOf("^XZ"));
  });

  it("keeps a lowercase ^xz terminator intact when content has case-growing Unicode", () => {
    // 'ß'.toUpperCase() is 'SS' (1->2 chars): a toUpperCase-based terminator
    // search would shift the slice index and corrupt the ^xz on append.
    const src = "^XA\n^FO50,50^A0N,30,30^FDStraße^FS\n^xz";
    const page = importedPage(src);
    const added: LabelObject = {
      id: "new-u",
      type: "text",
      x: 10,
      y: 200,
      rotation: 0,
      props: { content: "NEW", fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as unknown as LabelObject;
    page.objects = [...page.objects, added];
    const out = generateMultiPageZPL(LABEL, [page]);
    expect(out).toContain("^FDStraße^FS"); // original verbatim, not mangled
    expect(out.trimEnd().endsWith("^xz")).toBe(true); // terminator intact
    expect(out.indexOf("^FDNEW")).toBeLessThan(out.lastIndexOf("^xz"));
  });

  it("emits a dirty field home-relative under ^LH (no double-shift)", () => {
    const src = "^XA^LH50,20^FO10,10^A0N,30,30^FDx^FS^XZ";
    const page = importedPage(src);
    expect(page.overlay?.frame).toEqual({ homeX: 50, homeY: 20, top: 0 });
    // Model coords are absolute (home folded); editing y forces regen.
    const text = page.objects.find((o) => o.type === "text")!;
    Object.assign(text, { y: text.y + 5, dirty: true });
    const out = generateMultiPageZPL(LABEL, [page]);
    // The regenerated ^FO stays home-relative (x back near 10, not 60).
    expect(out).toContain("^LH50,20"); // raw ^LH preserved
    expect(out).toMatch(/\^FO10,/);
  });

  it("skips a hidden object segment (includeInExport=false)", () => {
    const src = "^XA\n^FO50,50^A0N,30,30^FDHello^FS\n^FO50,120^GB200,80,3^FS\n^XZ";
    const page = importedPage(src);
    edit(page, (o) => o.type === "text", { includeInExport: false });
    // includeInExport is not emit-affecting, so undo the dirty the helper set.
    page.objects.find((o) => o.type === "text")!.dirty = undefined;
    const out = generateMultiPageZPL(LABEL, [page]);
    expect(out).not.toContain("^FDHello");
    expect(out).toContain("^FO50,120^GB200,80,3^FS");
  });

  it("regenerates a direct-path ^A@ font without aliasing (no ^CW forward-ref)", () => {
    // ^CW declared AFTER the field: aliasing the regen to ^AQ would reference
    // the alias before its ^CW defines it. The overlay keeps the direct path.
    const src = "^XA\n^FO20,20^A@N,30,30,E:MYFONT.TTF^FDhi^FS\n^CWQ,E:MYFONT.TTF\n^XZ";
    const r = importZplText(src, LABEL.dpmm);
    const page = r.pages[0]!;
    const label = { ...LABEL, ...r.labelConfig }; // carries the ^CWQ alias
    const text = page.objects.find((o) => o.type === "text")!;
    Object.assign(text, { x: 40, dirty: true });
    const out = generateMultiPageZPL(label, [page]);
    expect(out).toContain("^A@N,30,30,E:MYFONT.TTF"); // direct path kept
    expect(out).not.toContain("^AQ"); // not aliased (would be a forward reference)
  });

  it("falls back to full regeneration when the overlay is a stale version", () => {
    const page = importedPage("^XA^FO10,10^A0N,30,30^FDx^FS^XZ");
    page.overlay!.v = 1; // older schema version, no longer trusted
    const out = generateMultiPageZPL(LABEL, [page]);
    expect(out).toContain("^XA");
    expect(out).toContain("^FDx");
  });

  it("falls back when an edit lands in a non-regenSafe (^MU) block", () => {
    const page = importedPage("^XA^MUi^FO10,10^A0N,30,30^FDx^FS^MUd^XZ");
    expect(page.overlay?.regenSafe).toBe(false);
    edit(page, (o) => o.type === "text", { x: 99 });
    const out = generateMultiPageZPL(LABEL, [page]);
    // Full regeneration path: model-canonical block, not the raw ^MU replay.
    expect(out).not.toContain("^MUi");
  });

  it("falls back when a new object is interleaved among imported ones", () => {
    const src = "^XA\n^FO10,10^A0N,30,30^FDaa^FS\n^FO10,60^A0N,30,30^FDbb^FS\n^XZ";
    const page = importedPage(src);
    const added: LabelObject = {
      id: "mid",
      type: "text",
      x: 10,
      y: 35,
      rotation: 0,
      props: { content: "MID", fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as unknown as LabelObject;
    // Model order: aa, MID(new), bb. The new object sits BETWEEN imported ones,
    // so appending at ^XZ would misplace it -> must fall back to model order.
    page.objects = [page.objects[0]!, added, page.objects[1]!];
    const out = generateMultiPageZPL(LABEL, [page]);
    expect(out.indexOf("FDaa")).toBeLessThan(out.indexOf("MID"));
    expect(out.indexOf("MID")).toBeLessThan(out.indexOf("FDbb"));
  });

  it("falls back to model order when objects are reordered", () => {
    const src = "^XA\n^FO10,10^A0N,30,30^FDfirst^FS\n^FO10,60^A0N,30,30^FDsecond^FS\n^XZ";
    const page = importedPage(src);
    // Reverse z-order; the overlay pins source order, so this must fall back.
    page.objects = [...page.objects].reverse();
    const out = generateMultiPageZPL(LABEL, [page]);
    expect(out.indexOf("second")).toBeLessThan(out.indexOf("first"));
  });

  it("works through generateMultiPageZPL across multiple pages", () => {
    const p1 = "^XA\n^FO10,10^A0N,30,30^FDone^FS\n^XZ";
    const p2 = "^XA\n^FO10,10^A0N,30,30^FDtwo^FS\n^XZ";
    const r = importZplText(`${p1}\n${p2}`, LABEL.dpmm);
    // Edit page 2 only.
    Object.assign(r.pages[1]!.objects.find((o) => o.type === "text")!, { x: 77, dirty: true });
    const out = generateMultiPageZPL(LABEL, r.pages, r.variables);
    expect(out).toContain("^FO10,10^A0N,30,30^FDone^FS"); // page 1 verbatim
    expect(out).toContain("^FO77,"); // page 2 patched
    expect(out).not.toContain("^FO10,10^A0N,30,30^FDtwo^FS");
  });
});
