// Also carries an input-validation corpus (graphic payloads, byte-count
// boundaries): malformed values this tool must reject, so caller data is not
// read as printer commands. Stated here rather than referenced, so a reader
// who opens only this file sees why the values look the way they do.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildCurrentDesignResult, createDraft, patchDesign, patchDesignShape, rasterImageResult, createDraftShape, validateDraft, exportZpl, getSchema, importZpl, validateZpl } from "./tools";
import { ObjectRegistry } from "@zplab/core/registry";
import { textObject } from "./testFixtures";
import { serializeDesign } from "@zplab/core/lib/designFile";

/** Assert a tool succeeded and narrow away the ToolError branch. */
function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
}

describe("mcp-server tools", () => {
  it("round-trips create → validate → export for a text + code128 label", () => {
    const created = createDraft({
      widthMm: 100,
      heightMm: 50,
      dpmm: 8,
      objects: [
        { type: "text", x: 20, y: 20, props: { content: "Hello", fontHeight: 30 } },
        { type: "code128", x: 20, y: 80, props: { content: "12345", height: 80 } },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const validated = validateDraft(created.designFile);
    expect(validated.ok).toBe(true);

    const exported = exportZpl(created.designFile);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.zpl).toContain("^FDHello");
    expect(exported.zpl).toContain("^BC");
  });

  it("returns errors (not a throw) for an unknown object type", () => {
    const created = createDraft({
      widthMm: 50,
      heightMm: 30,
      dpmm: 8,
      objects: [{ type: "not-a-real-type", x: 0, y: 0 }],
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.errors.length).toBeGreaterThan(0);
  });

  it("validate_draft rejects a malformed design file", () => {
    const result = validateDraft({ schemaVersion: 3, label: { widthMm: 10 } });
    expect(result.ok).toBe(false);
  });

  // The envelope tools must reject out-of-range label config, not just
  // create_draft's input schema, or validate_draft/export_zpl emit broken ZPL.
  it("envelope tools reject an out-of-range label config", () => {
    for (const label of [
      { widthMm: 100, heightMm: 50, dpmm: 0 },
      { widthMm: 100, heightMm: 50, dpmm: 7 },
      { widthMm: -5, heightMm: 50, dpmm: 8 },
      { widthMm: 100, heightMm: 0, dpmm: 8 },
    ]) {
      const bad = { schemaVersion: 3, label, pages: [{ objects: [] }] };
      expect(validateDraft(bad).ok).toBe(false);
      expect(exportZpl(bad).ok).toBe(false);
    }
  });

  it("get_schema lists the common types with prop summaries", () => {
    const schema = getSchema();
    const text = schema.types.find((t) => t.type === "text");
    expect(text?.props).toBeDefined();
    expect(schema.types.some((t) => t.type === "code128")).toBe(true);
  });

  it("every prop summary key is a real prop of its type (drift guard)", () => {
    for (const t of getSchema().types) {
      if (!t.props) continue;
      const allowed = new Set([...Object.keys(t.defaultProps), "content", "rotation"]);
      // `gs1` is an optional mode flag on gs1Capable types, not a defaultProp.
      if ((ObjectRegistry as Record<string, { gs1Capable?: boolean }>)[t.type]?.gs1Capable) {
        allowed.add("gs1");
      }
      // Optional props documented on purpose: ^FR reverse, and the image
      // fields raster_image fills that carry no registry default.
      if (t.type === "text") for (const k of ["reverse", "blockWidth", "blockLines", "blockLineSpacing", "blockJustify"]) allowed.add(k);
      if (t.type === "image") for (const k of ["heightDots", "_gfaCache"]) allowed.add(k);
      if (t.type === "qrcode") allowed.add("byHeight");
      for (const key of Object.keys(t.props)) {
        expect(allowed.has(key), `${t.type}.${key} is not a known prop`).toBe(true);
      }
    }
  });

  it("drops a mismatched ^RB pair from a hand-edited envelope", () => {
    // Parser and UI keep partitions summing to the bits; the envelope path
    // must not emit an invalid ^RB from a hand-edited file.
    const design = {
      schemaVersion: 5,
      label: { widthMm: 50, heightMm: 30, dpmm: 8, rfidEpcBits: 96, rfidEpcPartitions: [1] },
      pages: [{ objects: [] }],
    };
    expect(ok(exportZpl(design)).zpl).not.toContain("^RB");
    const intact = {
      ...design,
      label: { ...design.label, rfidEpcPartitions: [8, 24, 64] },
    };
    expect(ok(exportZpl(intact)).zpl).toContain("^RB96,8,24,64");
  });

  it("declares variables so a design stays reusable across rows", () => {
    const created = ok(createDraft({
      widthMm: 100,
      heightMm: 50,
      dpmm: 8,
      variables: [{ name: "sku", defaultValue: "SKU-1" }, { name: "qty", fnNumber: 7 }],
      objects: [{ type: "text", x: 10, y: 10, props: { content: "«sku»", fontHeight: 30 } }],
    }));
    expect(created.designFile.variables).toEqual([
      { id: "var-1", name: "sku", fnNumber: 1, defaultValue: "SKU-1" },
      { id: "var-2", name: "qty", fnNumber: 7, defaultValue: "" },
    ]);
    // The marker becomes the slot, not literal text.
    expect(ok(exportZpl(created.designFile)).zpl).toContain("^FN1^FDSKU-1^FS");
  });

  it("rejects variables that would share a name or a slot", () => {
    const dupName = createDraft({
      widthMm: 50, heightMm: 30, dpmm: 8, objects: [],
      variables: [{ name: "sku" }, { name: "sku" }],
    });
    expect(dupName.ok).toBe(false);
    const dupSlot = createDraft({
      widthMm: 50, heightMm: 30, dpmm: 8, objects: [],
      variables: [{ name: "a", fnNumber: 3 }, { name: "b", fnNumber: 3 }],
    });
    expect(dupSlot.ok).toBe(false);
  });

  it("edits an existing design without rebuilding it", () => {
    const created = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [
        { type: "text", x: 10, y: 10, id: "t1", props: { content: "old", fontHeight: 20 } },
        { type: "box", x: 0, y: 0, id: "b1", props: { width: 50, height: 20 } },
      ],
    }));
    const patched = ok(patchDesign(created.designFile, [
      { op: "update", id: "t1", x: 40, props: { content: "new" } },
      { op: "remove", id: "b1" },
      { op: "add", object: { type: "qrcode", x: 5, y: 5, id: "q1", props: { content: "X" } } },
    ]));
    const objects = (patched.designFile.pages[0]?.objects ?? []) as unknown as {
      id: string;
      x: number;
      props: Record<string, unknown>;
    }[];
    expect(objects.map((o) => o.id)).toEqual(["t1", "q1"]);
    const t1 = objects.find((o) => o.id === "t1")!;
    expect(t1.x).toBe(40);
    // Props merge, so the untouched font size survives.
    expect(t1.props).toMatchObject({ content: "new", fontHeight: 20 });
    expect(patched.bounds.some((b) => b.objectId === "q1")).toBe(true);
  });

  it("reports a patch that names an object the design does not have", () => {
    const created = ok(createDraft({ widthMm: 50, heightMm: 30, dpmm: 8, objects: [] }));
    const missing = patchDesign(created.designFile, [{ op: "update", id: "nope", x: 1 }]);
    expect(missing.ok).toBe(false);
  });

  it("drops the import overlay of an edited page so the edit reaches the ZPL", () => {
    const imported = ok(importZpl("^XA^FO10,10^A0N,30,30^FDold^FS^XZ", 8));
    const patched = ok(patchDesign(imported.designFile, [
      { op: "update", id: (imported.bounds[0]?.objectId ?? ""), props: { content: "new" } },
    ]));
    const zpl = ok(exportZpl(patched.designFile)).zpl;
    expect(zpl).toContain("new");
    expect(zpl).not.toContain("old");
  });

  it("shapes a raster into a placeable image object", () => {
    const shaped = rasterImageResult({
      id: 1, ok: true, gfa: "^GFA,8,8,1,00FF00FF00FF00FF", widthDots: 8, heightDots: 8,
    }, 128);
    expect(shaped.ok).toBe(true);
    if (!shaped.ok) return;
    const created = ok(createDraft({
      widthMm: 50, heightMm: 30, dpmm: 8,
      objects: [{ ...shaped.object, x: 10, y: 10 }],
    }));
    expect(ok(exportZpl(created.designFile)).zpl).toContain("^GFA,8,8,1,00FF00FF00FF00FF");
  });

  it("passes the app's raster failure through instead of a blank image", () => {
    const failed = rasterImageResult({ id: 1, ok: false, error: "not an image" }, 128);
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.errors).toEqual(["not an image"]);
  });

  it("rejects duplicate explicit ids with a structured error", () => {
    const created = createDraft({
      widthMm: 50,
      heightMm: 30,
      dpmm: 8,
      objects: [
        { type: "text", x: 0, y: 0, id: "dup", props: { content: "a" } },
        { type: "text", x: 0, y: 20, id: "dup", props: { content: "b" } },
      ],
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.errors[0]).toContain("dup");
  });

  it("auto-generated ids skip an explicit id already taken", () => {
    const created = createDraft({
      widthMm: 50,
      heightMm: 30,
      dpmm: 8,
      objects: [
        { type: "text", x: 0, y: 0, id: "text-1", props: { content: "a" } },
        { type: "text", x: 0, y: 20, props: { content: "b" } },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ids = (created.designFile.pages[0]?.objects ?? []).map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("accepts dpmm 6 in the input schema", () => {
    const result = z
      .object(createDraftShape)
      .safeParse({ widthMm: 50, heightMm: 30, dpmm: 6, objects: [] });
    expect(result.success).toBe(true);
  });

  it("export_zpl emits objects from every page of a multi-page design", () => {
    const designFile = {
      schemaVersion: 3,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [
        { objects: [textObject("p1", "PAGE1")] },
        { objects: [textObject("p2", "PAGE2")] },
      ],
    };
    const exported = exportZpl(designFile);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.zpl).toContain("PAGE1");
    expect(exported.zpl).toContain("PAGE2");
  });

  const RAW = "^XA^FO50,50^A0N,30,30^FDHELLO^FS^BY3^FO50,120^BCN,80,Y,N,N^FD12345^FS^XZ";

  it("import_zpl parses raw ZPL into an editable, re-exportable design file", () => {
    const imported = ok(importZpl(RAW));
    const objs = imported.designFile.pages[0]?.objects ?? [];
    expect(objs.map((o) => o.type)).toEqual(["text", "code128"]);
    // The model round-trips back to ZPL through the normal export path.
    const back = exportZpl(imported.designFile);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.zpl).toContain("HELLO");
    expect(back.zpl).toContain("^BC");
  });

  it("validate_zpl reports a clean stream with no findings", () => {
    const v = ok(validateZpl(RAW));
    expect(v.objectCount).toBe(2);
    expect(v.findings.unknown).toEqual([]);
    expect(v.findings.browserLimit).toEqual([]);
  });

  it("validate_zpl surfaces commands it could not fully model", () => {
    // ^IM needs printer storage (browserLimit); ^JU is a setup command (replayRisk).
    const v = ok(validateZpl("^XA^FO10,10^FDX^FS^IMR:LOGO.GRF^JUS^XZ"));
    expect(v.findings.browserLimit.some((c) => c.startsWith("^IM"))).toBe(true);
    expect(v.findings.replayRisk).toContain("^JU");
  });

  it("create_draft reports per-object bounds; barcodes are kernel-probed exact", () => {
    const created = createDraft({
      widthMm: 100,
      heightMm: 50,
      dpmm: 8,
      objects: [
        { type: "box", x: 10, y: 20, id: "b", props: { width: 200, height: 100 } },
        { type: "code128", x: 30, y: 140, id: "c", props: { content: "12345", height: 80 } },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const box = created.bounds.find((b) => b.objectId === "b");
    expect(box).toMatchObject({ x: 10, y: 20, width: 200, height: 100, approx: false });
    const bc = created.bounds.find((b) => b.objectId === "c");
    expect(bc?.approx).toBe(false);
    // 80 bars + the 21-dot HRI line at module width 2 (Labelary-measured).
    expect(bc!.height).toBe(101);
  });

  it("reports probed barcode footprints with the full bar-rect entry", () => {
    const created = ok(createDraft({
      widthMm: 100,
      heightMm: 50,
      dpmm: 8,
      objects: [
        { type: "qrcode", x: 0, y: 0, id: "q", props: { content: "12345", magnification: 10 } },
      ],
    }));
    const q = created.bounds.find((b) => b.objectId === "q");
    expect(q?.approx).toBe(false);
    // 21 modules x mag 10, not the 200x200 registry default box.
    expect(q!.width).toBe(210);
    expect(q!.width).toBe(q!.height);
    // A rotated ^FT EAN anchors off the upright bar-rect, so the probed
    // entry must carry it, not just the outer box.
    const ean = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "ean13", x: 400, y: 300, id: "e", positionType: "FT",
        props: { content: "4012345678901", height: 80, rotation: "B" } }],
    })).bounds.find((b) => b.objectId === "e");
    expect(ean?.approx).toBe(false);
    expect(ean!.height).toBeGreaterThan(80);
  });

  it("exports an imported image's ^GFA bytes in a headless host", () => {
    // Without the store the imported _gfaCache is the only byte source;
    // an empty ^FD^FS with ok:true would silently lose the graphic.
    const gfa = "^GFA,8,8,1,00FF00FF00FF00FF";
    const leaf = {
      id: "img", type: "image", x: 10, y: 20, rotation: 0,
      props: { imageId: "gone", widthDots: 8, threshold: 128, rotation: "N", _gfaCache: gfa },
    };
    const design = {
      schemaVersion: 5,
      label: { widthMm: 50, heightMm: 30, dpmm: 8 },
      pages: [{ objects: [leaf] }],
    };
    const out = ok(exportZpl(design));
    expect(out.zpl).toContain(gfa);
    expect(ok(validateDraft(design)).warnings.some((w) => w.kind === "imageMissing")).toBe(false);
    // A rotated field would need a re-raster no headless host can do.
    const rotated = { ...design, pages: [{ objects: [{ ...leaf, props: { ...leaf.props, rotation: "R" } }] }] };
    const outR = ok(exportZpl(rotated));
    expect(outR.zpl).not.toContain(gfa);
    expect(ok(validateDraft(rotated)).warnings.some((w) => w.kind === "imageMissing")).toBe(true);
  });

  it("emits and measures a store-less cache by its ^GFA header truth", () => {
    // A foreign envelope may carry stale props; the header is the byte
    // truth, so non-square images survive headless export.
    const gfa = "^GFA,4,4,1,00FF00FF"; // 8 dots wide, 4 rows: non-square
    const design = (widthDots: number) => ({
      schemaVersion: 5,
      label: { widthMm: 50, heightMm: 30, dpmm: 8 },
      pages: [{ objects: [{
        id: "img", type: "image", x: 0, y: 0, rotation: 0,
        props: { imageId: "gone", widthDots, threshold: 128, rotation: "N", _gfaCache: gfa },
      }] }],
    });
    expect(ok(exportZpl(design(8))).zpl).toContain(gfa);
    // Mismatched props still export the bytes; bounds follow the header.
    const mismatched = ok(validateDraft(design(200)));
    expect(mismatched.warnings.some((w) => w.kind === "imageMissing")).toBe(false);
    expect(mismatched.bounds.find((b) => b.objectId === "img"))
      .toMatchObject({ width: 8, height: 4, approx: false });
  });

  it("reports a preserved foreign header with an empty count slot", () => {
    // Labelary: a ^GF missing c eats the rest of the stream (^XZ included), so the field must drop loudly.
    const gfa = "^GFA,4,,1,00FF00FF";
    const design = {
      schemaVersion: 5,
      label: { widthMm: 50, heightMm: 30, dpmm: 8 },
      pages: [{ objects: [{
        id: "img", type: "image", x: 0, y: 0, rotation: 0,
        props: { imageId: "gone", widthDots: 8, heightDots: 4, threshold: 128, rotation: "N", _gfaCache: gfa },
      }] }],
    };
    expect(ok(exportZpl(design)).zpl).not.toContain(gfa);
    const report = ok(validateDraft(design));
    expect(report.warnings.some((w) => w.kind === "imageMissing")).toBe(true);
    // Bounds still describe the field, from props, so placement stays editable.
    expect(report.bounds.find((b) => b.objectId === "img"))
      .toMatchObject({ width: 8, height: 4 });
    // Fractional or zero rows stay unusable (malformed header).
    const bad = { ...design, pages: [{ objects: [{ ...design.pages[0]!.objects[0]!,
      props: { ...design.pages[0]!.objects[0]!.props, _gfaCache: "^GFA,5,5,2,00FF00FF00" } }] }] };
    expect(ok(exportZpl(bad)).zpl).not.toContain("^GFA,5,5,2");
    expect(ok(validateDraft(bad)).warnings.some((w) => w.kind === "imageMissing")).toBe(true);
  });

  it("off-label preflight judges barcodes by their probed size", () => {
    // A probed QR (210 dots) overflowing a label its 200-dot default box
    // would still fit must warn; warnings and bounds share one measured map.
    const nearEdge = ok(createDraft({
      widthMm: 30, heightMm: 30, dpmm: 8, // 240 dots printable
      objects: [{ type: "qrcode", x: 35, y: 0, id: "q",
        props: { content: "12345", magnification: 10 } }],
    }));
    expect(nearEdge.warnings.some((w) => w.objectId === "q" && w.kind.startsWith("offLabel"))).toBe(true);
  });

  it("keeps a ^GFA cache that has no source image, and takes fresh bytes", () => {
    // Without a source image the cache is the graphic's only copy, and the
    // header (not widthDots) is what the emit anchors by.
    const entry = ObjectRegistry.image;
    const obj = {
      id: "i", type: "image", x: 0, y: 0, rotation: 0,
      props: { imageId: "gone", widthDots: 64, threshold: 128, rotation: "N", _gfaCache: "^GFA,8,8,1,00FF00FF00FF00FF" },
    } as never;
    const widthOnly = entry.normalizeChanges!(obj, { props: { widthDots: 80 } });
    expect("_gfaCache" in (widthOnly.props as object)).toBe(false);
    const withFresh = entry.normalizeChanges!(obj, { props: { widthDots: 80, _gfaCache: "^GFA,1,1,1,00" } });
    expect((withFresh.props as { _gfaCache?: string })._gfaCache).toBe("^GFA,1,1,1,00");
    const unrelated = entry.normalizeChanges!(obj, { props: { rotation: "R" } });
    expect("_gfaCache" in (unrelated.props as object)).toBe(false);
  });

  it("validate_zpl reports the intersection rect of two overlapping boxes", () => {
    const v = ok(validateZpl("^XA^FO0,0^GB100,100,3^FS^FO60,60^GB100,100,3^FS^XZ"));
    expect(v.overlaps).toHaveLength(1);
    expect(v.overlaps[0]).toMatchObject({ width: 40, height: 40, approx: false });
  });

  // Multi-^XA streams must keep one page per block: flattening them merges
  // labels on export and reports phantom overlaps between different labels.
  it("keeps one page per ^XA block and finds no cross-page overlaps", () => {
    const two = "^XA^FO50,50^GB100,100,3^FS^XZ^XA^FO50,50^GB100,100,3^FS^XZ";
    const v = ok(validateZpl(two));
    expect(v.pageCount).toBe(2);
    expect(v.objectCount).toBe(2);
    expect(v.overlaps).toEqual([]);
    const imported = ok(importZpl(two));
    expect(imported.designFile.pages).toHaveLength(2);
    const back = exportZpl(imported.designFile);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.zpl.match(/\^XA/g)).toHaveLength(2);
  });

  // Roundtrip guarantee: unmodeled commands survive import → export via the
  // captured overlay instead of being silently dropped.
  it("re-exports unmodeled commands verbatim after import_zpl", () => {
    const imported = ok(importZpl("^XA^FO10,10^A0N,30,30^FDX^FS^IMR:LOGO.GRF^JUS^XZ"));
    expect(imported.findings.browserLimit.some((c) => c.startsWith("^IM"))).toBe(true);
    const back = exportZpl(imported.designFile);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.zpl).toContain("^IMR:LOGO.GRF");
    expect(back.zpl).toContain("^JUS");
  });

  it("dedupes repeated findings to one entry per command", () => {
    const v = ok(validateZpl("^XA^JUS^FO10,10^FDX^FS^JUS^XZ"));
    expect(v.findings.replayRisk).toEqual(["^JU"]);
  });

  it("strips the per-occurrence findings array from the compact bucket view", () => {
    const v = ok(validateZpl("^XA^FO10,10^FDX^FS^XZ"));
    expect(v.findings).not.toHaveProperty("findings");
    expect(Object.keys(v.findings).sort()).toEqual(
      ["browserLimit", "deviceAction", "partial", "replayRisk", "unknown"],
    );
  });

  it("rounds derived geometry to 0.1 dot, dropping float tails", () => {
    // A diagonal line's bbox comes from cos/sin, so it carries the float tail
    // the payload should not (200·cos40°, 200·sin40° + thickness).
    const created = createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "line", x: 0, y: 0, id: "diag", props: { angle: 40, length: 200, thickness: 4 } }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const b = created.bounds[0];
    expect(b?.width).toBe(157.2);
    expect(b?.height).toBe(128.6);
  });

  it("validate_zpl uses caller size hints for streams without ^PW/^LL", () => {
    const v = ok(validateZpl("^XA^FO10,10^FDX^FS^XZ", 8, 150, 100));
    expect(v.label.widthMm).toBe(150);
    expect(v.label.heightMm).toBe(100);
  });

  it("rejects an oversized ZPL stream instead of parsing it", () => {
    const huge = "^XA" + "^FO1,1^GB9,9,1^FS".repeat(20000) + "^XZ";
    const v = validateZpl(huge);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toMatch(/limit/);
  });

  it("caps overlaps and flags truncation on a degenerate label", () => {
    // 40 boxes all at the origin: 40·39/2 = 780 pairs, over the 500 cap.
    const boxes = Array.from({ length: 40 }, (_v, i) =>
      ({ type: "box" as const, x: 0, y: 0, id: `b${i}`, props: { width: 50, height: 50 } }));
    const created = createDraft({ widthMm: 100, heightMm: 50, dpmm: 8, objects: boxes });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.overlaps.length).toBeLessThanOrEqual(500);
    expect(created.geometryTruncated).toBe(true);
  });

  it("skips geometry for a page past the object cap", () => {
    const objs = Array.from({ length: 2001 }, (_v, i) =>
      ({ type: "box" as const, x: i, y: 0, id: `b${i}`, props: { width: 5, height: 5 } }));
    const created = createDraft({ widthMm: 400, heightMm: 50, dpmm: 8, objects: objs });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.bounds).toEqual([]);
    expect(created.geometryTruncated).toBe(true);
  });

  it("does not flag truncation for a complete overlap set at the cap", () => {
    // 32 boxes all at the origin: 32·31/2 = 496 pairs, just under the 500 cap.
    const boxes = Array.from({ length: 32 }, (_v, i) =>
      ({ type: "box" as const, x: 0, y: 0, id: `b${i}`, props: { width: 50, height: 50 } }));
    const created = createDraft({ widthMm: 100, heightMm: 50, dpmm: 8, objects: boxes });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.overlaps).toHaveLength(496);
    expect(created.geometryTruncated).toBeUndefined();
  });

  it("admits a byte-per-char binary stream up to the full cap", () => {
    // The cap counts code units: UTF-8 byteLength would double-count latin1
    // binary payloads and reject valid streams at half the documented limit.
    const bin = String.fromCharCode(0x80).repeat(200_000);
    const v = validateZpl(`^XA^FO0,0^GFB,200000,200000,250,${bin}^FS^XZ`);
    expect(v.ok).toBe(true);
    const over = validateZpl("^XA^FO10,10^FD" + "x".repeat(262_144) + "^FS^XZ");
    expect(over.ok).toBe(false);
  });

  it("counts group children against the object cap, subtrees included", () => {
    const children = Array.from({ length: 10001 }, (_v, i) => textObject(`c${i}`, "x"));
    const df = {
      schemaVersion: 3,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [{ id: "g", type: "group", x: 0, y: 0, rotation: 0, children }] }],
    };
    const r = validateDraft(df);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/object limit/);
  });

  it("resolves per-page ^JM density in preflight and geometry", () => {
    // 100mm at dpmm 12: printable width 1200 dots at density A, 600 at B.
    // x=700 is inside the design-density rect but outside the page's B rect.
    const df = {
      schemaVersion: 3,
      label: { widthMm: 100, heightMm: 50, dpmm: 12 },
      pages: [
        { objects: [textObject("t1", "A")] },
        { jmDensity: "B", objects: [{ ...textObject("t2", "B"), x: 700, y: 50 }] },
      ],
    };
    const r = ok(validateDraft(df));
    const page1Kinds = r.warnings.filter((w) => w.pageIndex === 1).map((w) => w.kind);
    expect(page1Kinds).toContain("offLabelOutside");
  });

  it("rejects a design file past the page limit", () => {
    const pages = Array.from({ length: 1001 }, () => ({ objects: [] as never[] }));
    const df = { schemaVersion: 3, label: { widthMm: 100, heightMm: 50, dpmm: 8 }, pages };
    const r = validateDraft(df);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/page limit/);
  });

  it("caps object count on the raw-ZPL path too, not just bytes", () => {
    // ~10001 tiny fields: well under the 256 KB byte cap but over the object cap.
    const raw = "^XA" + "^FO1,1^GB2,2,1^FS".repeat(10001) + "^XZ";
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThan(256 * 1024);
    const v = validateZpl(raw);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toMatch(/object limit/);
  });

  it("carries positionType and fieldJustify from create_draft input", () => {
    const created = createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{
        type: "text", x: 700, y: 20, id: "t",
        positionType: "FT", fieldJustify: "R",
        props: { content: "Right", fontHeight: 30 },
      }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const obj = created.designFile.pages[0]?.objects[0] as { positionType?: string; fieldJustify?: string };
    expect(obj.positionType).toBe("FT");
    expect(obj.fieldJustify).toBe("R");
  });

  it("rejects an unbalanced ^XA/^XZ stream on both raw-ZPL tools", () => {
    const open = "^XA^FO10,10^A0N,30,30^FDX^FS";
    const v = validateZpl(open);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toMatch(/\^XA\/\^XZ/);
    expect(importZpl(open).ok).toBe(false);
  });

  it("rejects a multi-^XA stream whose blocks set different ^PW/^LL sizes", () => {
    const mixed = "^XA^PW400^LL200^FO10,10^FDA^FS^XZ^XA^PW800^LL400^FO10,10^FDB^FS^XZ";
    const v = validateZpl(mixed);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toMatch(/different \^PW\/\^LL|single-label/);
    expect(importZpl(mixed).ok).toBe(false);
  });

  it("rejects a multi-^XA stream whose blocks diverge in ^JM at equal size", () => {
    const mixed = "^XA^PW800^LL400^FO10,10^FDA^FS^XZ^XA^JMB^PW800^LL400^FO10,10^FDB^FS^XZ";
    const v = validateZpl(mixed);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toMatch(/\^JM density modes/);
    expect(importZpl(mixed).ok).toBe(false);
  });

  it("accepts multi-^XA blocks that share one explicit size", () => {
    const same = "^XA^PW800^LL400^FO10,10^FDA^FS^XZ^XA^FO10,10^FDB^FS^XZ";
    const v = validateZpl(same);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pageCount).toBe(2);
  });

  it("createDraft rejects an oversized object list before building it", () => {
    const objs = Array.from({ length: 10001 }, (_v, i) =>
      ({ type: "box" as const, x: 0, y: 0, id: `b${i}`, props: { width: 1, height: 1 } }));
    const created = createDraft({ widthMm: 100, heightMm: 50, dpmm: 8, objects: objs });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.errors[0]).toMatch(/object limit/);
  });
});

