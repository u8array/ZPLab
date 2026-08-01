import { describe, expect, it } from "vitest";
import { ObjectRegistry, type LeafType } from "@zplab/core/registry";

describe("fdPlainEscape carrier tripwire", () => {
  it("code128 is the only type with its own ^FD escape grammar", () => {
    // gs1ModeDFns, flushField and markerResolve hardcode "code128" or
    // code128PlainFd (registry import would cycle); a second carrier must be
    // wired there too, or its defaults emit raw and imports never adopt.
    const carriers = (Object.keys(ObjectRegistry) as LeafType[])
      .filter((t) => ObjectRegistry[t].ctrlNeedsOwnEscape);
    expect(carriers).toEqual(["code128"]);
  });
});
