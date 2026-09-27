import { describe, expect, it } from "vitest";
import { generateBatchZpl, generateMultiPageZPL, generateStoredFormatBlock, storedFormatSlots } from "./zplGenerator";
import { pageLabelConfig } from "../types/Group";
import type { LabelObject } from "../types/Group";
import type { LabelConfig, PageLabel } from "../types/LabelConfig";

const label: LabelConfig = { widthMm: 50, heightMm: 30, dpmm: 8 };
const text = (marker: string): LabelObject =>
  ({ id: `t-${marker}`, type: "text", x: 10, y: 10, rotation: 0, props: { content: `«${marker}»`, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as unknown as LabelObject;
const logo: LabelObject =
  ({ id: "img", type: "image", x: 10, y: 60, rotation: 0, props: { imageId: "", widthDots: 8, heightDots: 4, threshold: 128, _gfaCache: "^GFA,4,4,1,00FFFF00", storedAs: { device: "R", name: "LOGO" } } }) as unknown as LabelObject;
const variables = [
  { id: "v1", name: "sku", fnNumber: 1, defaultValue: "DEF" },
  { id: "v2", name: "lot", fnNumber: 2, defaultValue: "FALLBACK" },
];
const dataset = { headers: ["sku"], rows: [["A1"], ["B2"]] };
const mapping = { bindings: { v1: "sku" } };
const page = (way?: "setup" | "printer") => ({ objects: [text("sku"), text("lot"), logo], storedFormatPath: "E:JOB.ZPL", ...(way ? { storedFormatDelivery: way } : {}) });

describe("a page that does not store its own format", () => {
  it("folds the delivery into the page label only beside a path", () => {
    expect(pageLabelConfig(label, page("setup")).storedFormatDelivery).toBe("setup");
    expect(pageLabelConfig(label, { storedFormatDelivery: "setup" })).not.toHaveProperty("storedFormatDelivery");
    expect(pageLabelConfig({ ...label, storedFormatDelivery: "printer" } as PageLabel, page())).not.toHaveProperty("storedFormatDelivery");
  });

  it("recalls the rows once the page says the printer holds it, but still ships the logo", () => {
    const stored = generateBatchZpl(pageLabelConfig(label, page()), page().objects, variables, dataset, mapping);
    expect(stored).toContain("^DFE:JOB.ZPL");
    expect(stored).toContain("^FN2^FDFALLBACK^FS");
    expect(stored).not.toContain("^FN2^FDFALLBACK^FS\n^XZ\n^XA\n^XFE:JOB.ZPL\n^FN2");
    const recall = generateBatchZpl(pageLabelConfig(label, page("printer")), page().objects, variables, dataset, mapping);
    expect(recall).not.toContain("^DF");
    expect(recall.startsWith("~DYR:LOGO,")).toBe(true);
    expect(recall.match(/\^XFE:JOB\.ZPL/g)).toHaveLength(2);
    expect(recall).toContain("^FN1^FDA1^FS");
    expect(recall.match(/\^FN2\^FDFALLBACK\^FS/g)).toHaveLength(2);
  });

  it("prints a page as a recall that fills every slot with its default", () => {
    const zpl = generateMultiPageZPL(label, [page("setup"), { objects: [text("sku")] }], variables);
    expect(zpl.startsWith("~DYR:LOGO,A,G,4,1,00FFFF00\n^XA\n^XFE:JOB.ZPL\n^FN1^FDDEF^FS\n^FN2^FDFALLBACK^FS\n^XZ\n^XA")).toBe(true);
    expect(zpl.match(/\^XA/g)).toHaveLength(2);
    expect(zpl).not.toContain("^DF");
  });

  it("makes the block after a recall declare its density, since the stored format set its own", () => {
    const half = { objects: [text("sku")], jmDensity: "B" as const };
    const plain = { objects: [text("sku")] };
    const zpl = generateMultiPageZPL(label, [half, page("printer"), plain], variables);
    const blocks = zpl.split("^XZ").filter((b) => b.includes("^XA"));
    expect(blocks[0]).toContain("^JMB");
    expect(blocks[1]).not.toContain("^JM");
    expect(blocks[2]).toContain("^JMA");
  });

  it("keeps storing while the name is one ^XF could never recall", () => {
    const long = { ...page("printer"), storedFormatPath: "E:VERYLONGNAME12.ZPL" };
    expect(generateMultiPageZPL(label, [long], variables)).toContain("^DFE:VERYLONGNAME12.ZPL");
    expect(generateBatchZpl(pageLabelConfig(label, long), long.objects, variables, dataset, mapping)).toContain("^DFR:LBL.ZPL");
  });

  it("reads the declared slots off the stored block, so a field the export skips declares none", () => {
    const hidden = { ...text("lot"), includeInExport: false } as LabelObject;
    expect([...storedFormatSlots(pageLabelConfig(label, page("setup")), [text("sku"), hidden], variables)]).toEqual([1]);
  });

  it("stores the format for the setup script with every slot bare and without the uploads a job ships", () => {
    const block = generateStoredFormatBlock(pageLabelConfig(label, page("setup")), page().objects, variables);
    expect(block.startsWith("^XA\n^DFE:JOB.ZPL")).toBe(true);
    expect(block).not.toContain("~DY");
    expect(block).toContain("^XGR:LOGO.GRF");
    expect(block).toContain("^FN1^FS");
    expect(block).toContain("^FN2^FS");
    expect(block).not.toContain("^FDDEF");
  });
});
