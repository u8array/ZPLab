import { describe, it, expect } from "vitest";
import { parsePrinters } from "./printers.js";

const errorsOf = (raw: string): string[] => {
  const r = parsePrinters(raw);
  return r.ok ? [] : r.errors;
};

describe("parsePrinters", () => {
  it("reads an unset or empty variable as no printers", () => {
    for (const raw of [undefined, "", "  "]) {
      const r = parsePrinters(raw);
      expect(r.ok && r.printers.size).toBe(0);
    }
  });

  it("defaults the port to 9100 and the name to the id", () => {
    const r = parsePrinters('[{"id":"dock","host":"10.0.0.5"},{"id":"lab","name":"Lab ZD230","host":"zd230.lan","port":6101}]');
    expect(r.ok && [...r.printers.values()]).toEqual([
      { id: "dock", name: "dock", host: "10.0.0.5", port: 9100 },
      { id: "lab", name: "Lab ZD230", host: "zd230.lan", port: 6101 },
    ]);
  });

  it("refuses text that is not JSON and JSON that is not a list", () => {
    expect(errorsOf("dock=10.0.0.5")).toEqual(["not JSON"]);
    expect(errorsOf('{"id":"dock","host":"10.0.0.5"}')[0]).toMatch(/^printers: /);
  });

  it("names the entry and the field it refuses", () => {
    expect(errorsOf('[{"id":"dock","host":"10.0.0.5"},{"id":"a b","host":"10.0.0.6"}]')[0]).toMatch(/^1[.]id: /);
    expect(errorsOf('[{"id":"dock","host":"http://10.0.0.5"}]')[0]).toMatch(/^0[.]host: /);
    expect(errorsOf('[{"id":"dock","host":"10.0.0.5 "}]')[0]).toMatch(/^0[.]host: /);
    expect(errorsOf('[{"id":"dock","host":"10.0.0.5","port":0}]')[0]).toMatch(/^0[.]port: /);
    expect(errorsOf('[{"id":"dock"}]')[0]).toMatch(/^0[.]host: /);
  });

  it("refuses a host with a port and accepts an IPv6 address", () => {
    expect(errorsOf('[{"id":"dock","host":"10.0.0.5:9100"}]')[0]).toMatch(/^0[.]host: /);
    const r = parsePrinters('[{"id":"dock","host":"fe80::1"}]');
    expect(r.ok && r.printers.get("dock")?.host).toBe("fe80::1");
  });

  it("refuses a key it does not know", () => {
    expect(errorsOf('[{"id":"dock","host":"10.0.0.5","adress":"x"}]')[0]).toContain("adress");
  });

  it("refuses an id that is listed twice", () => {
    expect(errorsOf('[{"id":"dock","host":"10.0.0.5"},{"id":"dock","host":"10.0.0.6"}]')).toEqual(['printer id "dock" is listed twice']);
  });
});
