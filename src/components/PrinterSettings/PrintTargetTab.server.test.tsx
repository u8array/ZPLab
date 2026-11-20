// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import type * as ServerPrint from "../../lib/serverPrint";

const listServerPrinters = vi.hoisted(() => vi.fn());
const saveServerToken = vi.hoisted(() => vi.fn());
vi.mock("../../lib/printReach", () => ({ printReach: { desktop: false, server: true }, serverApiBase: "/api/v1" }));
vi.mock("../../lib/serverPrint", async (importOriginal) => ({ ...(await importOriginal<typeof ServerPrint>()), listServerPrinters, saveServerToken }));

import { PrintTargetTab } from "./PrintTargetTab";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";

const loc = en.printerSettings.printTarget;
const DOCK = { kind: "ok", printers: [{ id: "dock", name: "Dock 3" }] };

afterEach(cleanup);

beforeEach(() => {
  listServerPrinters.mockReset();
  saveServerToken.mockReset();
  saveServerToken.mockResolvedValue(undefined);
  act(() => {
    useLabelStore.setState({ printTarget: { ...DEFAULT_PRINT_TARGET, transport: "server" } });
  });
});

describe("PrintTargetTab in the build the server serves", () => {
  it("labels the token field alone and leaves out the address the server keeps", async () => {
    listServerPrinters.mockResolvedValue(DOCK);
    const r = render(<PrintTargetTab />);
    await waitFor(() => expect(useLabelStore.getState().printTarget.serverPrinter).toBe("dock"));
    expect((r.getByLabelText(loc.serverToken) as HTMLInputElement).type).toBe("password");
    expect(r.queryByPlaceholderText("192.168.1.100")).toBeNull();
    expect(r.queryByText(loc.hint)).toBeNull();
  });

  it("stores a typed token, empties the field and lists the printers again", async () => {
    listServerPrinters.mockResolvedValueOnce({ kind: "unauthorized" }).mockResolvedValue(DOCK);
    const r = render(<PrintTargetTab />);
    await waitFor(() => expect(r.getByText(en.printerSettings.printerStatus.failUnauthorized)).toBeTruthy());
    const field = r.getByLabelText(loc.serverToken) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "secret" } });
    await act(async () => {
      fireEvent.click(r.getByText(loc.serverTokenSave));
    });
    expect(saveServerToken).toHaveBeenCalledWith("secret");
    expect(field.value).toBe("");
    await waitFor(() => expect(r.queryByText(en.printerSettings.printerStatus.failUnauthorized)).toBeNull());
    expect(listServerPrinters).toHaveBeenCalledTimes(2);
  });

  it("keeps the server way listed with its reason while the server names no printer", async () => {
    listServerPrinters.mockResolvedValue({ kind: "ok", printers: [] });
    const r = render(<PrintTargetTab />);
    await waitFor(() => expect(r.getByText(en.zebraPrint.noPrinters)).toBeTruthy());
    expect((r.getByLabelText(en.zebraPrint.tabServer) as HTMLInputElement).disabled).toBe(true);
    expect((r.getByLabelText(en.zebraPrint.tabNetwork) as HTMLInputElement).checked).toBe(true);
  });
});
