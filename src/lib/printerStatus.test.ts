import { describe, it, expect, vi, beforeEach } from "vitest";
import { readPrinterConfiguration, readPrinterStatus } from "./printerStatus";
import type * as PrinterQuery from "./printerQuery";

const queryPrinter = vi.fn();
vi.mock("./printerQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof PrinterQuery>()),
  queryPrinter: (...args: unknown[]) => queryPrinter(...args),
}));

const target = { kind: "network", host: "172.17.17.175", port: 9100 } as const;
const data = (body: string) => ({ kind: "ok", value: body });
const identity = data("ZD230,V89.21.46Z,8,4096KB,");
const clear = data("PRINTER STATUS\r\nERRORS: 0 00000000 00000000\r\nWARNINGS: 0 00000000 00000000");
const memory = data("4096,2048,1500");
const strings = data("\u0002030,0,0,1200,000,0,0,0,000,0,0,0\u0003\r\n\u0002001,0,0,0,1,2,0,0,00000000,1,000\u0003\r\n");

beforeEach(() => queryPrinter.mockReset());

describe("readPrinterStatus", () => {
  it("asks identity, flags and memory, then the status strings when the flags allow it", async () => {
    queryPrinter.mockResolvedValueOnce(identity).mockResolvedValueOnce(clear).mockResolvedValueOnce(memory).mockResolvedValueOnce(strings);
    const steps: string[] = [];
    const result = await readPrinterStatus(target, (step) => steps.push(step));
    expect(queryPrinter.mock.calls.map((c) => c[1])).toEqual(["~HI", "~HQES", "~HM", "~HS"]);
    expect(steps).toEqual(["~HI", "~HQES", "~HM", "~HS"]);
    expect(result).toMatchObject({
      kind: "ok",
      value: { identity: { model: "ZD230" }, memory: { availableKb: 1500 }, status: { paused: false }, withheld: false },
    });
    if (result.kind !== "ok") throw new Error("expected a report");
    expect(result.value.raw).toBe(
      "~HI\nZD230,V89.21.46Z,8,4096KB,\n\n~HQES\nPRINTER STATUS\r\nERRORS: 0 00000000 00000000\r\nWARNINGS: 0 00000000 00000000\n\n~HM\n4096,2048,1500\n\n~HS\n030,0,0,1200,000,0,0,0,000,0,0,0\r\n001,0,0,0,1,2,0,0,00000000,1,000",
    );
  });

  it("skips the status strings the printer would withhold with the head open", async () => {
    queryPrinter
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(data("ERRORS: 1 00000000 00000004\r\nWARNINGS: 0 00000000 00000000"))
      .mockResolvedValueOnce(memory);
    const result = await readPrinterStatus(target);
    expect(queryPrinter).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ kind: "ok", value: { flags: { errors: ["headOpen"] }, status: undefined, withheld: true } });
  });

  it("keeps the identity and still asks the status strings when the flag and memory queries fail", async () => {
    queryPrinter
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce({ kind: "error", message: "no response from printer" })
      .mockResolvedValueOnce({ kind: "unreachable" })
      .mockResolvedValueOnce(strings);
    const result = await readPrinterStatus(target);
    expect(queryPrinter.mock.calls.map((c) => c[1])).toEqual(["~HI", "~HQES", "~HM", "~HS"]);
    expect(result).toMatchObject({
      kind: "ok",
      value: { identity: { model: "ZD230" }, flags: undefined, memory: undefined, status: { printMode: 2 }, withheld: false },
    });
  });

  it("forwards a failed first contact unchanged", async () => {
    queryPrinter.mockResolvedValueOnce({ kind: "refused" });
    expect(await readPrinterStatus(target)).toEqual({ kind: "refused" });
    expect(queryPrinter).toHaveBeenCalledTimes(1);
  });

});

describe("readPrinterConfiguration", () => {
  it("returns the echo as text without its frame bytes", async () => {
    queryPrinter.mockResolvedValueOnce(data("\u0002  ZD230  PRINTER\r\n  V89.21.46Z  FIRMWARE\u0003"));
    expect(await readPrinterConfiguration(target)).toEqual({ kind: "ok", value: "ZD230  PRINTER\r\n  V89.21.46Z  FIRMWARE" });
    expect(queryPrinter).toHaveBeenLastCalledWith(target, "^XA^HH^XZ");
  });
});
