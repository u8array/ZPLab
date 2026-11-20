// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import type * as ServerPrint from "../../lib/serverPrint";

const listServerPrinters = vi.hoisted(() => vi.fn());
const sendZplServer = vi.hoisted(() => vi.fn());
vi.mock("../../lib/printReach", () => ({ printReach: { desktop: false, server: true }, serverApiBase: "/api/v1" }));
vi.mock("../../lib/serverPrint", async (importOriginal) => ({ ...(await importOriginal<typeof ServerPrint>()), listServerPrinters, sendZplServer }));

import { WayPanel } from "./ZebraWayPanel.testkit";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);

beforeEach(() => {
  listServerPrinters.mockReset();
  sendZplServer.mockReset();
  act(() => {
    useLabelStore.setState({ dataset: null, columnMapping: null, printTarget: { ...DEFAULT_PRINT_TARGET, transport: "server" } });
  });
});

describe("ZebraWayPanel over the server", () => {
  it("sends to the printer the server lists and words a failure from the locale", async () => {
    listServerPrinters.mockResolvedValue({ kind: "ok", printers: [{ id: "dock", name: "Dock 3" }] });
    sendZplServer.mockResolvedValueOnce({ kind: "sent" }).mockResolvedValueOnce({ kind: "server_unreachable" });
    const r = render(<WayPanel way="server" zpl={() => "^XA^XZ"} />);
    await waitFor(() => expect((r.getByText(en.zebraPrint.send) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.send));
    });
    expect(sendZplServer).toHaveBeenCalledWith("dock", "^XA^XZ");
    expect(r.getByText(en.zebraPrint.success)).toBeTruthy();
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.send));
    });
    expect(r.getByText(en.printerSettings.printerStatus.failServerUnreachable)).toBeTruthy();
  });
});
