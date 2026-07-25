import { describe, it, expect, vi, afterEach } from "vitest";
import { newId } from "@zplab/core/lib/ids";

const V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns v4-shaped, unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(V4_SHAPE);
  });

  it("falls back to getRandomValues when randomUUID is missing (non-secure context)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array<ArrayBuffer>) => real.getRandomValues.call(real, arr),
    });
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(V4_SHAPE);
  });
});