describe("buildCurrentDesignResult", () => {
  const barcode = {
    id: "bc1",
    type: "code128",
    x: 20,
    y: 20,
    rotation: 0,
    props: { content: "12345678", height: 100, moduleWidth: 2, rotation: "N" },
  };
  const design = {
    schemaVersion: 3,
    label: { widthMm: 100, heightMm: 50, dpmm: 8 },
    pages: [{ objects: [barcode] }],
  };

  it("keeps the print-true kernel bounds over the app's zoom-scaled number", () => {
    // The canvas measures the SCREEN at the user's zoom (module widths collapse
    // to whole pixels there); the kernel measures the print. Letting the app
    // entry shadow the kernel gave the same design two verdicts from two tools.
    const kernel = ok(buildCurrentDesignResult({ id: 2, designFile: design }));
    const truth = kernel.bounds.find((x) => x.objectId === "bc1")!;
    const result = ok(buildCurrentDesignResult({
      id: 1,
      designFile: design,
      measured: { bc1: { width: 321, height: 118 } },
    }));
    const b = result.bounds.find((x) => x.objectId === "bc1")!;
    expect(b.width).toBe(truth.width);
    expect(b.width).not.toBe(321);
    expect(b.approx).toBe(false);
  });

  it("probes a barcode the app did not measure (kernel fallback, exact)", () => {
    const result = ok(buildCurrentDesignResult({ id: 2, designFile: design }));
    expect(result.bounds.find((x) => x.objectId === "bc1")?.approx).toBe(false);
  });

  it("maps a malformed design to the ToolError shape", () => {
    expect(buildCurrentDesignResult({ id: 3, designFile: { schemaVersion: 3 } }).ok).toBe(false);
  });
});

