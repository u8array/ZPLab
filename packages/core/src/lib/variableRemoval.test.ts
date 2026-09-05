import { describe, it, expect } from "vitest";
import { removeVariables } from "./variableRemoval";
import type { LabelObject, Page } from "../types/Group";
import type { Variable } from "../types/Variable";

const text = (id: string, content: string): LabelObject =>
  ({ id, type: "text", x: 0, y: 0, rotation: 0, props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as never;
const variable = (id: string, fnNumber: number, defaultValue: string): Variable => ({ id, name: id, fnNumber, defaultValue });

describe("removeVariables", () => {
  const overlay = { segments: [], v: 3, regenSafe: true } as never;
  const doc = {
    variables: [variable("lot", 1, "L«x»1"), variable("sku", 2, "S")],
    pages: [{ objects: [text("a", "Lot «lot» / «sku»")], overlay } as Page, { objects: [text("b", "plain")], overlay } as Page],
    columnMapping: { bindings: { lot: "A", sku: "B" } } as never,
  };

  it("substitutes markers with the literal default, prunes the binding and regenerates the pages", () => {
    const next = removeVariables(doc, new Set(["lot"]));
    expect(next.variables.map((v) => v.id)).toEqual(["sku"]);
    expect((next.pages[0]?.objects[0] as { props: { content: string } }).props.content).toBe("Lot Lx1 / «sku»");
    expect(next.pages.every((p) => p.overlay === undefined)).toBe(true);
    expect(next.columnMapping).toEqual({ bindings: { sku: "B" } });
  });

  it("returns the same document when nothing matches", () => {
    expect(removeVariables(doc, new Set(["none"]))).toBe(doc);
  });
});
