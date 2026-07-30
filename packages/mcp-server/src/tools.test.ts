import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildCurrentDesignResult, createDraft, createDraftShape, validateDraft, exportZpl, getSchema, importZpl, validateZpl } from "./tools";
import { ObjectRegistry } from "@zplab/core/registry";
import { textObject } from "./testFixtures";

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
      for (const key of Object.keys(t.props)) {
        expect(allowed.has(key), `${t.type}.${key} is not a known prop`).toBe(true);
      }
    }
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

  it("create_draft reports per-object bounds, approx only for the barcode", () => {
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
    expect(created.bounds.find((b) => b.objectId === "c")?.approx).toBe(true);
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

  it("counts the size cap in bytes, not UTF-16 code units", () => {
    // ~200k '€' = 200k code units but ~600k UTF-8 bytes, over the 256 KB cap.
    const multibyte = "^XA^FO10,10^FD" + "€".repeat(200_000) + "^FS^XZ";
    expect(multibyte.length).toBeLessThan(256 * 1024);
    const v = validateZpl(multibyte);
    expect(v.ok).toBe(false);
  });

  it("counts group children against the object cap (no smuggling via subtree)", () => {
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

  it("upgrades a measured barcode to render-exact bounds", () => {
    const result = ok(buildCurrentDesignResult({
      id: 1,
      designFile: design,
      measured: { bc1: { width: 321, height: 118 } },
    }));
    const b = result.bounds.find((x) => x.objectId === "bc1");
    expect(b?.width).toBe(321);
    expect(b?.height).toBe(118);
    expect(b?.approx).toBe(false);
  });

  it("keeps an unmeasured barcode approx", () => {
    const result = ok(buildCurrentDesignResult({ id: 2, designFile: design }));
    expect(result.bounds.find((x) => x.objectId === "bc1")?.approx).toBe(true);
  });

  it("maps a malformed design to the ToolError shape", () => {
    expect(buildCurrentDesignResult({ id: 3, designFile: { schemaVersion: 3 } }).ok).toBe(false);
  });
});
