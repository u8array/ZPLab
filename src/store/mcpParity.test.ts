import { describe, it, expect, afterEach } from "vitest";
import { applyObjectChanges } from "./labelStore.internals";
import { registerBarcodeWidthProber, unregisterBarcodeWidthProber } from "./anchorRepin";
import { measureFootprintDots } from "@zplab/core/lib/footprintProber";
import { resolveForMeasure } from "@zplab/core/lib/barcodeDims";
import type { LabelObject } from "@zplab/core/types/Group";
import type { Variable } from "@zplab/core/types/Variable";
// Test-only reach across the process boundary: parity between the editor's
// mutation pipeline and patch_design is exactly what this file pins, and no
// runtime code imports the server.
import { createDraft, patchDesign, type CreateDraftInput } from "../../packages/mcp-server/src/tools";
import { registerSidecarFootprintMeasurer } from "../../packages/mcp-server/src/footprint";

/** One update op, run through both pipelines with the SAME width probe, so a
 *  hook one side skips (normalize, repin) shows as an object diff. */
const CASES: {
  name: string;
  object: CreateDraftInput["objects"][number];
  props: Record<string, unknown>;
  variables?: CreateDraftInput["variables"];
}[] = [
  {
    name: "code49 moduleWidth re-clamps its height",
    object: { type: "code49", id: "o", x: 50, y: 50, props: { content: "AB", height: 40, moduleWidth: 2 } },
    props: { moduleWidth: 6 },
  },
  {
    name: "right-justified code128 repins on a width-changing edit",
    object: {
      type: "code128", id: "o", x: 400, y: 50, fieldJustify: "R",
      props: { content: "12345", height: 60, moduleWidth: 2 },
    },
    props: { content: "1234567890" },
  },
  {
    name: "text content merge",
    object: { type: "text", id: "o", x: 10, y: 10, props: { content: "a", fontHeight: 30 } },
    props: { content: "bb", fontHeight: 40 },
  },
  {
    // The re-pin's width comes from resolved content, so a marker-bearing field
    // is where a row-bound editor probe and the defaults-only sidecar probe
    // would write two different x for one op.
    name: "right-justified barcode bound to a variable repins off the defaults",
    object: {
      type: "code128", id: "o", x: 400, y: 50, fieldJustify: "R",
      props: { content: "«LOT»", height: 60, moduleWidth: 2 },
    },
    props: { moduleWidth: 3 },
    variables: [{ name: "LOT", defaultValue: "AB" }],
  },
];

/** The store-side probe the CANVAS registers: markers resolved to their variable
 *  defaults (resolveForMeasure), never a dataset row or render mode, comparable to the sidecar's.
 *  Without the resolve step this harness would measure literal «marker» text, proving parity only for marker-free fields. */
let probe = (o: LabelObject) => measureFootprintDots(o, 8);

afterEach(() => unregisterBarcodeWidthProber(probe));

// SCOPE: both sides deliberately share ONE probe (measureFootprintDots), so this
// harness proves hook parity (normalize/commit/repin), never probe parity. The
// canvas's real zoom-scaled prober cannot run headless; that gap is pinned separately (footprint.test.ts, kernel-overrides-measured).
describe("an update edits the same object the same way on both paths", () => {
  for (const c of CASES) {
    it(c.name, () => {
      registerSidecarFootprintMeasurer();
      const base = createDraft({
        widthMm: 100, heightMm: 50, dpmm: 8, objects: [c.object],
        ...(c.variables ? { variables: c.variables } : {}),
      });
      expect(base.ok).toBe(true);
      if (!base.ok) return;
      const declared = (base.designFile as { variables?: Variable[] }).variables ?? [];
      probe = (o: LabelObject) => measureFootprintDots(resolveForMeasure(o, declared), 8);
      registerBarcodeWidthProber(probe);
      const stored = (base.designFile as { pages: { objects: LabelObject[] }[] }).pages[0]!.objects[0]!;

      const viaStore = applyObjectChanges(stored, { props: c.props });
      const viaPatch = patchDesign(base.designFile, [{ op: "update", id: "o", props: c.props }]);
      expect(viaPatch.ok).toBe(true);
      if (!viaPatch.ok) return;
      const patched = (viaPatch.designFile as { pages: { objects: LabelObject[] }[] })
        .pages[0]!.objects[0]!;

      // dirty is provenance, not content.
      const strip = (o: LabelObject) => ({ ...o, dirty: undefined });
      expect(strip(patched)).toEqual(strip(viaStore));
    });
  }
});

describe("a device-font block edit normalizes the same on both paths", () => {
  it("grows blockLines from the label's device font, not font 0", () => {
    // Both write paths must hand normalizeChanges the same device-font ctx:
    // without it the sidecar derived ^FB growth from font-0 metrics while the
    // editor used the label's ^CF font's cell grid.
    registerSidecarFootprintMeasurer();
    // Hard breaks with no prior blockWidth: the ^FB activation backfills the
    // line cap by wrapping at the default width with the RESOLVED font's
    // advance, the one derivation in this hook that reads the ctx.
    const content = "a fairly long first line that must soft-wrap at the default width\nsecond";
    const design = {
      schemaVersion: 5,
      label: { widthMm: 100, heightMm: 50, dpmm: 8, defaultFontId: "D" },
      pages: [{ objects: [{ id: "o", type: "text", x: 0, y: 0, rotation: 0,
        props: { content: "x", fontHeight: 30, fontWidth: 0, textMode: "fb" } }] }],
    };
    const stored = (design.pages as { objects: LabelObject[] }[])[0]!.objects[0]!;
    const viaStore = applyObjectChanges(
      stored,
      { props: { content } },
      false,
      { defaultFontId: "D" },
    );
    const viaPatch = patchDesign(design, [{ op: "update", id: "o", props: { content } }]);
    expect(viaPatch.ok).toBe(true);
    if (!viaPatch.ok) return;
    const patched = (viaPatch.designFile as { pages: { objects: LabelObject[] }[] })
      .pages[0]!.objects[0]!;
    const lines = (o: LabelObject) => (o as { props: { blockLines?: number } }).props.blockLines;
    expect(lines(patched)).toBe(lines(viaStore));
    expect(lines(viaStore)!).toBeGreaterThan(1);

    // The OTHER ctx site (toLabelObject, reached only via a patch add op on a
    // device-font design): the added twin must derive the same cap the update
    // path just did, or add still measures font 0 while update measures D.
    const added = patchDesign(design, [{
      op: "add",
      object: { type: "text", id: "twin", x: 0, y: 40,
        props: { content, fontHeight: 30, fontWidth: 0, textMode: "fb" } },
    }]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const twin = (added.designFile as { pages: { objects: LabelObject[] }[] })
      .pages[0]!.objects.find((o) => o.id === "twin")!;
    expect(lines(twin)).toBe(lines(viaStore));
  });
});