describe("prop typing", () => {
  const draft = (props: Record<string, unknown>) =>
    createDraft({
      widthMm: 50,
      heightMm: 30,
      dpmm: 8,
      objects: [{ type: "text", x: 10, y: 10, props: { content: "x", ...props } }],
    });

  it("rejects a prop whose type contradicts the registry default", () => {
    const r = draft({ fontHeight: "gross" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("text.fontHeight must be number");
  });

  it("rejects a non-finite number before it reaches the emitted ZPL", () => {
    const r = draft({ fontHeight: Number.NaN });
    expect(r.ok).toBe(false);
  });

  it("takes a prop the defaults do not list", () => {
    expect(draft({ reverse: true }).ok).toBe(true);
  });

  it("rejects the same mistake on a patch update", () => {
    const base = ok(draft({}));
    const patched = patchDesign(base.designFile, [
      { op: "update", id: "text-1", props: { fontHeight: "gross" } },
    ]);
    expect(patched.ok).toBe(false);
  });

  it("rejects it on a patch add", () => {
    const base = ok(draft({}));
    const patched = patchDesign(base.designFile, [
      { op: "add", object: { type: "text", x: 1, y: 1, props: { fontHeight: [] } } },
    ]);
    expect(patched.ok).toBe(false);
  });
});

describe("variable slots", () => {
  it("names the real reason an ^FN slot is refused", () => {
    const r = createDraft({
      widthMm: 50,
      heightMm: 30,
      dpmm: 8,
      objects: [],
      variables: [{ name: "a", fnNumber: 9999 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("^FN slot must be 1-99");
  });
});

describe("raw ZPL without a label block", () => {
  it("is refused instead of passing as an empty design", () => {
    expect(importZpl("das ist kein zpl").ok).toBe(false);
    expect(validateZpl("").ok).toBe(false);
  });
});

describe("encode preflight", () => {
  const ean = (content: string) =>
    ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        objects: [{ type: "ean13", x: 10, y: 10, props: { content, height: 60 } }],
      }),
    ).warnings.filter((w) => w.kind === "renderFailed");

  it("flags a payload the encoder rejects", () => {
    expect(ean("123")).toHaveLength(1);
  });

  it("stays quiet on a valid payload", () => {
    expect(ean("4012345123456")).toHaveLength(0);
  });
});

describe("agent-facing reporting", () => {
  const label = (objects: Parameters<typeof createDraft>[0]["objects"], variables?: Parameters<typeof createDraft>[0]["variables"]) =>
    createDraft({ widthMm: 60, heightMm: 40, dpmm: 8, objects, ...(variables ? { variables } : {}) });

  it("says WHY a payload did not encode", () => {
    const r = ok(label([{ type: "ean13", x: 10, y: 10, props: { content: "123", height: 60 } }]));
    const failed = r.warnings.find((w) => w.kind === "renderFailed");
    expect(failed?.detail).toBeTruthy();
  });

  it("rejects a rotation the firmware cannot read", () => {
    const r = label([{ type: "text", x: 1, y: 1, props: { content: "x", rotation: "90" } }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("must be N, R, I or B");
  });

  it("rejects byHeight on a non-qrcode type instead of swallowing it", () => {
    // The global optional/known maps would accept it silently on any type.
    const r = label([
      { type: "code128", x: 1, y: 1, props: { content: "123", height: 80, moduleWidth: 2, byHeight: 12 } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("byHeight is a qrcode prop");
  });

  it("rejects a byHeight no ^BY could pin, keeps any positive integer", () => {
    for (const byHeight of [1.5, 0, -3]) {
      const r = label([
        { type: "qrcode", x: 1, y: 1, props: { content: "x", byHeight } },
      ]);
      expect(r.ok, String(byHeight)).toBe(false);
      if (r.ok) continue;
      expect(r.errors[0]).toContain("byHeight must be a positive integer");
    }
    // Imported designs may carry any source value; the boundary must not
    // reject on validate/export what the parser faithfully captured.
    for (const byHeight of [50, 50000]) {
      expect(label([
        { type: "qrcode", x: 1, y: 1, props: { content: "x", byHeight } },
      ]).ok, String(byHeight)).toBe(true);
    }
  });

  it("remarks on a prop that will never print", () => {
    const r = ok(label([{ type: "text", x: 1, y: 1, id: "t1", props: { content: "x", fontSize: 60 } }]));
    expect(r.notes?.[0]).toContain("t1: fontSize is not a known text prop");
  });

  it("remarks on a marker that binds nothing, and on an unused variable", () => {
    const r = ok(
      label([{ type: "text", x: 1, y: 1, id: "t1", props: { content: "Lot «LOT»" } }], [
        { name: "lot", defaultValue: "A" },
      ]),
    );
    expect(r.notes).toEqual([
      "t1: «LOT» matches no variable and prints as text",
      "variable lot is never referenced by any content",
    ]);
  });

  it("leaves clock and control markers alone; they bind to ^FC and ^FH", () => {
    const r = ok(
      label([
        { type: "text", x: 1, y: 1, props: { content: "Datum «clock:Y»" } },
        { type: "text", x: 1, y: 30, props: { content: "A«ctrl:FS»B" } },
      ]),
    );
    expect(r.notes).toBeUndefined();
  });

  it("does not call a prop a typo when some other type owns the name", () => {
    // gs1databar documents no props of its own; `gs1` belongs to code128.
    const r = ok(label([{ type: "gs1databar", x: 1, y: 1, props: { content: "(01)04012345123456", gs1: true } }]));
    expect(r.notes).toBeUndefined();
  });

  it("stays quiet when every marker binds", () => {
    const r = ok(
      label([{ type: "text", x: 1, y: 1, props: { content: "Lot «lot»" } }], [
        { name: "lot", defaultValue: "A" },
      ]),
    );
    expect(r.notes).toBeUndefined();
  });

  it("keeps a documented but undefaulted prop out of the notes", () => {
    const r = ok(
      label([
        { type: "code128", x: 1, y: 1, props: { content: "(01)04012345123456", gs1: true } },
        { type: "text", x: 1, y: 90, props: { content: "X", reverse: true } },
      ]),
    );
    expect(r.notes).toBeUndefined();
  });

  it("reports a payload the AI catalog rewrote instead of printing it silently", () => {
    const r = ok(label([{ type: "code128", x: 1, y: 1, props: { content: "(01)4012345678901", gs1: true } }]));
    const rewritten = r.warnings.find((w) => w.kind === "gs1ValueInvalid");
    // 13 digits become a DIFFERENT 14-digit number, not the one a user assumes.
    expect(rewritten?.detail).toContain("(01)40123456789010");
  });

  it("marks the box of a payload that does not encode as an estimate", () => {
    const r = ok(label([{ type: "ean13", x: 1, y: 1, props: { content: "123", height: 60 } }]));
    expect(r.bounds[0]?.approx).toBe(true);
  });

  it("names the type and content in bounds, so an edit can be aimed", () => {
    const r = ok(label([{ type: "text", x: 1, y: 1, props: { content: "Bestand" } }]));
    expect(r.bounds[0]?.type).toBe("text");
    expect(r.bounds[0]?.content).toBe("Bestand");
  });

  it("reports the label size an import settled on", () => {
    const r = importZpl("^XA^PW640^LL406^FO10,10^A0N,20,20^FDx^FS^XZ", 8, 100, 51);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.label.widthMm).toBe(80);
    expect(r.label.heightMm).toBeCloseTo(50.75, 1);
  });
});

describe("variable ops", () => {
  const twoVars = () =>
    ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        objects: [{ type: "text", id: "t", x: 1, y: 1, props: { content: "«a» und «b»" } }],
        variables: [{ name: "a", defaultValue: "A" }, { name: "b", defaultValue: "B" }],
      }),
    ).designFile;

  const base = () =>
    ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        objects: [{ type: "text", id: "t", x: 1, y: 1, props: { content: "Lot «lot»" } }],
        variables: [{ name: "lot", defaultValue: "A1" }],
      }),
    ).designFile;

  it("adds a variable without a rebuild", () => {
    const r = ok(patchDesign(base(), [{ op: "addVariable", variable: { name: "batch", defaultValue: "B" } }]));
    expect(r.designFile.variables?.map((v) => v.name)).toEqual(["lot", "batch"]);
  });

  it("refuses a name that is already taken", () => {
    const r = patchDesign(base(), [{ op: "addVariable", variable: { name: "lot" } }]);
    expect(r.ok).toBe(false);
  });

  it("renames the variable and the markers that reference it", () => {
    const r = ok(patchDesign(base(), [{ op: "updateVariable", name: "lot", newName: "charge" }]));
    expect(r.designFile.variables?.[0]?.name).toBe("charge");
    // The marker followed the rename, so the field still binds slot 1.
    expect(ok(exportZpl(r.designFile)).zpl).toContain("^FDLot #1#");
    expect(r.notes).toBeUndefined();
  });

  it("leaves the last value as text when a variable goes", () => {
    const r = ok(patchDesign(base(), [{ op: "removeVariable", name: "lot" }]));
    expect(ok(exportZpl(r.designFile)).zpl).toContain("^FDLot A1^FS");
    expect(r.designFile.variables ?? []).toEqual([]);
  });

  it("rename to an existing name is refused", () => {
    const r = patchDesign(twoVars(), [{ op: "updateVariable", name: "a", newName: "b" }]);
    expect(r.ok).toBe(false);
  });

  it("removing both leaves literal text and no ^FN", () => {
    const r = patchDesign(twoVars(), [
      { op: "removeVariable", name: "a" },
      { op: "removeVariable", name: "b" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const z = exportZpl(r.designFile);
    expect(z.ok && z.zpl.includes("^FN")).toBe(false);
    expect(z.ok && z.zpl.includes("A und B")).toBe(true);
  });

  it("a rename chain in one call lands on the last name", () => {
    const r = patchDesign(twoVars(), [
      { op: "updateVariable", name: "a", newName: "x" },
      { op: "updateVariable", name: "x", newName: "y" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.designFile.variables?.map((v) => v.name)).toEqual(["y", "b"]);
    const z = exportZpl(r.designFile);
    expect(z.ok && z.zpl).toContain("#1# und #2#");
  });

  it("a swap in one call does not cascade", () => {
    const r = patchDesign(twoVars(), [
      { op: "updateVariable", name: "a", newName: "tmp" },
      { op: "updateVariable", name: "b", newName: "a" },
      { op: "updateVariable", name: "tmp", newName: "b" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.designFile.variables?.map((v) => `${v.name}=${v.defaultValue}`)).toEqual(["b=A", "a=B"]);
  });

  it("reports the variable it cannot find", () => {
    const r = patchDesign(base(), [{ op: "removeVariable", name: "nope" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("No variable named nope");
  });

  it("carries the warnings on the exported ZPL too", () => {
    const r = ok(exportZpl(base()));
    expect(r.warnings.some((w) => w.kind === "printerSupportLimited")).toBe(true);
  });
});

describe("what a patch must not touch", () => {
  const withMapping = () =>
    JSON.parse(
      serializeDesign(
        { widthMm: 100, heightMm: 50, dpmm: 8 },
        [{ objects: [textObject("t", "«lot»") as never] }],
        [{ id: "v1", name: "lot", fnNumber: 1, defaultValue: "A" }],
        { bindings: { lot: "COL_BATCH" }, headerSnapshot: ["COL_BATCH"] },
      ),
    ) as Record<string, unknown>;

  it("keeps the user's dataset binding across an object edit", () => {
    const r = ok(patchDesign(withMapping(), [{ op: "update", id: "t", x: 11 }]));
    expect((r.designFile as unknown as { csvMapping?: unknown }).csvMapping).toEqual({
      bindings: { lot: "COL_BATCH" },
      headerSnapshot: ["COL_BATCH"],
    });
  });

  it("keeps it when only a variable default changes", () => {
    const r = ok(
      patchDesign(withMapping(), [{ op: "updateVariable", name: "lot", newName: "lot", defaultValue: "B" }]),
    );
    expect((r.designFile as unknown as { csvMapping?: unknown }).csvMapping).toBeDefined();
  });

  it("keeps the import overlay when the call changes nothing", () => {
    const imported = importZpl("^XA^FN1^FDA^FS^FO10,10^A0N,30,30^FE#^FDx #1#^FS^IMR:LOGO.GRF^XZ", 8);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const name = imported.designFile.variables?.[0]?.name ?? "";
    const r = ok(patchDesign(imported.designFile, [{ op: "updateVariable", name, newName: name }]));
    expect(ok(exportZpl(r.designFile)).zpl).toContain("^IMR:LOGO.GRF");
  });

  it("never hands out an id the design already holds", () => {
    const base = ok(
      createDraft({
        widthMm: 50,
        heightMm: 30,
        dpmm: 8,
        objects: [{ type: "text", id: "text-2", x: 10, y: 10, props: { content: "a" } }],
      }),
    );
    const r = ok(
      patchDesign(base.designFile, [
        { op: "add", object: { type: "text", x: 20, y: 20, props: { content: "b" } } },
      ]),
    );
    const ids = r.bounds.map((b) => b.objectId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports the threshold the raster actually used", () => {
    const shaped = rasterImageResult(
      { id: 1, ok: true, gfa: "^GFA,8,8,1,00FF00FF00FF00FF", widthDots: 8, heightDots: 8 },
      80,
    );
    expect(shaped.ok && (shaped.object.props as { threshold: number }).threshold).toBe(80);
  });
});

describe("placement judged on the value, not the marker", () => {
  const label = (content: string, defaultValue: string) =>
    ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        objects: [{ type: "text", id: "t", x: 300, y: 10, props: { content, fontHeight: 30 } }],
        variables: [{ name: "v", defaultValue }],
      }),
    );

  it("warns when the substituted value runs off the label", () => {
    const r = label("«v»", "A VERY LONG CONSIGNEE NAME THAT OVERFLOWS");
    const box = r.bounds[0]!;
    expect(box.x + box.width).toBeGreaterThan(480);
    expect(r.warnings.map((w) => w.kind)).toContain("offLabelClipped");
  });

  it("stays quiet when the value fits, though the marker is longer", () => {
    const r = label("«v»", "OK");
    expect(r.warnings).toEqual([]);
  });

  it("still calls that box an estimate", () => {
    expect(label("«v»", "OK").bounds[0]?.approx).toBe(true);
  });
});

describe("variable ops keep the design's other bindings intact", () => {
  const bound = () =>
    JSON.parse(
      serializeDesign(
        { widthMm: 60, heightMm: 40, dpmm: 8 },
        [{ objects: [textObject("t", "«lot»") as never] }],
        [{ id: "v1", name: "lot", fnNumber: 1, defaultValue: "A" }],
        { bindings: { v1: "COL_BATCH" }, headerSnapshot: ["COL_BATCH"] },
      ),
    ) as Record<string, unknown>;
  const mappingOf = (d: unknown) =>
    (d as { csvMapping?: { bindings: Record<string, string> } }).csvMapping?.bindings;

  it("adding a variable leaves the existing ids alone", () => {
    const r = ok(patchDesign(bound(), [{ op: "addVariable", variable: { name: "batch" } }]));
    expect(r.designFile.variables?.map((v) => v.id)).toEqual(["v1", "var-2"]);
    expect(mappingOf(r.designFile)).toEqual({ v1: "COL_BATCH" });
  });

  it("removing a variable takes its dataset binding with it", () => {
    const r = ok(patchDesign(bound(), [{ op: "removeVariable", name: "lot" }]));
    expect(mappingOf(r.designFile)).toEqual({});
  });

  it("a default carrying a marker is planted as text, not as a new binding", () => {
    const base = ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        objects: [{ type: "text", id: "t", x: 1, y: 1, props: { content: "«a»" } }],
        variables: [{ name: "a", defaultValue: "«b»" }, { name: "b", defaultValue: "X" }],
      }),
    );
    const r = ok(patchDesign(base.designFile, [{ op: "removeVariable", name: "a" }]));
    const zpl = ok(exportZpl(r.designFile)).zpl;
    expect(zpl).toContain("^FDb^FS");
    expect(zpl).not.toContain("^FN2^FS");
  });

  it("refuses a variable name the editor would refuse", () => {
    const r = createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8, objects: [],
      variables: [{ name: "a»b" }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("editing a page keeps what the model does not carry", () => {
  const stream = "^XA^FWR^ZZ99,7^FO10,10^A0N,30,30^FDhello^FS^FO10,60^A0N,30,30^FDb^XZ";
  const imported = () => {
    const r = importZpl(stream, 8);
    if (!r.ok) throw new Error(r.errors.join());
    return r;
  };

  it("re-exports an untouched import byte for byte", () => {
    expect(ok(exportZpl(imported().designFile)).zpl.replace(/\n/g, "")).toBe(stream);
  });

  it("keeps the unmodelled commands and the unmodelled field through an update", () => {
    const r = imported();
    const id = r.bounds[0]!.objectId;
    const patched = ok(patchDesign(r.designFile, [{ op: "update", id, x: 11 }]));
    const zpl = ok(exportZpl(patched.designFile)).zpl;
    expect(zpl).toContain("^FWR");
    expect(zpl).toContain("^ZZ99,7");
    expect(zpl).toContain("^FDb");
    expect(zpl).toContain("^FO11,10");
  });

  it("drops the capture when an object is added, which it cannot describe", () => {
    const r = imported();
    const patched = ok(
      patchDesign(r.designFile, [
        { op: "add", object: { type: "text", x: 5, y: 5, props: { content: "new" } } },
      ]),
    );
    const zpl = ok(exportZpl(patched.designFile)).zpl;
    expect(zpl).toContain("^FDnew");
    expect(zpl).not.toContain("^ZZ99,7");
  });
});

describe("marker value checks the app runs", () => {
  it("reports a template whose escape character pool ran out", () => {
    // Every candidate ^FE char occurs in the content, so no ^FE can be armed
    // and the marker would print its guillemets instead of binding.
    const r = ok(
      createDraft({
        widthMm: 100, heightMm: 80, dpmm: 8,
        objects: [{ type: "text", id: "a", x: 10, y: 10, props: { content: "#@$%&*+=?!:;| «v1»", fontHeight: 30 } }],
        variables: [{ name: "v1", defaultValue: "AAA" }],
      }),
    );
    expect(r.warnings.map((w) => w.kind)).toContain("markerArmFailed");
  });

  it("stays quiet when an escape character is still free", () => {
    const r = ok(
      createDraft({
        widthMm: 100, heightMm: 80, dpmm: 8,
        objects: [{ type: "text", id: "a", x: 10, y: 10, props: { content: "#@| «v1»", fontHeight: 30 } }],
        variables: [{ name: "v1", defaultValue: "AAA" }],
      }),
    );
    expect(r.warnings.map((w) => w.kind)).not.toContain("markerArmFailed");
  });
});

describe("a variable inside GS1 content", () => {
  const draft = (type: string) =>
    ok(
      createDraft({
        widthMm: 70, heightMm: 40, dpmm: 8,
        variables: [{ name: "GTIN", defaultValue: "04150123456782" }],
        objects: [{ type, id: "s", x: 10, y: 10, props: { content: "(01)«GTIN»", gs1: true, height: 60, dimension: 6 } }],
      }),
    );

  it("emits the slot, not a check digit computed over the slot number", () => {
    for (const type of ["code128", "datamatrix"]) {
      const zpl = ok(exportZpl(draft(type).designFile)).zpl;
      expect(zpl, type).toContain("#1#");
      expect(zpl, type).not.toContain("00000000000");
    }
  });

  it("stays quiet on the typed form, which emits correctly", () => {
    expect(draft("datamatrix").warnings.map((w) => w.kind)).not.toContain("gs1ValueInvalid");
  });

  it("flags a code128 template the catalog cannot segment either", () => {
    const r = ok(
      createDraft({
        widthMm: 70, heightMm: 40, dpmm: 8,
        variables: [{ name: "LOT", defaultValue: "L42" }],
        objects: [{ type: "code128", id: "b", x: 10, y: 10, props: { content: "10«LOT»17261231", gs1: true, height: 60 } }],
      }),
    );
    expect(r.warnings.map((w) => w.kind)).toContain("gs1ValueInvalid");
  });

  it("flags DataMatrix content a variable cannot be placed in structurally", () => {
    const r = ok(
      createDraft({
        widthMm: 70, heightMm: 40, dpmm: 8,
        variables: [{ name: "GTIN", defaultValue: "04150123456782" }],
        objects: [{ type: "datamatrix", id: "s", x: 10, y: 10, props: { content: "01«GTIN»", gs1: true, dimension: 6 } }],
      }),
    );
    expect(r.warnings.map((w) => w.kind)).toContain("gs1ValueInvalid");
  });
});

describe("a supplied graphic payload", () => {
  const withCache = (cache: string) =>
    createDraft({
      widthMm: 50, heightMm: 30, dpmm: 8,
      objects: [{ type: "image", x: 10, y: 10, props: { imageId: "", widthDots: 8, _gfaCache: cache } }],
    });

  it("refuses a payload whose bytes run past the declared header count", () => {
    const r = withCache("^GFA,1,1,1,00^XZ^XA^JUF");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("not graphic data");
  });

  it("takes a plain hex payload", () => {
    expect(withCache("^GFA,4,4,2,FF00FF00").ok).toBe(true);
  });

  it("takes the binary formats the parser itself writes, on the same payload rule", () => {
    // Decoded :B64: graphics keep their format letter, so B/C are legitimate;
    // a control prefix in the payload is still refused.
    expect(withCache("^GFB,4,4,2,:B64:AAAA:9c02").ok).toBe(true);
    expect(withCache("^GFB,1,1,1,QQ^XZ^XA^JUF").ok).toBe(false);
  });

  it("takes the compression characters the spec allows", () => {
    expect(withCache("^GFA,4,4,2,FF,!").ok).toBe(true);
  });
});

describe("a variable edit against captured bytes", () => {
  const imported = () => {
    const r = importZpl("^XA^FN1^FDALT^FS^FO10,10^A0N,30,30^FE#^FDLot #1#^FS^MD9^XZ", 8);
    if (!r.ok) throw new Error(r.errors.join());
    return r.designFile;
  };

  it("re-emits the declaration instead of replaying the old default", () => {
    const df = imported();
    const name = df.variables?.[0]?.name ?? "";
    const patched = ok(patchDesign(df, [{ op: "updateVariable", name, defaultValue: "NEU" }]));
    const zpl = ok(exportZpl(patched.designFile)).zpl;
    expect(zpl).toContain("^FDNEU");
    expect(zpl).not.toContain("^FDALT");
  });

  it("carries the label-level command that lives outside the objects", () => {
    const df = imported();
    const name = df.variables?.[0]?.name ?? "";
    const patched = ok(patchDesign(df, [{ op: "updateVariable", name, defaultValue: "NEU" }]));
    expect(ok(exportZpl(patched.designFile)).zpl).toContain("^MD9");
  });
});

describe("objects inside a group", () => {
  const grouped = () =>
    JSON.parse(
      serializeDesign({ widthMm: 60, heightMm: 40, dpmm: 8 }, [
        {
          objects: [
            {
              id: "g1", type: "group", x: 0, y: 0, rotation: 0,
              children: [textObject("text-1", "in der Gruppe")],
            } as never,
          ],
        },
      ]),
    ) as Record<string, unknown>;

  it("can be patched by the id the bounds report names", () => {
    const before = ok(validateDraft(grouped()));
    expect(before.bounds.map((b) => b.objectId)).toContain("text-1");
    const patched = ok(patchDesign(grouped(), [{ op: "update", id: "text-1", x: 50 }]));
    expect(patched.bounds.find((b) => b.objectId === "text-1")?.x).toBe(50);
  });

  it("can be removed from inside its group", () => {
    const patched = ok(patchDesign(grouped(), [{ op: "remove", id: "text-1" }]));
    expect(patched.bounds).toEqual([]);
  });

  it("never gets an auto id that a nested object already holds", () => {
    const patched = ok(
      patchDesign(grouped(), [
        { op: "add", object: { type: "text", x: 1, y: 1, props: { content: "neu" } } },
      ]),
    );
    const ids = patched.bounds.map((b) => b.objectId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("a graphic header without its format letter", () => {
  it("is refused at the tool boundary, where the emitter would drop it", () => {
    const r = createDraft({
      widthMm: 50, heightMm: 30, dpmm: 8,
      objects: [{ type: "image", x: 10, y: 10, props: { imageId: "", widthDots: 8, _gfaCache: "^GF,4,4,2,FF00FF00" } }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("format letter");
  });
});

describe("a whole field bound to one variable", () => {
  it("is not condemned for lacking an (AI) structure", () => {
    const r = ok(
      createDraft({
        widthMm: 70, heightMm: 40, dpmm: 8,
        variables: [{ name: "GS1", defaultValue: "(01)04150123456782" }],
        objects: [{ type: "code128", id: "b", x: 10, y: 10, props: { content: "«GS1»", gs1: true, height: 60 } }],
      }),
    );
    expect(r.warnings.map((w) => w.kind)).not.toContain("gs1ValueInvalid");
  });
});

describe("a rename to a name the grammar cannot express", () => {
  it("is refused, like creating one would be", () => {
    const base = ok(
      createDraft({
        widthMm: 60, heightMm: 40, dpmm: 8,
        objects: [{ type: "text", id: "t", x: 1, y: 1, props: { content: "«batch»" } }],
        variables: [{ name: "batch", defaultValue: "A" }],
      }),
    );
    for (const newName of ["clock:Y", "a»b"]) {
      const r = patchDesign(base.designFile, [{ op: "updateVariable", name: "batch", newName }]);
      expect(r.ok, newName).toBe(false);
    }
  });
});

describe("props that reach the printed stream as written", () => {
  const draftWithProps = (props: Record<string, unknown>) =>
    createDraft({
      widthMm: 60,
      heightMm: 40,
      dpmm: 8,
      objects: [{ type: "image", id: "g", x: 10, y: 10, props: { imageId: "", widthDots: 8, ...props } }],
    });

  it("refuses a graphic that is not a string, whatever it stringifies to", () => {
    const r = draftWithProps({ _gfaCache: ["^GFA,4,4,2,FF00", "^XZ^XA^JUF"] });
    expect(r.ok).toBe(false);
  });

  it("holds rawGf to the same rule: it is emitted before any other branch", () => {
    const r = draftWithProps({ rawGf: "^GFA,8,8,1,00^FS^XZ^XA~JB" });
    expect(r.ok).toBe(false);
    const clean = ok(draftWithProps({ rawGf: "^GFA,8,8,1,0011223344556677" }));
    // A validated graphic prop is known, so it draws no typo note either.
    expect(clean.notes ?? []).not.toContain("g: rawGf is not a known image prop (see get_schema)");
  });

  it("refuses a control prefix in a prop the defaults do not type", () => {
    // blockWidth carries no default, so nothing typed it; it lands in ^FB's
    // parameter list, where ^ starts a command.
    const r = createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "text", x: 10, y: 10, props: { content: "x", blockWidth: "1,1,0,L,0^FS^XZ^XA~JB" } }],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts the compression alphabet and :B64: an import round-trips", () => {
    // preserveGfData keeps these verbatim, so a hex-only class would refuse a
    // graphic this repo itself produced.
    for (const payload of ["M60", ":B64:iVBORw0KGgo=:1a2b"]) {
      expect(draftWithProps({ rawGf: `^GFA,4,4,4,${payload}` }).ok, payload).toBe(true);
    }
  });

  it("judges a prop named after an Object builtin by the defaults, not the prototype", () => {
    const r = createDraft({
      widthMm: 60,
      heightMm: 40,
      dpmm: 8,
      objects: [{ type: "text", x: 10, y: 10, props: { content: "x", toString: 1 } }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("an update aimed at a group", () => {
  it("is refused rather than accepted and discarded", () => {
    const base = ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        objects: [{ type: "text", id: "t", x: 1, y: 1, props: { content: "a" } }],
      }),
    );
    const withGroup = JSON.parse(JSON.stringify(base.designFile)) as {
      pages: { objects: unknown[] }[];
    };
    const leaf = withGroup.pages[0]?.objects[0];
    withGroup.pages[0]!.objects = [
      { id: "g1", type: "group", x: 0, y: 0, rotation: 0, children: [leaf] },
    ];
    const r = patchDesign(withGroup, [{ op: "update", id: "g1", x: 500, props: { nonsense: 7 } }]);
    expect(r.ok).toBe(false);
  });
});

describe("export_zpl", () => {
  it("carries the notes the draft tools give, dataset caveat included", () => {
    const base = ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        objects: [{ type: "text", id: "t", x: 1, y: 1, props: { content: "hi" } }],
        variables: [{ name: "unused", defaultValue: "A" }],
      }),
    );
    const exported = ok(exportZpl(base.designFile));
    expect(exported.notes ?? []).toContain("variable unused is never referenced by any content");
  });
});

describe("a marker shaped like a clock token", () => {
  it("is called out when the firmware has no such token", () => {
    const r = ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        objects: [{ type: "text", id: "t", x: 1, y: 1, props: { content: "«clock:Q»" } }],
      }),
    );
    expect(r.notes ?? []).toContain("t: «clock:Q» is not a clock token and prints as text");
  });
});

describe("a barcode whose marker resolves to nothing", () => {
  it("reports emptyContent, as the editor does for the same design", () => {
    const r = ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        variables: [{ name: "lot", defaultValue: "" }],
        objects: [{ type: "code128", id: "b", x: 10, y: 10, props: { content: "«lot»", height: 60 } }],
      }),
    );
    expect(r.warnings.map((w) => w.kind)).toContain("emptyContent");
  });
});

describe("the geometry report", () => {
  it("marks an overlap approximate when its own box is an estimate", () => {
    const r = ok(
      createDraft({
        widthMm: 60,
        heightMm: 40,
        dpmm: 8,
        variables: [{ name: "v", defaultValue: "WIDE VALUE" }],
        objects: [
          { type: "text", id: "t", x: 20, y: 20, props: { content: "«v»", fontHeight: 30 } },
          { type: "box", id: "b", x: 20, y: 20, props: { width: 200, height: 40 } },
        ],
      }),
    );
    const box = r.bounds.find((b) => b.objectId === "t");
    const hit = r.overlaps.find((o) => o.a === "t" || o.b === "t");
    expect(box?.approx).toBe(true);
    expect(hit?.approx).toBe(box?.approx);
  });

  it("does not let suppressed frame pairs crowd real collisions out of the cap", () => {
    const objects: { type: string; id: string; x: number; y: number; props: Record<string, unknown> }[] = [
      { type: "box", id: "frame", x: 0, y: 0, props: { width: 780, height: 380, thickness: 2 } },
    ];
    // Every text overlaps every other, and the frame encloses them all: 33
    // stacked fields make 528 real pairs against a 500 cap.
    for (let i = 0; i < 33; i++) {
      objects.push({ type: "text", id: `t${i}`, x: 100, y: 100, props: { content: "x", fontHeight: 20 } });
    }
    const r = ok(createDraft({ widthMm: 100, heightMm: 50, dpmm: 8, objects }));
    expect(r.overlaps.some((o) => o.a === "frame" || o.b === "frame")).toBe(false);
    expect(r.geometryTruncated).toBe(true);
  });
});

describe("a design file handed straight to the emitting tools", () => {
  it("is prop-checked there too, not only where objects are built", () => {
    const base = ok(
      createDraft({
        widthMm: 60, heightMm: 40, dpmm: 8,
        objects: [{ type: "text", id: "t", x: 10, y: 10, props: { content: "x" } }],
      }),
    );
    const poisoned = JSON.parse(JSON.stringify(base.designFile)) as {
      pages: { objects: { props: Record<string, unknown> }[] }[];
    };
    poisoned.pages[0]!.objects[0]!.props.blockWidth = "1,1,0,L,0^FS^XZ^XA~JB";
    expect(exportZpl(poisoned).ok).toBe(false);
    expect(validateDraft(poisoned).ok).toBe(false);
  });
});

describe("an imported binary ^GF graphic", () => {
  // The parser preserves ^GFB/^GFC verbatim (B64-wrapped when well-formed);
  // a boundary stricter than the importer breaks the roundtrip.
  it("survives export and validation instead of failing the envelope", () => {
    const zpl = "^XA^FO10,10^GFB,4,4,2,:B64:AAAA:9c02^FS^XZ";
    const imported = ok(importZpl(zpl, 8));
    const exported = ok(exportZpl(imported.designFile));
    expect(exported.zpl).toContain("^GFB,4,4,2,:B64:AAAA:9c02");
    expect(validateDraft(imported.designFile).ok).toBe(true);
  });

  it("keeps the roundtrip for an under-read raw payload too", () => {
    // preserveGfData keeps this verbatim (length !== count); the boundary's
    // exact-fit rule then failed every design-shaped tool on the import.
    const imported = ok(importZpl("^XA^FO10,10^GFB,20,20,2,ABCD^FS^XZ", 8));
    expect(validateDraft(imported.designFile).ok).toBe(true);
    expect(exportZpl(imported.designFile).ok).toBe(true);
  });
});

describe("a control prefix inside an object-valued prop", () => {
  it("is refused like a top-level one", () => {
    const r = createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{
        type: "image", x: 10, y: 10,
        props: { imageId: "", widthDots: 8, storedAs: { device: "R", name: "L^XZ^XA~JB" } },
      }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("re-asserting a variable's existing default", () => {
  it("keeps the pages' captured import bytes", () => {
    const imported = ok(importZpl("^XA^FWR^FN1^FDA^FS^FO10,10^A0N,20,20^FE#^FD#1#^FS^XZ", 8));
    const patched = ok(patchDesign(imported.designFile, [
      { op: "updateVariable", name: "field_1", defaultValue: "A" },
    ]));
    // ^FWR is unmodelled and survives only through the overlay.
    expect(ok(exportZpl(patched.designFile)).zpl).toContain("^FWR");
  });
});

describe("a comma-less ^GF header", () => {
  it("is not accepted as a graphic the firmware would drop", () => {
    const r = createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "image", x: 10, y: 10, props: { imageId: "", widthDots: 8, _gfaCache: "^GFA,4,4,2FF00" } }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("a null prop value", () => {
  it("is refused instead of printing the string null", () => {
    const base = ok(
      createDraft({
        widthMm: 60, heightMm: 40, dpmm: 8,
        objects: [{ type: "text", id: "t", x: 10, y: 10, props: { content: "x" } }],
      }),
    );
    const r = patchDesign(base.designFile, [
      { op: "update", id: "t", props: { fontHeight: null } },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe("a raw-binary ^GFB payload carrying ^ inside its declared count", () => {
  const withRaw = (rawGf: string) =>
    createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "image", x: 10, y: 10, props: { imageId: "", widthDots: 8, rawGf } }],
    });

  it("round-trips: bytes within the count are data, only the excess is commands", () => {
    expect(withRaw("^GFB,4,4,2,A^B~").ok).toBe(true);
    expect(withRaw("^GFB,4,4,2,AAAA^XZ^XA~JB").ok).toBe(false);
  });
});

describe("a ^GFB header whose declared count does not match the payload bytes", () => {
  const withRaw = (rawGf: string) =>
    createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "image", x: 10, y: 10, props: { imageId: "", widthDots: 8, rawGf } }],
    });
  it("takes an under-read payload, the shape the parser preserves verbatim", () => {
    // The firmware eats following bytes as data here; nothing rides out as a
    // command, and the importer round-trips exactly this stream.
    expect(withRaw("^GFB,9999,9999,10,AB^FS^XZ^XA~JB").ok).toBe(true);
  });
  it("cuts a non-latin1 payload at the wire byte, not the string index", () => {
    // 7 euro signs are 21 UTF-8 bytes (the generator emits ^CI28), so a count of
    // 20 ends INSIDE them and ^XA~JB lands in the overhang, where the firmware
    // would execute it. A JS-string slice put the cut at char 20 and missed it.
    expect(withRaw("^GFB,20,20,10," + "\u20ac".repeat(7) + "^XA~JB").ok).toBe(false);
    // The same payload with a count that covers it stays shippable.
    expect(withRaw("^GFB,21,21,10," + "\u20ac".repeat(7)).ok).toBe(true);
  });
  it("refuses a non-latin1 payload whose count leaves the command in the overhang", () => {
    expect(withRaw("^GFB,3,3,10," + "\u20ac".repeat(3) + "^XA~JB").ok).toBe(false);
  });
  it("refuses an empty graphic-count slot, which prints nothing at all", () => {
    // Labelary: b may be omitted (renders identically), c may not. Without it
    // the firmware never learns where the graphic ends and eats the stream.
    expect(withRaw("^GFB,,,2,ABCD").ok).toBe(false);
    expect(withRaw("^GFB,,4,2,ABCD").ok).toBe(true);
  });
  it("uses the format-byte count (c) as the boundary when total (b) is omitted", () => {
    // b omitted, c=4: the ^/~ sit inside the 4-byte graphic, not past it.
    expect(withRaw("^GFB,,4,2,A^B~").ok).toBe(true);
    expect(withRaw("^GFB,,4,2,A^B~^XZ").ok).toBe(false);
  });
  it("refuses a count-less binary payload carrying control bytes", () => {
    // Nothing declares where the data ends, so a ^/~ cannot be told from an
    // appended command, and both raw-graphic props reach the wire verbatim.
    expect(withRaw("^GFB,,,2,AB^C").ok).toBe(false);
    // Reported by the tool that would have shipped it, not silently emitted.
    expect(withRaw("^GFB,,,1,^XZ^XA^JUS^XZ").ok).toBe(false);
  });

  it("takes an exact-fit ASCII payload", () => {
    expect(withRaw("^GFB,4,4,2,A^B~").ok).toBe(true);
  });
});

describe("add and create_draft run the registry normalize hook", () => {
  it("clamps a code49 height the same way an update would", () => {
    const added = createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "code49", id: "c", x: 10, y: 10, props: { content: "AB", moduleWidth: 2, height: 200 } }],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const leaf = (added.designFile as { pages: { objects: { props: { height: number } }[] }[] })
      .pages[0]!.objects[0]!;
    expect(leaf.props.height).toBeLessThanOrEqual(100);
  });
});

describe("a locked object", () => {
  const withLocked = (objects: unknown[]) => ({
    schemaVersion: 3,
    label: { widthMm: 100, heightMm: 50, dpmm: 8 },
    pages: [{ objects }],
  });

  it("refuses update and remove instead of editing what the editor blocks", () => {
    const design = withLocked([{ ...textObject("t1", "KEEP"), locked: true }]);
    expect(patchDesign(design, [{ op: "update", id: "t1", x: 99 }]).ok).toBe(false);
    expect(patchDesign(design, [{ op: "remove", id: "t1" }]).ok).toBe(false);
  });

  it("cascades from a locked ancestor group, like the editor's lock gate", () => {
    const design = withLocked([
      {
        id: "g1", type: "group", x: 0, y: 0, rotation: 0, locked: true,
        children: [textObject("t1", "KEEP")],
      },
    ]);
    expect(patchDesign(design, [{ op: "update", id: "t1", x: 99 }]).ok).toBe(false);
  });
});

describe("duplicate ids across pages", () => {
  it("are rejected: patch_design could only ever reach the first copy", () => {
    const design = {
      schemaVersion: 3,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [textObject("t1", "A")] }, { objects: [textObject("t1", "B")] }],
    };
    const r = validateDraft(design);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("t1");
  });
});

describe("a caret parked in a non-emitting serial prop", () => {
  it("passes the boundary: the text never reaches a parameter slot", () => {
    // serialEnablePatch snapshots the raw content into preSerialContent; a
    // user's "REF^1" then failed every design-shaped tool.
    const design = {
      schemaVersion: 3,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{
        objects: [{
          ...textObject("t1", "REF1"),
          props: {
            content: "REF1", fontHeight: 30, fontWidth: 0, rotation: "N",
            serial: { increment: 1, zplMode: "SN" },
            preSerialContent: "REF^1",
          },
        }],
      }],
    };
    expect(validateDraft(design).ok).toBe(true);
    expect(exportZpl(design).ok).toBe(true);
  });
});

describe("a graphic header past the shared bytes-per-row cap", () => {
  it("is refused from a caller, whose input this is", () => {
    const r = createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "image", id: "img", x: 10, y: 10, props: { imageId: "", widthDots: 8, _gfaCache: "^GFA,1200,1200,1200,FF" } }],
    });
    expect(r.ok).toBe(false);
  });

  it("leaves a stored design readable, and emit drops the runaway header", () => {
    // Read-back must not fail over one object; the cap is emit's to apply, and
    // it applies it everywhere now (bounds, ship guard and the preview decoder).
    const design = {
      schemaVersion: 3,
      label: { widthMm: 60, heightMm: 40, dpmm: 8 },
      pages: [{ objects: [{ id: "img", type: "image", x: 10, y: 10, rotation: 0,
        props: { imageId: "", widthDots: 8, threshold: 128, rotation: "N", _gfaCache: "^GFA,1200,1200,1200,FF" } }] }],
    };
    expect(ok(validateDraft(design)).warnings.some((w) => w.kind === "imageMissing")).toBe(true);
    expect(ok(exportZpl(design)).zpl).not.toContain("^GFA,1200");
  });
});

describe("the patch operations array", () => {
  it("is capped by the input schema", () => {
    const schema = z.object(patchDesignShape);
    const op = { op: "remove", id: "x" };
    expect(schema.safeParse({ designFile: {}, operations: Array(1000).fill(op) }).success).toBe(true);
    expect(schema.safeParse({ designFile: {}, operations: Array(1001).fill(op) }).success).toBe(false);
  });
});

describe("the byte-fixed edit note", () => {
  it("covers rawGf graphics like it covers a source-less cache", () => {
    const created = ok(createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "image", id: "img", x: 10, y: 10, props: { imageId: "", widthDots: 8, rawGf: "^GFB,4,4,2,A^B~" } }],
    }));
    const patched = ok(patchDesign(created.designFile, [
      { op: "update", id: "img", props: { widthDots: 400 } },
    ]));
    expect(patched.notes?.some((n) => n.includes("stored bytes"))).toBe(true);
  });
});

describe("a design carrying graphic bytes the printer would misread", () => {
  const design = (includeInExport: boolean) => ({
    schemaVersion: 3,
    label: { widthMm: 100, heightMm: 50, dpmm: 8 },
    pages: [{
      objects: [{
        id: "img", type: "image", x: 0, y: 0, rotation: 0, includeInExport,
        props: { imageId: "", widthDots: 8, threshold: 128, rotation: "N", _gfaCache: "^GFA,4,4,2,FF00^XA^JUS^XZ" },
      }],
    }],
  });

  it("stays readable, and emit drops the bytes instead of shipping them", () => {
    // Reading a design back must not fail wholesale over one object (that broke
    // get_current_design on the user's own design); the emitter is what refuses.
    const report = ok(validateDraft(design(true)));
    expect(report.warnings.some((w) => w.kind === "imageMissing")).toBe(true);
    expect(ok(exportZpl(design(true))).zpl).not.toContain("^JUS");
  });

  it("refuses the same payload when a caller supplies it", () => {
    // create_draft input is the caller's to fix, so it fails the call instead.
    const r = createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "image", x: 0, y: 0, props: { imageId: "", widthDots: 8, _gfaCache: "^GFA,4,4,2,FF00^XA^JUS^XZ" } }],
    });
    expect(r.ok).toBe(false);
  });

  it("drops the bytes on an export-off object too, once it is toggled on", () => {
    // includeInExport:false renders on canvas but is missing from output; one
    // toggle must not put the unbounded payload into the stream.
    expect(ok(exportZpl(design(false))).zpl).not.toContain("^JUS");
  });
});

