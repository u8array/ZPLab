import { describe, it, expect } from "vitest";
import {
  epcAddField,
  epcFieldRange,
  epcRemoveField,
  epcSetField,
  epcSetTotal,
  epcSetTrailing,
  epcTotalRange,
  epcTrailingField,
  splitEpcBits,
} from "./rfidEpc";

describe("splitEpcBits", () => {
  it("splits an existing total instead of dropping it", () => {
    expect(splitEpcBits(96)).toEqual([48, 48]);
    expect(splitEpcBits(97)).toEqual([49, 48]);
  });

  it("adds fields once 64-bit partitions cannot hold the total", () => {
    expect(splitEpcBits(200)).toEqual([50, 50, 50, 50]);
    expect(splitEpcBits(200)?.every((b) => b <= 64)).toBe(true);
  });

  it("starts from two default fields when there is no total yet", () => {
    expect(splitEpcBits(undefined)).toEqual([8, 8]);
  });

  it("refuses to split a tag too narrow for two fields", () => {
    expect(splitEpcBits(1)).toBeNull();
  });

  it("reports totals past 16 x 64 bits as unpartitionable", () => {
    expect(splitEpcBits(1024)).not.toBeNull();
    expect(splitEpcBits(1025)).toBeNull();
  });
});

describe("fixed-total partition edits", () => {
  const SGTIN = [8, 3, 3, 20, 24, 38];

  it("derives the trailing field from the total", () => {
    expect(epcTrailingField(96, SGTIN.slice(0, -1))).toBe(38);
  });

  it("keeps the total when a field is retyped", () => {
    const next = epcSetField(96, SGTIN, 3, 26);
    expect(next).toEqual([8, 3, 3, 26, 24, 32]);
    expect(next.reduce((a, b) => a + b, 0)).toBe(96);
  });

  it("clamps a retype to what leaves the trailing field valid", () => {
    // The other typed fields claim 34 bits, so this one may grow to 61 before
    // the trailing field would fall under its 1-bit minimum.
    expect(epcSetField(96, SGTIN, 4, 99)).toEqual([8, 3, 3, 20, 61, 1]);
    expect(epcFieldRange(96, SGTIN, 4)).toEqual({ min: 1, max: 61 });
  });

  it("keeps the total when a field is added or removed", () => {
    const added = epcAddField(96, SGTIN);
    expect(added).toEqual([8, 3, 3, 20, 24, 19, 19]);
    expect(added?.reduce((a, b) => a + b, 0)).toBe(96);
    const removed = epcRemoveField(96, SGTIN, 0);
    expect(removed).toEqual([3, 3, 20, 24, 46]);
    expect(removed?.reduce((a, b) => a + b, 0)).toBe(96);
  });

  it("collapses to a lone field, which the caller drops", () => {
    expect(epcRemoveField(96, [48, 48], 0)).toEqual([48]);
  });

  it("spreads the freed bits so no field passes 64", () => {
    expect(epcRemoveField(96, [48, 12, 36], 0)).toEqual([32, 64]);
    expect(epcRemoveField(96, [48, 12, 36], 0)?.every((b) => b <= 64)).toBe(true);
  });

  it("refuses a removal the remaining fields cannot absorb", () => {
    expect(epcRemoveField(192, [64, 64, 64], 0)).toBeNull();
  });

  it("bounds the total by what the typed fields already claim", () => {
    expect(epcTotalRange(SGTIN, 65535)).toEqual({ min: 59, max: 122 });
    expect(epcTotalRange(undefined, 65535)).toEqual({ min: 1, max: 65535 });
  });

  it("grows the tag when the trailing field is retyped", () => {
    expect(epcSetTrailing(SGTIN, 46)).toEqual({
      partitions: [8, 3, 3, 20, 24, 46],
      total: 104,
    });
    expect(epcSetTrailing(SGTIN, 99).partitions.at(-1)).toBe(64);
  });

  it("moves a total change into the trailing field", () => {
    expect(epcSetTotal(SGTIN, 104)).toEqual([8, 3, 3, 20, 24, 46]);
  });
});
