import { describe, it, expect, afterEach } from "vitest";
import {
  setMeasuredBounds,
  getMeasuredBounds,
  clearMeasuredBounds,
  measuredBoundsMap,
  subscribeMeasuredBounds,
  getMeasuredSnapshot,
} from "./measuredBoundsCache";

afterEach(() => {
  clearMeasuredBounds("a");
  clearMeasuredBounds("b");
});

describe("measuredBoundsCache", () => {
  it("round-trips a footprint by id", () => {
    setMeasuredBounds("a", { width: 100, height: 40 });
    expect(getMeasuredBounds("a")).toEqual({ width: 100, height: 40 });
  });

  it("overwrites on re-publish", () => {
    setMeasuredBounds("a", { width: 100, height: 40 });
    setMeasuredBounds("a", { width: 120, height: 50 });
    expect(getMeasuredBounds("a")).toEqual({ width: 120, height: 50 });
  });

  it("clears an entry", () => {
    setMeasuredBounds("a", { width: 100, height: 40 });
    clearMeasuredBounds("a");
    expect(getMeasuredBounds("a")).toBeUndefined();
  });

  it("exposes the live map the align handler reads as ctx.measured", () => {
    setMeasuredBounds("b", { width: 10, height: 20 });
    expect(measuredBoundsMap().get("b")).toEqual({ width: 10, height: 20 });
  });

  it("notifies subscribers on first publish and on a changed footprint", () => {
    let count = 0;
    const off = subscribeMeasuredBounds(() => count++);
    setMeasuredBounds("a", { width: 100, height: 40 });
    setMeasuredBounds("a", { width: 100, height: 50, barHeightDots: 30 });
    off();
    expect(count).toBe(2);
  });

  it("stays silent when a re-publish doesn't change the footprint", () => {
    let count = 0;
    setMeasuredBounds("a", { width: 100, height: 40 });
    const off = subscribeMeasuredBounds(() => count++);
    setMeasuredBounds("a", { width: 100, height: 40 });
    off();
    expect(count).toBe(0);
  });

  it("notifies on clear so a consumer can drop stale bounds", () => {
    let count = 0;
    setMeasuredBounds("a", { width: 100, height: 40 });
    const off = subscribeMeasuredBounds(() => count++);
    clearMeasuredBounds("a");
    clearMeasuredBounds("a"); // no-op, already gone
    off();
    expect(count).toBe(1);
  });

  it("stops notifying after unsubscribe", () => {
    let count = 0;
    const off = subscribeMeasuredBounds(() => count++);
    off();
    setMeasuredBounds("a", { width: 1, height: 1 });
    expect(count).toBe(0);
  });

  it("snapshot identity is stable between renders and changes on a real change", () => {
    setMeasuredBounds("a", { width: 100, height: 40 });
    const s1 = getMeasuredSnapshot();
    expect(getMeasuredSnapshot()).toBe(s1); // stable, no spurious re-render
    setMeasuredBounds("a", { width: 100, height: 40 }); // equal, no change
    expect(getMeasuredSnapshot()).toBe(s1);
    setMeasuredBounds("a", { width: 120, height: 50 });
    const s2 = getMeasuredSnapshot();
    expect(s2).not.toBe(s1);
    expect(s2.get("a")).toEqual({ width: 120, height: 50 });
  });
});