describe("a payload-less ^GF header", () => {
  it("is refused from a caller: it declares bytes it never sends", () => {
    // The firmware would read the following ^FS/^XZ as the 8 declared bytes and
    // the block would never terminate, so this is unsafe for either prop.
    const r = createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "image", id: "img", x: 10, y: 10, props: { imageId: "", widthDots: 8, _gfaCache: "^GFA,8,8,1" } }],
    });
    expect(r.ok).toBe(false);
  });

  it("is dropped, not shipped, when a stored design carries one", () => {
    const design = {
      schemaVersion: 3,
      label: { widthMm: 60, heightMm: 40, dpmm: 8 },
      pages: [{ objects: [{ id: "img", type: "image", x: 10, y: 10, rotation: 0,
        props: { imageId: "", widthDots: 8, threshold: 128, rotation: "N", _gfaCache: "^GFA,8,8,1" } }] }],
    };
    const report = ok(validateDraft(design));
    expect(report.warnings.some((w) => w.kind === "imageMissing")).toBe(true);
    expect(ok(exportZpl(design)).zpl).not.toContain("^GFA,8,8,1");
  });
});

describe("a variable edit that does not change emitted bytes", () => {
  const imported = () => ok(importZpl("^XA^MD10^FO10,10^A0N,20,20^FE#^FD#1#^FS^XZ", 8));

  it("keeps the page overlay on a comment-only edit", () => {
    const patched = ok(patchDesign(imported().designFile, [
      { op: "updateVariable", name: "field_1", comment: "lot number" },
    ]));
    // ^MD10 is unmodelled and survives only through the overlay.
    expect(ok(exportZpl(patched.designFile)).zpl).toContain("^MD10");
  });

  it("keeps the page overlay on a rename-only edit", () => {
    const patched = ok(patchDesign(imported().designFile, [
      { op: "updateVariable", name: "field_1", newName: "lot" },
    ]));
    expect(ok(exportZpl(patched.designFile)).zpl).toContain("^MD10");
  });
});

