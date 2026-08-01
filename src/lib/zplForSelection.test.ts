import { describe, it, expect } from "vitest";
import { zplForSelection } from "./zplForSelection";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import type { LabelObject } from "@zplab/core/types/Group";

const LABEL = { widthMm: 100, heightMm: 50, dpmm: 8 } as PageLabel;

const box = (id: string, x: number): LabelObject =>
  ({
    id,
    type: "box",
    x,
    y: 10,
    props: { width: 40, height: 20, thickness: 2, filled: false, color: "B", rounding: 0 },
  }) as unknown as LabelObject;

const group = (id: string, children: LabelObject[]): LabelObject =>
  ({ id, type: "group", x: 0, y: 0, children }) as unknown as LabelObject;

describe("zplForSelection", () => {
  it("emits only the selected object's field, not the others", () => {
    const objs = [box("a", 10), box("b", 200)];
    const zpl = zplForSelection(LABEL, objs, ["a"]);
    expect((zpl.match(/\^GB/g) || []).length).toBe(1);
    expect(zpl).toContain("^FO10,10"); // a's origin
    expect(zpl).not.toContain("^FO200,10"); // b excluded
  });

  it("emits bare field commands, no label scaffold", () => {
    const zpl = zplForSelection(LABEL, [box("a", 10)], ["a"]);
    expect(zpl).not.toContain("^XA");
    expect(zpl).not.toContain("^XZ");
    expect(zpl).not.toContain("^PW");
    expect(zpl).not.toContain("ZPLLAB");
    expect(zpl.startsWith("^FO10,10")).toBe(true);
  });

  it("includes a group when a descendant leaf is selected", () => {
    const objs = [group("g", [box("a", 10)]), box("b", 200)];
    const zpl = zplForSelection(LABEL, objs, ["a"]);
    expect(zpl).toContain("^FO10,10");
    expect(zpl).not.toContain("^FO200,10");
  });

  it("includes the template header the bodies depend on", () => {
    const variables = [{ id: "v", name: "qty", fnNumber: 5, defaultValue: "X" }];
    const tmpl = {
      id: "t", type: "text", x: 10, y: 10, rotation: 0,
      props: { content: "«qty»", fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as unknown as LabelObject;
    const zpl = zplForSelection(LABEL, [tmpl], ["t"], variables as never);
    expect(zpl).toContain("^FN5"); // template default from the header, else dead token
    expect(zpl).not.toContain("^XA"); // still no label scaffold
  });

  it("returns empty string when nothing emittable is selected", () => {
    expect(zplForSelection(LABEL, [box("a", 10)], [])).toBe("");
    expect(zplForSelection(LABEL, [box("a", 10)], ["ghost"])).toBe("");
  });
});
