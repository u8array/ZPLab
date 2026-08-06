import { describe, it, expect } from "vitest";
import {
  rfidAmountRange,
  rfidPositionConvert,
  rfidPositionFromParts,
  rfidPositionOf,
  rfidPositionParts,
  rfidPositionValue,
} from "./rfidPosition";

describe("rfidPositionValue", () => {
  it("reads the three wire forms as mm off the leading edge", () => {
    expect(rfidPositionValue("520", 8)).toEqual({ mode: "abs", mm: 65 });
    expect(rfidPositionValue("F90", 8)).toEqual({ mode: "F", mm: 90 });
    expect(rfidPositionValue("B14", 8)).toEqual({ mode: "B", mm: -14 });
  });

  it("rejects an unset or malformed position", () => {
    expect(rfidPositionValue(undefined, 8)).toBeNull();
    expect(rfidPositionValue("X1", 8)).toBeNull();
  });
});

describe("rfidPositionOf", () => {
  it("keeps the notation the design already uses", () => {
    expect(rfidPositionOf(65, "abs", 8, 100)).toBe("520");
    expect(rfidPositionOf(65, "F", 8, 100)).toBe("F65");
  });

  it("switches to backfeed past the leading edge, capped at B30", () => {
    expect(rfidPositionOf(-14, "F", 8, 100)).toBe("B14");
    expect(rfidPositionOf(-99, "abs", 8, 100)).toBe("B30");
  });

  it("clamps forward travel to the label length and the F999 domain", () => {
    expect(rfidPositionOf(500, "abs", 8, 100)).toBe("800");
    expect(rfidPositionOf(5000, "F", 8, 2000)).toBe("F999");
  });
});

describe("rfidPositionParts", () => {
  it("splits each notation into its own unit", () => {
    expect(rfidPositionParts("520")).toEqual({ mode: "abs", amount: 520 });
    expect(rfidPositionParts("F90")).toEqual({ mode: "F", amount: 90 });
    expect(rfidPositionParts("B14")).toEqual({ mode: "B", amount: 14 });
    expect(rfidPositionParts("nonsense")).toBeNull();
  });

  it("round-trips through rfidPositionFromParts", () => {
    for (const wire of ["520", "F90", "B14"]) {
      const p = rfidPositionParts(wire)!;
      expect(rfidPositionFromParts(p.mode, p.amount)).toBe(wire);
    }
  });

  it("bounds the amount per notation", () => {
    expect(rfidAmountRange("abs", 240)).toEqual({ min: 0, max: 240 });
    expect(rfidAmountRange("F", 240)).toEqual({ min: 0, max: 999 });
    expect(rfidAmountRange("B", 240)).toEqual({ min: 0, max: 30 });
  });
});

describe("rfidPositionConvert", () => {
  it("keeps the distance when the unit changes", () => {
    expect(rfidPositionConvert("abs", "F", 520, 8)).toBe(65);
    expect(rfidPositionConvert("F", "abs", 65, 8)).toBe(520);
  });

  it("leaves same-notation switches alone", () => {
    expect(rfidPositionConvert("abs", "abs", 520, 8)).toBe(520);
  });

  it("drops to the leading edge when the direction flips", () => {
    // B points before the edge; no forward notation can say that, so keeping
    // the magnitude would move the position by twice the distance.
    expect(rfidPositionConvert("B", "F", 14, 8)).toBe(0);
    expect(rfidPositionConvert("B", "abs", 14, 8)).toBe(0);
    expect(rfidPositionConvert("abs", "B", 520, 8)).toBe(0);
  });
});

describe("absolute positions stay inside the wire domain", () => {
  it("caps a tall label at five digits", () => {
    expect(rfidPositionOf(5000, "abs", 24, 5000)).toBe("99999");
    expect(rfidAmountRange("abs", 120000)).toEqual({ min: 0, max: 99999 });
  });
});
