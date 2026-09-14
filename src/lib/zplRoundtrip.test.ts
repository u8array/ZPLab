import { describe, it, expect } from "vitest";
import { cloneShifted, EMIT_AFFECTING_KEYS } from "../store/labelStore.internals";
import { stampDirtyLeaves } from "../store/dirtyTracking";
import type { LabelObject, Page } from "@zplab/core/types/Group";
import { labelObjectBaseSchema } from "@zplab/core/types/LabelObject";

// Byte-identical round-trip lives in zplOverlay/* (capture + overlay replay).
// This file guards the `dirty` model that drives it. Dirty is stamped centrally
// by the dirtyTracking middleware (stampDirtyLeaves), not by individual mutators,
// so an emit-affecting object change flips dirty and the overlay regenerates it.

const leaf = (over: object = {}): LabelObject =>
  ({
    id: "o",
    type: "text",
    x: 10,
    y: 10,
    rotation: 0,
    props: { content: "hi", fontHeight: 20, fontWidth: 0, rotation: "N" },
    ...over,
  }) as unknown as LabelObject;
const page = (objs: LabelObject[]): Page[] => [{ objects: objs }];

// Real mutators are identity-preserving (a changed object spreads from the
// prior one, keeping the same `props` ref when props didn't change), so the
// fixtures derive `next` from a shared `prev` rather than rebuilding leaves.
const edit = (o: LabelObject, over: object): LabelObject => ({ ...o, ...over });

describe("stampDirtyLeaves (central dirty model)", () => {
  it("stamps dirty when an emit-affecting field changes", () => {
    const o = leaf();
    const out = stampDirtyLeaves(page([o]), page([edit(o, { x: 99 })]));
    expect(out[0]!.objects[0]!.dirty).toBe(true);
  });

  it("does not stamp a metadata-only change", () => {
    const o = leaf();
    const out = stampDirtyLeaves(page([o]), page([edit(o, { name: "Header" })]));
    expect(out[0]!.objects[0]!.dirty).toBeFalsy();
  });

  it("stamps a type change even when props are preserved (convertObjectType guard)", () => {
    const o = leaf();
    const out = stampDirtyLeaves(page([o]), page([edit(o, { type: "box" })]));
    expect(out[0]!.objects[0]!.dirty).toBe(true);
  });

  it("does not stamp a reorder (same object reference, new position)", () => {
    const a = leaf({ id: "a" });
    const b = leaf({ id: "b", x: 50 });
    const out = stampDirtyLeaves(page([a, b]), page([b, a]));
    expect(out[0]!.objects.every((o) => !o.dirty)).toBe(true);
  });

  it("does not stamp a net-new object (no prior counterpart)", () => {
    const out = stampDirtyLeaves(page([]), page([leaf({ id: "new" })]));
    expect(out[0]!.objects[0]!.dirty).toBeFalsy();
  });

  it("keeps an already-dirty object dirty", () => {
    const o = leaf();
    const out = stampDirtyLeaves(page([o]), page([edit(o, { dirty: true, x: 99 })]));
    expect(out[0]!.objects[0]!.dirty).toBe(true);
  });

  it("stamps a leaf nested inside a group", () => {
    const o = leaf();
    const grp = (child: LabelObject): LabelObject =>
      ({ id: "g", type: "group", x: 0, y: 0, rotation: 0, children: [child] }) as unknown as LabelObject;
    const out = stampDirtyLeaves(page([grp(o)]), page([grp(edit(o, { x: 99 }))]));
    const child = (out[0]!.objects[0] as unknown as { children: LabelObject[] }).children[0]!;
    expect(child.dirty).toBe(true);
  });

  it("is identity-preserving when nothing emit-affecting changed", () => {
    const o = leaf();
    const next = page([edit(o, { name: "x" })]);
    expect(stampDirtyLeaves(page([o]), next)).toBe(next);
  });
});

describe("round-trip dirty guardrails", () => {
  it("clones drop provenance (a copy is a net-new object)", () => {
    expect(cloneShifted(leaf({ dirty: true }), 20, 20).dirty).toBeUndefined();
  });

  it("every base field is classified emit-affecting or metadata", () => {
    const META = new Set(["locked", "visible", "includeInExport", "name"]);
    const ignore = new Set(["id", "type", "dirty"]);
    for (const k of Object.keys(labelObjectBaseSchema.shape)) {
      if (ignore.has(k)) continue;
      expect(EMIT_AFFECTING_KEYS.has(k) || META.has(k), `unclassified base field: ${k}`).toBe(true);
    }
  });
});
