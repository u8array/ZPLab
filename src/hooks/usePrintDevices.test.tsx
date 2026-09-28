// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type * as LocalPrint from "../lib/localPrint";

const listLocalPrinters = vi.hoisted(() => vi.fn());
vi.mock("../lib/localPrint", async (importOriginal) => ({ ...(await importOriginal<typeof LocalPrint>()), listLocalPrinters }));

import { useLocalPrinters } from "./usePrintDevices";
import { useLabelStore } from "../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../lib/printTarget";

describe("usePrintDevices", () => {
  it("keeps a way on offer after a failed enumeration, so its picker can show the error", async () => {
    listLocalPrinters.mockRejectedValueOnce(new Error("spooler down"));
    const { result } = renderHook(() => useLocalPrinters(true));
    expect(result.current.present).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("spooler down");
    expect(result.current.present).toBe(true);
  });

  it("binds the first device when the bound one is not listed and drops the offer when the list is empty", async () => {
    useLabelStore.setState({ printTarget: { ...DEFAULT_PRINT_TARGET, localPrinter: "gone" } });
    listLocalPrinters.mockResolvedValueOnce([{ system_name: "ZD230", name: "ZDesigner ZD230", driver_name: "", port_name: "" }]);
    const { result } = renderHook(() => useLocalPrinters(true));
    await waitFor(() => expect(result.current.selectedId).toBe("ZD230"));
    expect(useLabelStore.getState().printTarget.localPrinter).toBe("ZD230");
    listLocalPrinters.mockResolvedValueOnce([]);
    const empty = renderHook(() => useLocalPrinters(true));
    await waitFor(() => expect(empty.result.current.loading).toBe(false));
    expect(empty.result.current.present).toBe(false);
  });
});
