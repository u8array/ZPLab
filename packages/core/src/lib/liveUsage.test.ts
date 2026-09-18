import { describe, it, expect } from "vitest";
import { documentUsage, liveUsage, ownerUsage } from "./liveUsage";
import type { LabelObject } from "../types/Group";

const image = (id: string, imageId: string): LabelObject =>
  ({ id, type: "image", x: 0, y: 0, rotation: 0, props: { imageId, widthDots: 8, threshold: 128 } }) as unknown as LabelObject;
const text = (id: string, printerFontName: string): LabelObject =>
  ({ id, type: "text", x: 0, y: 0, rotation: 0, props: { content: "x", fontHeight: 30, fontWidth: 0, rotation: "N", printerFontName } }) as unknown as LabelObject;

describe("liveUsage", () => {
  it("names every owner and lets the earlier one win", () => {
    const live = liveUsage({
      document: documentUsage([{ objects: [image("i", "doc"), text("t", "e:doc.ttf")] }], { customFonts: [{ alias: "M", path: "E:ALIAS.TTF" }] }),
      profile: { setupFonts: [{ path: "e:doc.ttf" }, { path: "E:PROV.TTF" }] },
      history: [documentUsage([{ objects: [image("h", "hist"), text("u", "E:HIST.TTF"), image("i2", "doc")] }], {})],
      clipboard: documentUsage([{ objects: [image("c", "clip"), text("v", "E:CLIP.TTF"), image("c2", "hist")] }], {}),
    });
    expect([...live.images.entries()]).toEqual([["doc", "document"], ["hist", "history"], ["clip", "clipboard"]]);
    expect([...live.fonts.entries()]).toEqual([
      ["E:ALIAS.TTF", "document"],
      ["E:DOC.TTF", "document"],
      ["E:PROV.TTF", "profile"],
      ["E:HIST.TTF", "history"],
      ["E:CLIP.TTF", "clipboard"],
    ]);
  });

  it("lets a snapshot claim the fonts its profile shipped", () => {
    const usage = ownerUsage([{ objects: [text("t", "E:DOC.TTF")] }], {}, { setupFonts: [{ path: "e:prov.ttf" }] });
    expect([...usage.fonts]).toEqual(["E:DOC.TTF", "E:PROV.TTF"]);
  });
});
