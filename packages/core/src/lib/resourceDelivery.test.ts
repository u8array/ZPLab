import { describe, expect, it } from "vitest";
import { applyFontDelivery, applyGraphicDelivery, fontDelivery, graphicDelivery, graphicJobShips } from "./resourceDelivery";
import type { ImageProps } from "../registry/image";

const GFA = "^GFA,4,4,1,00FFFF00";
const image = (extra: Partial<ImageProps["storedAs"]> | null = {}): ImageProps => ({
  imageId: "",
  widthDots: 8,
  heightDots: 4,
  threshold: 128,
  _gfaCache: GFA,
  ...(extra === null ? {} : { storedAs: { device: "R", name: "LOGO", ...extra } }),
});
const entry = { path: "R:LOGO.GRF", gfa: GFA };
const recallOnly = { device: "R", name: "LOGO", embedInZpl: false };

describe("fontDelivery", () => {
  it("reads job while the design ships the font, even with a profile entry beside it", () => {
    expect(fontDelivery({ embedInZpl: true }, "E:A.TTF", [{ path: "E:A.TTF" }])).toBe("job");
    expect(fontDelivery({ embedInZpl: true }, "E:A.TTF", undefined)).toBe("job");
  });

  it("reads setup from the profile entry under any spelling, else printer", () => {
    expect(fontDelivery(undefined, "E:A.TTF", [{ path: "e:a.ttf" }])).toBe("setup");
    expect(fontDelivery({ embedInZpl: undefined }, "E:A.TTF", undefined)).toBe("printer");
  });

  it("keeps the profile entry when the job takes over, and drops it only for printer", () => {
    const setup = [{ path: "E:A.TTF" }];
    expect(applyFontDelivery("job", undefined, "E:A.TTF", setup)).toEqual({ patch: { embedInZpl: true }, setupFonts: setup });
    expect(applyFontDelivery("setup", { embedInZpl: true }, "E:A.TTF", undefined)).toEqual({ patch: { embedInZpl: undefined }, setupFonts: [{ path: "E:A.TTF" }] });
    expect(applyFontDelivery("printer", undefined, "E:A.TTF", setup)).toEqual({ patch: null, setupFonts: undefined });
  });

  it("writes nothing the design or profile already holds", () => {
    const setup = [{ path: "E:A.TTF" }];
    expect(applyFontDelivery("job", { embedInZpl: true }, "E:A.TTF", setup)).toEqual({ patch: null, setupFonts: setup });
    expect(applyFontDelivery("setup", undefined, "E:A.TTF", setup).setupFonts).toBe(setup);
    const other = [{ path: "E:B.TTF" }];
    expect(applyFontDelivery("printer", undefined, "E:A.TTF", other)).toEqual({ patch: null, setupFonts: other });
  });
});

describe("graphicDelivery", () => {
  it("has no way to choose for an inline ^GF, and reads job while the design ships the bytes", () => {
    expect(graphicDelivery(image(null), [entry])).toBeUndefined();
    expect(graphicDelivery(image(), [entry])).toBe("job");
    expect(graphicDelivery(image({ embedInZpl: false }), [entry])).toBe("setup");
    expect(graphicDelivery(image({ embedInZpl: false }), undefined)).toBe("printer");
  });

  it("keeps a recall spelled with another extension in the choice, the entry named as the upload is", () => {
    expect(graphicDelivery(image({ embedInZpl: false, ext: "PNG" }), undefined)).toBe("printer");
    expect(graphicDelivery(image({ embedInZpl: false, ext: "PNG" }), [entry])).toBe("setup");
    const provided = applyGraphicDelivery("setup", image({ embedInZpl: false, ext: "PNG" }), [entry]);
    expect(provided).toEqual({ patch: { storedAs: recallOnly }, setupGraphics: [entry] });
    const kept = applyGraphicDelivery("printer", image({ embedInZpl: false, ext: "PNG" }), undefined);
    expect(kept).toEqual({ patch: null, setupGraphics: undefined });
  });

  it("encodes the profile entry once for setup, keeps an existing one, and drops it only for printer", () => {
    const fresh = applyGraphicDelivery("setup", image(), undefined);
    expect(fresh).toEqual({ patch: { storedAs: recallOnly, _gfaCache: GFA }, setupGraphics: [entry] });
    const stale = [{ path: "R:LOGO.GRF", gfa: "^GFA,4,4,1,FFFFFFFF" }];
    expect(applyGraphicDelivery("setup", image({ embedInZpl: true }), stale)).toEqual({ patch: { storedAs: recallOnly }, setupGraphics: stale });
    expect(applyGraphicDelivery("job", image({ embedInZpl: false }), [entry])).toEqual({ patch: { storedAs: { device: "R", name: "LOGO", embedInZpl: true } }, setupGraphics: [entry] });
    expect(applyGraphicDelivery("printer", image({ embedInZpl: false }), [entry])).toEqual({ patch: null, setupGraphics: undefined });
  });

  it("writes nothing the design or profile already holds", () => {
    expect(applyGraphicDelivery("job", image(), [entry])).toEqual({ patch: null, setupGraphics: [entry] });
    const kept = applyGraphicDelivery("setup", image({ embedInZpl: false }), [entry]);
    expect(kept).toEqual({ patch: null, setupGraphics: [entry] });
    const others = [{ path: "R:OTHER.GRF", gfa: GFA }];
    expect(applyGraphicDelivery("printer", image({ embedInZpl: false }), others)).toEqual({ patch: null, setupGraphics: others });
  });

  it("knows when a job would ship nothing, whatever the flag says", () => {
    expect(graphicJobShips(image())).toBe(true);
    expect(graphicJobShips(image({ embedInZpl: false }))).toBe(true);
    expect(graphicJobShips({ ...image(), _gfaCache: undefined })).toBe(false);
    expect(graphicJobShips({ ...image(), _gfaCache: "^GFA,4,4,1," })).toBe(false);
    expect(graphicJobShips(image(null))).toBe(false);
  });

  it("refuses setup for bytes the script cannot carry, and does nothing without a printer name", () => {
    expect(applyGraphicDelivery("setup", { ...image(), _gfaCache: "^GFA,4,4,1," }, undefined)).toBeUndefined();
    expect(applyGraphicDelivery("setup", image(null), undefined)).toBeUndefined();
    const huge = `^GFA,600000,600000,1,${"F".repeat(1_200_000)}`;
    expect(applyGraphicDelivery("setup", { ...image(), _gfaCache: huge }, undefined)).toEqual({ refused: "tooLarge" });
  });
});
