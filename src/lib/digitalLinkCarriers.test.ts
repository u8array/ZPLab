import { describe, expect, it } from "vitest";
import { ObjectRegistry, type LeafType } from "@zplab/core/registry";

describe("digitalLinkCarrier tripwire", () => {
  it("names the carriers GS1 approves for a Digital Link URI, each a typed-content carrier", () => {
    const types = Object.keys(ObjectRegistry) as LeafType[];
    const carriers = types.filter((t) => ObjectRegistry[t].digitalLinkCarrier);
    expect(carriers).toEqual(["qrcode", "datamatrix"]);
    expect(carriers.filter((t) => !ObjectRegistry[t].typedContent)).toEqual([]);
  });
});
