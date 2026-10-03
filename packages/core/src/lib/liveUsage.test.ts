import { describe, it, expect } from "vitest";
import { documentUsage, fileDeletability, liveUsage } from "./liveUsage";
import type { LabelObject } from "../types/Group";

const image = (id: string, imageId: string): LabelObject =>
  ({ id, type: "image", x: 0, y: 0, rotation: 0, props: { imageId, widthDots: 8, threshold: 128 } }) as unknown as LabelObject;
const text = (id: string, printerFontName: string): LabelObject =>
  ({ id, type: "text", x: 0, y: 0, rotation: 0, props: { content: "x", fontHeight: 30, fontWidth: 0, rotation: "N", printerFontName } }) as unknown as LabelObject;

describe("liveUsage", () => {
  it("names every owner and lets the first claim win, with history claiming last", () => {
    const live = liveUsage({
      document: documentUsage([{ objects: [image("i", "doc"), text("t", "e:doc.ttf")] }], { customFonts: [{ alias: "M", path: "E:ALIAS.TTF" }] }),
      profile: { setupFonts: [{ path: "e:doc.ttf" }, { path: "E:PROV.TTF" }] },
      history: [documentUsage([{ objects: [image("h", "hist"), text("u", "E:HIST.TTF"), image("i2", "doc")] }], {})],
      restore: documentUsage([{ objects: [image("r", "kept"), text("w", "E:KEPT.TTF"), image("r2", "hist")] }], {}),
      clipboard: documentUsage([{ objects: [image("c", "clip"), text("v", "E:CLIP.TTF"), image("c2", "kept")] }], {}),
    });
    expect([...live.images.entries()]).toEqual([["doc", "document"], ["kept", "restore"], ["hist", "restore"], ["clip", "clipboard"]]);
    expect([...live.fonts.entries()]).toEqual([
      ["E:ALIAS.TTF", "document"],
      ["E:DOC.TTF", "document"],
      ["E:PROV.TTF", "profile"],
      ["E:KEPT.TTF", "restore"],
      ["E:CLIP.TTF", "clipboard"],
      ["E:HIST.TTF", "history"],
    ]);
  });

  it("frees a file only history names, blocks one the clipboard names and counts the undo steps either way", () => {
    const history = [documentUsage([{ objects: [image("h", "hist"), image("c", "clip")] }], {}), documentUsage([{ objects: [image("h2", "hist")] }], {})];
    const live = liveUsage({ document: documentUsage([], {}), profile: {}, history, restore: undefined, clipboard: documentUsage([{ objects: [image("c", "clip")] }], {}) });
    expect(fileDeletability(live, history, "images", "hist")).toEqual({ blockedBy: undefined, historySteps: 2 });
    expect(fileDeletability(live, history, "images", "clip")).toEqual({ blockedBy: "clipboard", historySteps: 1 });
    expect(fileDeletability(live, history, "images", "none")).toEqual({ blockedBy: undefined, historySteps: 0 });
  });
});