describe("a ^GF header carrying no data", () => {
  it("is refused, not emitted as a header declaring bytes it never sends", () => {
    // rawGf ships verbatim, so `^GFB,8,8,1,` would make the firmware eat the
    // following ^FS/^XZ as graphic data (spec p.215).
    const r = createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "image", x: 10, y: 10, props: { imageId: "", widthDots: 8, rawGf: "^GFB,8,8,1," } }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("a graphic whose header outgrows the render cap", () => {
  it("still round-trips through the envelope tools", () => {
    // Emit/bounds refuse the oversized header on their own (imageMissing), so
    // the boundary must not fail the whole design our own importer produced.
    const imported = ok(importZpl("^XA^FO10,10^GFA,4096,4096,2048,FFFFFFFFFFFFFFFF^FS^XZ", 8));
    expect(validateDraft(imported.designFile).ok).toBe(true);
    expect(exportZpl(imported.designFile).ok).toBe(true);
  });
});

describe("an update on a block that cannot replay around it", () => {
  it("says the imported commands are lost instead of reporting a clean patch", () => {
    // ^ZZ carries running state before the field, so the overlay is not
    // regenSafe: export regenerates the whole block and ^ZZ99,7 goes with it.
    const imported = ok(importZpl("^XA^ZZ99,7^CI13^FO10,10^A0N,20,20^FDx^FS^XZ", 8));
    const id = imported.bounds[0]!.objectId;
    const patched = ok(patchDesign(imported.designFile, [{ op: "update", id, x: 11 }]));
    expect(ok(exportZpl(patched.designFile)).zpl).not.toContain("^ZZ99,7");
    expect(patched.notes?.some((n) => n.includes("cannot be replayed"))).toBe(true);
  });

  it("stays quiet when the block can replay around the edit", () => {
    const imported = ok(importZpl("^XA^MD10^FO10,10^A0N,20,20^FDx^FS^XZ", 8));
    const id = imported.bounds[0]!.objectId;
    const patched = ok(patchDesign(imported.designFile, [{ op: "update", id, x: 11 }]));
    expect(ok(exportZpl(patched.designFile)).zpl).toContain("^MD10");
    expect(patched.notes?.some((n) => n.includes("cannot be replayed")) ?? false).toBe(false);
  });
});

describe("a structural patch on a page that carries captured import bytes", () => {
  // Structural edits DROP the capture (an added object is not in the bytes, a
  // removed one still is); the roundtrip rule only demands the drop be loud.
  // captureLost used to read the post-drop pages, where the overlay this note
  // is about was already gone, so no structural drop ever produced a note.
  const source = "^XA^FWR^ZZ99,7^LT30^FO10,10^A0N,20,20^FDx^FS^XZ";

  it("says the capture is lost on an addVariable", () => {
    const imported = ok(importZpl(source, 8));
    const patched = ok(patchDesign(imported.designFile, [
      { op: "addVariable", variable: { name: "sku", defaultValue: "S" } },
    ]));
    expect(patched.notes?.some((n) => n.includes("cannot be replayed"))).toBe(true);
    expect(ok(exportZpl(patched.designFile)).zpl).not.toContain("^ZZ99,7");
  });

  it("says the capture is lost on a remove", () => {
    const imported = ok(importZpl(source, 8));
    const id = imported.bounds[0]!.objectId;
    const patched = ok(patchDesign(imported.designFile, [{ op: "remove", id }]));
    expect(patched.notes?.some((n) => n.includes("cannot be replayed"))).toBe(true);
  });
});

describe("a right-justified non-1D field in the report", () => {
  it("is named, because its x is not the bounds x an agent would patch", () => {
    const created = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{
        type: "text", id: "t", x: 776, y: 20, fieldJustify: "R",
        props: { content: "ROESTEREI SEIT 1998", fontHeight: 20 },
      }],
    }));
    const bounds = created.bounds.find((b) => b.objectId === "t");
    // The reported ink box starts a full width left of the model x.
    expect(bounds!.x).toBeLessThan(776);
    expect(created.notes?.some((n) => n.includes("printed RIGHT edge"))).toBe(true);
  });

  it("stays quiet for a left-justified design", () => {
    const created = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "text", id: "t", x: 20, y: 20, props: { content: "PLAIN", fontHeight: 20 } }],
    }));
    expect(created.notes?.some((n) => n.includes("printed RIGHT edge")) ?? false).toBe(false);
  });
});

