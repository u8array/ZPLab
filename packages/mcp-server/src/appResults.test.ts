import { describe, it, expect } from "vitest";
import { z } from "zod";
import { wireBounds } from "@zplab/core/types/propSpec";
import { IMAGE_PROP_SPECS } from "@zplab/core/registry/image";
import { createDraft, exportZpl, importZpl, validateDraft } from "@zplab/headless";
import { buildCurrentDesignResult, rasterImageResult, rasterImageShape } from "./appResults.js";

/** Assert a tool succeeded and narrow away the ToolError branch. */
function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
}

describe("rasterImageResult", () => {
  it("takes a raster threshold only where the image contract will accept it back", () => {
    const shape = z.object(rasterImageShape);
    const { min, max } = wireBounds(IMAGE_PROP_SPECS.threshold);
    expect(shape.safeParse({ dataUrl: "data:,", widthDots: 8, threshold: min - 1 }).success).toBe(false);
    expect(shape.safeParse({ dataUrl: "data:,", widthDots: 8, threshold: max + 1 }).success).toBe(false);
    for (const threshold of [min, max]) {
      expect(shape.safeParse({ dataUrl: "data:,", widthDots: 8, threshold }).success).toBe(true);
      const r = createDraft({ widthMm: 50, heightMm: 30, dpmm: 8, objects: [{ type: "image", x: 1, y: 1, props: { imageId: "", widthDots: 8, threshold, rotation: "N" } }] });
      expect(r.ok, String(threshold)).toBe(true);
    }
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

  it("reports the threshold the raster actually used", () => {
    const shaped = rasterImageResult(
      { id: 1, ok: true, gfa: "^GFA,8,8,1,00FF00FF00FF00FF", widthDots: 8, heightDots: 8 },
      80,
    );
    expect(shaped.ok && (shaped.object.props as { threshold: number }).threshold).toBe(80);
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

describe("buildCurrentDesignResult measures what prints", () => {
  it("get_current_design resolves markers before measuring the anchor", () => {
    // Default (15 chars) is wider than the code128 sample fallback (8 chars):
    // resolved anchor = 100 (on-label), unresolved would be negative (outside).
    const r = importZpl("^XA^PW800^FT100,150,1^BCN,100,Y,N,N^FN1^FD123456789012345^FS^XZ", 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.designFile.label as { emit1dZJustify?: boolean }).emit1dZJustify).toBe(true);
    const out = buildCurrentDesignResult({ designFile: r.designFile } as never);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings.filter((w) => w.kind.startsWith("offLabel"))).toEqual([]);
  });

  it("reports the print-true barcode box even when the app measured its zoom view", () => {
    // Same zoom/kernel shadowing as the case above; here mw 2 and mw 3 both
    // collapse to 1 screen pixel at zoom 1.
    const r = importZpl("^XA^PW800^FO10,10^BCN,100,Y,N,N^FD12345678901234567890^FS^XZ", 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = (r.designFile.pages as { objects: { id: string }[] }[])[0]!.objects[0]!.id;
    const headless = validateDraft(r.designFile);
    expect(headless.ok).toBe(true);
    if (!headless.ok) return;
    const truth = headless.bounds.find((b) => b.objectId === id)!;
    const out = buildCurrentDesignResult({
      designFile: r.designFile,
      measured: { [id]: { width: 539, height: 100 } },
    } as never);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const reported = out.bounds.find((b) => b.objectId === id)!;
    expect(reported.width).toBe(truth.width);
    expect(reported.width).not.toBe(539);
  });
});
