import { describe, it, expect, afterEach } from "vitest";
import { listsStoredFont, listsStoredGraphic, storedGraphicRows } from "./storedObjects";
import { putImage, removeImage } from "./imageCache";
import type { Page } from "../types/Group";
import type { ImageProps } from "../registry/image";

const GFA = "^GFA,4,4,1,00FFFF00";
const graphic = (id: string, props: Partial<ImageProps>, extra: Record<string, unknown> = {}) =>
  ({ id, type: "image", x: 0, y: 0, rotation: 0, props: { imageId: "", widthDots: 8, threshold: 128, ...props }, ...extra }) as Page["objects"][number];
const recall = (ext?: string): ImageProps => ({ imageId: "", widthDots: 8, threshold: 128, _gfaCache: GFA, storedAs: { device: "R", name: "LOGO", embedInZpl: false, ...(ext ? { ext, recall: "IM" as const } : {}) } });

afterEach(() => removeImage("cat"));

describe("the stored graphics tab's rows", () => {
  it("lists an exportable graphic under its printer path and skips one kept out of the export", () => {
    const pages: Page[] = [{ objects: [graphic("a", recall()), graphic("b", { ...recall(), storedAs: { device: "R", name: "OTHER" } }, { includeInExport: false })] }];
    const rows = storedGraphicRows(pages);
    expect([...rows.keys()]).toEqual(["R:LOGO.GRF"]);
    expect(listsStoredGraphic(rows, recall())).toBe(true);
    expect(listsStoredGraphic(rows, { ...recall(), storedAs: { device: "R", name: "OTHER" } })).toBe(false);
  });

  it("puts a path's row on the first object under it", () => {
    const rows = storedGraphicRows([{ objects: [graphic("a", recall()), graphic("b", recall())] }]);
    expect([...rows.values()].map((row) => row.id)).toEqual(["a"]);
  });

  it("lists no recall of a file no upload writes", () => {
    const rows = storedGraphicRows([{ objects: [graphic("a", recall("PNG"))] }]);
    expect(rows.size).toBe(0);
    expect(listsStoredGraphic(rows, recall("PNG"))).toBe(false);
  });

  it("lists a cached image without a printer name", () => {
    putImage({ id: "cat", name: "cat.png", dataUrl: "data:image/png;base64,", width: 1, height: 1 });
    expect(listsStoredGraphic(new Map(), { imageId: "cat", widthDots: 8, threshold: 128 })).toBe(true);
    expect(listsStoredGraphic(new Map(), { imageId: "gone", widthDots: 8, threshold: 128 })).toBe(false);
  });
});

describe("the stored fonts tab's rows", () => {
  it("lists a TrueType name and a profile entry, not a bare printer name", () => {
    expect(listsStoredFont("E:ARIAL.TTF", undefined)).toBe(true);
    expect(listsStoredFont("R:MYFONT", undefined)).toBe(false);
    expect(listsStoredFont("R:MYFONT", [{ path: "R:MYFONT" }])).toBe(true);
  });
});