describe("a frame with rounded corners", () => {
  const design = (innerX: number, innerY: number, rounding: number) => ({
    schemaVersion: 3,
    label: { widthMm: 100, heightMm: 50, dpmm: 8 },
    pages: [{ objects: [
      { id: "frame", type: "box", x: 0, y: 0, rotation: 0,
        props: { width: 200, height: 100, thickness: 3, filled: false, color: "B", rounding } },
      { id: "in", type: "box", x: innerX, y: innerY, rotation: 0,
        props: { width: 20, height: 10, thickness: 1, filled: true, color: "B", rounding: 0 } },
    ] }],
  });

  it("reports an object straddling the corner arc", () => {
    // Clears every straight edge but crosses the inner arc (radius 47 at r=8).
    expect(ok(validateDraft(design(10, 10, 8))).overlaps.length).toBe(1);
  });

  it("treats a box inside the printer's inner arc as noise, not the doubled canvas radius", () => {
    // Inner arc 45: the box at (30,30) clears it; the old doubled radius (90) flagged it.
    const d = {
      schemaVersion: 5,
      label: { widthMm: 50, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [
        { id: "frame", type: "box", x: 0, y: 0, rotation: 0,
          props: { width: 200, height: 200, thickness: 10, filled: false, color: "B", rounding: 4 } },
        { id: "in", type: "box", x: 30, y: 30, rotation: 0,
          props: { width: 140, height: 140, thickness: 1, filled: true, color: "B", rounding: 0 } },
      ] }],
    };
    expect(ok(validateDraft(d)).overlaps).toEqual([]);
  });

  it("still treats a square frame's contents as noise", () => {
    expect(ok(validateDraft(design(10, 10, 0))).overlaps).toEqual([]);
  });

  it("still treats the rounded frame's straight-edge interior as noise", () => {
    expect(ok(validateDraft(design(90, 45, 8))).overlaps).toEqual([]);
  });
});

