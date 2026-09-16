import { describe, it, expect } from "vitest";
import { ObjectRegistry } from "./index";
import { editBounds, propDomainIssue, propTypeIssue, type PropSpec } from "../types/propSpec";

const entries = Object.entries(ObjectRegistry).map(([type, e]) => ({
  type,
  specs: e.propSpecs as Record<string, PropSpec>,
  defaults: e.defaultProps as Record<string, unknown>,
  uniform: e.uniformScaleProp as string | undefined,
}));

describe("prop specs", () => {
  it("accept their own defaults", () => {
    for (const { type, specs, defaults } of entries) {
      for (const [key, value] of Object.entries(defaults)) {
        const spec = specs[key] as PropSpec;
        expect(propTypeIssue(spec, value) ?? propDomainIssue(spec, value), `${type}.${key}`).toBeNull();
      }
    }
  });

  it("bound every prop a resize clamps", () => {
    for (const { type, specs, uniform } of entries) {
      for (const [key, spec] of Object.entries(specs)) {
        if (spec.type === "number" && (spec.scale === "module" || spec.scale === "uniform")) {
          expect(Number.isFinite(editBounds(spec).min), `${type}.${key}`).toBe(true);
          expect(Number.isFinite(editBounds(spec).max), `${type}.${key}`).toBe(true);
        }
      }
      if (uniform) expect((specs[uniform] as { scale?: string } | undefined)?.scale, `${type}.${uniform}`).toBe("uniform");
    }
  });
});
