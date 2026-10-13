// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useLabelStore } from "../store/labelStore";
import { useCatalogSummaries } from "./useCatalogSummaries";
import type * as CatalogSummariesModule from "../locales/catalogSummaries";

const { pending } = vi.hoisted(() => ({ pending: new Map<string, (rows: Record<string, unknown>) => void>() }));
vi.mock("../locales/catalogSummaries", async (importOriginal) => ({
  ...(await importOriginal<typeof CatalogSummariesModule>()),
  loadCatalogSummaries: (locale: string) => new Promise((resolve) => pending.set(locale, resolve)),
}));

afterEach(() => {
  cleanup();
  pending.clear();
  act(() => useLabelStore.setState({ loadedLocale: "en" }));
});

describe("useCatalogSummaries", () => {
  it("shows nothing of the previous language while the next chunk loads", async () => {
    act(() => useLabelStore.setState({ loadedLocale: "de" }));
    const { result } = renderHook(() => useCatalogSummaries());
    await act(async () => pending.get("de")?.({ "^FO": { hash: "x", summary: "Setzt die Feldposition." } }));
    await waitFor(() => expect(result.current["^FO"]?.summary).toBe("Setzt die Feldposition."));

    act(() => useLabelStore.setState({ loadedLocale: "fr" }));
    expect(result.current).toEqual({});
    await act(async () => pending.get("fr")?.({ "^FO": { hash: "x", summary: "Place le champ." } }));
    await waitFor(() => expect(result.current["^FO"]?.summary).toBe("Place le champ."));
  });
});
