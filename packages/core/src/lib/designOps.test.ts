import { describe, it, expect } from "vitest";
import { applyDesignOps, type DesignDoc } from "./designOps";
import type { LabelObject, Page } from "../types/Group";
import type { Variable } from "../types/Variable";

const text = (id: string, content: string): LabelObject =>
  ({ id, type: "text", x: 10, y: 10, rotation: 0, props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as never;
const rightBarcode = (id: string): LabelObject =>
  ({ id, type: "code128", x: 400, y: 50, rotation: 0, fieldJustify: "R", props: { content: "12345", height: 60, moduleWidth: 2 } }) as never;
const variable = (id: string, fnNumber: number, defaultValue: string): Variable => ({ id, name: id, fnNumber, defaultValue });
const overlay = { segments: [], v: 3, regenSafe: true } as never;
const doc = (): DesignDoc => ({
  label: { widthMm: 100, heightMm: 50, dpmm: 8 },
  pages: [{ objects: [text("a", "Lot «lot»")], overlay } as Page, { objects: [text("b", "plain")], overlay } as Page],
  variables: [variable("lot", 1, "L1")],
  columnMapping: { bindings: { lot: "A" } } as never,
});
const content = (page: Page, index: number) => (page.objects[index] as { props: { content: string } }).props.content;
const noProbe = () => null;

describe("applyDesignOps", () => {
  it("applies nothing when one op fails, and names the op", () => {
    const input = doc();
    const before = JSON.stringify(input);
    const result = applyDesignOps(input, [{ op: "update", id: "a", props: { content: "x" } }, { op: "remove", id: "missing" }], noProbe);
    expect(result).toMatchObject({ ok: false, opIndex: 1, errors: ["No object with id missing"] });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("hands an added object the id the agent can address and drops that page's capture only", () => {
    const result = applyDesignOps(doc(), [{ op: "add", pageIndex: 1, object: { type: "text", x: 1, y: 1, props: { content: "new" } } }], noProbe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignedIds.get(0)).toBe("text-3");
    expect(result.doc.pages[1]?.objects.map((o) => o.id)).toEqual(["b", "text-3"]);
    expect([...result.touched]).toEqual([1]);
    expect(result.doc.pages[0]?.overlay).toBeDefined();
    expect(result.doc.pages[1]?.overlay).toBeUndefined();
  });

  it("marks an updated object dirty, keeps the capture and measures under the page label and current variables", () => {
    const seen: { dpmm: number; variables: string[] }[] = [];
    const input = doc();
    input.pages[0]!.objects.push(rightBarcode("bc"));
    const result = applyDesignOps(
      input,
      [{ op: "addVariable", variable: { name: "qty" } }, { op: "update", id: "bc", props: { content: "«qty»" } }],
      (_o, ctx) => {
        seen.push({ dpmm: ctx.label.dpmm, variables: ctx.variables.map((v) => v.name) });
        return null;
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.pages[0]?.objects[1]).toMatchObject({ dirty: true, props: { content: "«qty»" } });
    expect([...result.edited]).toEqual([0]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.dpmm === 8 && s.variables.includes("qty"))).toBe(true);
  });

  it("renames a variable through every marker without costing the captures", () => {
    const result = applyDesignOps(doc(), [{ op: "updateVariable", name: "lot", newName: "batch", comment: "c" }], noProbe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.variables[0]).toMatchObject({ name: "batch", comment: "c", defaultValue: "L1" });
    expect(content(result.doc.pages[0]!, 0)).toBe("Lot «batch»");
    expect(result.touched.size).toBe(0);
  });

  it("drops every capture when a default changes, and none when it is re-asserted", () => {
    const changed = applyDesignOps(doc(), [{ op: "updateVariable", name: "lot", defaultValue: "«L2»" }], noProbe);
    expect(changed.ok && changed.doc.variables[0]?.defaultValue).toBe("L2");
    expect(changed.ok && changed.doc.pages.every((p) => p.overlay === undefined)).toBe(true);
    const same = applyDesignOps(doc(), [{ op: "updateVariable", name: "lot", defaultValue: "L1" }], noProbe);
    expect(same.ok && same.doc.pages.every((p) => p.overlay !== undefined)).toBe(true);
  });

  it("removes a variable the way the editor does: literal default, binding gone, pages regenerate", () => {
    const result = applyDesignOps(doc(), [{ op: "removeVariable", name: "lot" }], noProbe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.variables).toEqual([]);
    expect(content(result.doc.pages[0]!, 0)).toBe("Lot L1");
    expect(result.doc.columnMapping).toEqual({ bindings: {} });
    expect(result.doc.pages.every((p) => p.overlay === undefined)).toBe(true);
  });

  it("refuses a rename onto a taken name and an edit of a locked object", () => {
    const withTwo = doc();
    withTwo.variables.push(variable("sku", 2, "S"));
    expect(applyDesignOps(withTwo, [{ op: "updateVariable", name: "lot", newName: "sku" }], noProbe)).toMatchObject({ ok: false, errors: ["Duplicate variable name: sku"] });
    const locked = doc();
    locked.pages[0]!.objects[0] = { ...locked.pages[0]!.objects[0]!, locked: true } as LabelObject;
    expect(applyDesignOps(locked, [{ op: "update", id: "a", x: 5 }], noProbe)).toMatchObject({ ok: false, errors: ["a is locked; unlock it in the app first"] });
  });
});
