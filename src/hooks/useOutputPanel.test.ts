// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOutputPanel } from "./useOutputPanel";

const rail = (hook: { onMouseDown: (e: React.MouseEvent) => void }) =>
  act(() =>
    hook.onMouseDown({
      preventDefault: vi.fn(),
      // Cursor exactly on the rail's top edge: zero grab offset.
      clientY: 0,
      currentTarget: { getBoundingClientRect: () => ({ top: 0 }) },
    } as never),
  );
const moveTo = (clientY: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent("mousemove", { clientY }));
  });
const release = () =>
  act(() => {
    window.dispatchEvent(new MouseEvent("mouseup"));
  });
const heightFor = (panelH: number) => window.innerHeight - panelH;

beforeEach(() => localStorage.clear());

describe("useOutputPanel drag", () => {
  it("tracks the mouse absolutely and persists resize-then-collapse heights", () => {
    const { result } = renderHook(() => useOutputPanel());
    rail(result.current);
    moveTo(heightFor(450));
    expect(result.current.height).toBe(450);
    expect(result.current.collapsed).toBe(false);
    // Same gesture past the minimum: collapses, but 450 must reach storage.
    moveTo(heightFor(40));
    expect(result.current.collapsed).toBe(true);
    release();
    expect(JSON.parse(localStorage.getItem("zpl-output-panel") ?? "{}")).toMatchObject({
      collapsed: true,
      height: 450,
    });
  });

  it("re-expands within the same gesture", () => {
    const { result } = renderHook(() => useOutputPanel());
    rail(result.current);
    moveTo(heightFor(40));
    expect(result.current.collapsed).toBe(true);
    moveTo(heightFor(300));
    expect(result.current.collapsed).toBe(false);
    expect(result.current.height).toBe(300);
    release();
  });

  it("clamps at the minimum instead of collapsing while a source edit is open", () => {
    const { result } = renderHook(() => useOutputPanel(undefined, true));
    rail(result.current);
    moveTo(heightFor(40));
    expect(result.current.collapsed).toBe(false);
    expect(result.current.height).toBe(80);
    release();
  });
});