describe("a recall image that also carries its bytes", () => {
  it("reports the header box the generator anchors off, not the props box", () => {
    // ^XG prints the stored graphic at its header size (400x10 here), so bounds
    // and the off-label check must size by the header like imageEmitDims does.
    const created = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{
        type: "image", id: "img", x: 100, y: 100,
        positionType: "FT", fieldJustify: "R",
        props: {
          imageId: "", widthDots: 200, heightDots: 200,
          storedAs: { device: "R", name: "LOGO" },
          _gfaCache: "^GFA,500,500,50," + "F".repeat(20),
        },
      }],
    }));
    const b = created.bounds.find((o) => o.objectId === "img")!;
    expect(b.width).toBe(400);
    expect(b.height).toBe(10);
  });
});

describe("the boundary between caller input and a design read back", () => {
  // The recurring defect on this branch: one check served two duties, so every
  // round it was either too strict (the importer's own graphics failed every
  // design-shaped tool) or too lax (payload bytes reached the wire unbounded).
  const shapes = [
    "^GFB,,,2,ABCD",            // no byte count at all
    "^GFB,9999,9999,10,AB",     // under-read, count over-declared
    "^GFB,20,20,10," + "€".repeat(7), // non-latin1 bytes
    "^GFA,4096,4096,2048,FFFF", // past the render cap
  ];

  it("reads every graphic the importer preserves back without failing", () => {
    for (const rawGf of shapes) {
      const design = {
        schemaVersion: 3,
        label: { widthMm: 100, heightMm: 50, dpmm: 8 },
        pages: [{ objects: [{ id: "g", type: "image", x: 0, y: 0, rotation: 0,
          props: { imageId: "", widthDots: 8, threshold: 128, rotation: "N", rawGf } }] }],
      };
      expect(validateDraft(design).ok, rawGf).toBe(true);
      expect(exportZpl(design).ok, rawGf).toBe(true);
    }
  });

  it("still refuses each of them from a caller, where the input can be fixed", () => {
    // Same bytes, opposite verdict: create_draft is the caller's to correct.
    const r = createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "image", x: 0, y: 0, props: { imageId: "", widthDots: 8, rawGf: "^GFB,,,2,AB^C" } }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("the ^GF header's own value ranges", () => {
  const withRaw = (rawGf: string) =>
    createDraft({
      widthMm: 60, heightMm: 40, dpmm: 8,
      objects: [{ type: "image", x: 10, y: 10, props: { imageId: "", widthDots: 8, rawGf } }],
    });

  // The p.215 range (1-99999) is documentation, not a wire limit: our own
  // encoder emits b/c past it, so gating on it emptied every full-size graphic.
  it("takes a count no payload could satisfy, which breaks the label, not the wire", () => {
    expect(withRaw("^GFB,99999999999999999999,8,1,AB^XZ").ok).toBe(true);
    expect(withRaw("^GFA,,4000000,1,FFFF").ok).toBe(true);
  });

  it("refuses a header it cannot read rather than guessing at the data", () => {
    // p.215 bounds binary data by the declared count; with no readable header
    // there is no count, so nothing separates data from an appended command.
    expect(withRaw("^XZ").ok).toBe(false);
    expect(withRaw("~JB").ok).toBe(false);
    expect(withRaw("hello world").ok).toBe(false);
  });

  it("still takes the shapes the importer preserves", () => {
    expect(withRaw("^GFB,4,4,2,A^B~").ok).toBe(true);
    // b omitted is one of them; c omitted is not (it prints nothing).
    expect(withRaw("^GFB,,4,2,ABCD").ok).toBe(true);
  });
});

describe("props the parser itself writes", () => {
  it("are not reported back to the agent as typos", () => {
    // These carry no registry default and no hand-written summary, but every one
    // is emitted (^FB indent, ^FP, ^A@ font path, ^SN, ~DY+^XG); flushField writes
    // them on import, so calling them unknown told an agent the parser's own output goes nowhere.
    const created = ok(importZpl("^XA^FO10,10^A0N,20,20^FB200,2,0,C,10^FDx^FS^XZ", 8));
    const patched = ok(patchDesign(created.designFile, [
      { op: "update", id: created.bounds[0]!.objectId, props: { blockHangingIndent: 5, textMode: "fb" } },
    ]));
    expect(patched.notes?.some((n) => n.includes("not a known"))).toBeFalsy();
  });
});

describe("a variable name with surrounding space", () => {
  it("is stored trimmed, so the name it hands back is addressable", () => {
    // parseDesignFile and the editor both trim; keeping the caller's spacing
    // returned a name every later call then failed to find.
    const created = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      variables: [{ name: " LOT ", defaultValue: "A" }],
      objects: [{ type: "text", id: "t", x: 10, y: 10, props: { content: "«LOT»" } }],
    }));
    expect(created.designFile.variables?.[0]?.name).toBe("LOT");
    expect(patchDesign(created.designFile, [
      { op: "updateVariable", name: "LOT", defaultValue: "B" },
    ]).ok).toBe(true);
  });
});
