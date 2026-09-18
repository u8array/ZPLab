import { describe, it, expect } from "vitest";
import { fontUsage } from "./fontUsage";
import type { LabelObject } from "../types/Group";

const text = (id: string, printerFontName?: string): LabelObject =>
  ({ id, type: "text", x: 0, y: 0, rotation: 0, props: { content: "x", fontHeight: 30, fontWidth: 0, rotation: "N", printerFontName } }) as unknown as LabelObject;

describe("fontUsage", () => {
  it("names alias paths and direct field references as storage keys, grouped leaves included", () => {
    const group = { id: "g", type: "group", x: 0, y: 0, rotation: 0, children: [text("c", "b:deep.ttf")] } as unknown as LabelObject;
    const pages = [{ objects: [text("t1", "e:field.ttf"), text("t2"), group] }, { objects: [text("t3", "BARE.TTF")] }];
    const used = fontUsage(pages, { customFonts: [{ alias: "M", path: " e:alias.ttf " }, { alias: "N", path: "" }] });
    expect([...used].sort()).toEqual(["B:DEEP.TTF", "E:ALIAS.TTF", "E:FIELD.TTF", "R:BARE.TTF"]);
  });
});
