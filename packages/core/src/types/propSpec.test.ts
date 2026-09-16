import { describe, it, expect } from "vitest";
import { describePropDomain, editBounds, moduleScaledProps, propDomainIssue, propTypeIssue, wireBounds, type NumberPropSpec, type PropSpec } from "./propSpec";

const width: NumberPropSpec = { type: "number", integer: true, min: 1, max: 100, scale: "uniform", clamp: { min: 1, max: 10 } };
const color: PropSpec = { type: "string", values: ["B", "W"] };

describe("propSpec", () => {
  it("separates the wire range from the editor's clamp", () => {
    expect(wireBounds(width)).toEqual({ min: 1, max: 100 });
    expect(editBounds(width)).toEqual({ min: 1, max: 10 });
    expect(editBounds({ type: "number", min: 2, scale: "never" })).toEqual({ min: 2, max: Infinity });
    expect(wireBounds(undefined)).toEqual({ min: -Infinity, max: Infinity });
  });

  it("names the kind mismatch before any domain question", () => {
    expect(propTypeIssue(width, "3")).toBe("must be number (got string)");
    expect(propTypeIssue(width, null)).toBe("must be number (got null)");
    expect(propTypeIssue(width, Number.NaN)).toBe("must be a finite number");
    expect(propTypeIssue(color, "B")).toBeNull();
  });

  it("judges the domain against the wire, not the editor", () => {
    expect(propDomainIssue(width, 40)).toBeNull();
    expect(propDomainIssue(width, 101)).toBe("must be between 1 and 100 (got 101)");
    expect(propDomainIssue(width, 2.5)).toBe("must be an integer (got 2.5)");
    expect(propDomainIssue({ type: "number", values: [0, 50], scale: "never" }, 37)).toBe("must be 0, 50 (got 37)");
    expect(propDomainIssue(color, "Z")).toBe('must be B, W (got "Z")');
    expect(propDomainIssue({ type: "number", min: 1, scale: "never" }, 0)).toBe("must be at least 1 (got 0)");
  });

  it("describes only what is bounded", () => {
    expect(describePropDomain(width)).toBe("integer 1..100");
    expect(describePropDomain(color)).toBe("B | W");
    expect(describePropDomain({ type: "number", scale: "dots" })).toBeUndefined();
    expect(describePropDomain({ type: "boolean" })).toBeUndefined();
  });

  it("lists the module-scaled props only", () => {
    const specs = { a: { type: "number", scale: "module" }, b: { type: "number", scale: "dots" }, c: { type: "string" } } as const;
    expect(moduleScaledProps<{ a: number; b: number; c: string }>(specs)).toEqual(["a"]);
  });
});
