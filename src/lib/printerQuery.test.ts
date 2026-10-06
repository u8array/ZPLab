import { describe, it, expect, vi, beforeEach } from "vitest";
import { queryPrinter } from "./printerQuery";
import type * as TauriCore from "@tauri-apps/api/core";

vi.mock("./platform", () => ({ isDesktopShell: true }));
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof TauriCore>()),
  invoke: (...args: unknown[]) => invoke(...args),
}));

const target = { kind: "network", host: "172.17.17.175", port: 9100 } as const;

beforeEach(() => invoke.mockReset());

describe("queryPrinter over the network", () => {
  it("turns a rejected invoke into a failure value", async () => {
    invoke.mockRejectedValueOnce("no response from printer");
    expect(await queryPrinter(target, "~HQES")).toEqual({ kind: "error", message: "no response from printer" });
  });

  it("forwards a refused connection and a reply", async () => {
    invoke.mockResolvedValueOnce({ kind: "refused" });
    expect(await queryPrinter(target, "~HI")).toEqual({ kind: "refused", port: 9100 });
    invoke.mockResolvedValueOnce({ kind: "data", body: "ZD230" });
    expect(await queryPrinter(target, "~HI")).toEqual({ kind: "ok", value: "ZD230" });
    expect(invoke).toHaveBeenLastCalledWith("query_zpl_tcp", { host: "172.17.17.175", port: 9100, zpl: "~HI" });
  });
});
