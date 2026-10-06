import { describe, it, expect } from "vitest";
import { hostStatusAnswers, parseHostIdentification, parseHostMemory, parseHostQueryStatus, parseHostStatus, printerReadiness } from "./hostStatus";

const STX = "\u0002";
const ETX = "\u0003";

describe("host replies", () => {
  it("reads the identity line of ~HI", () => {
    expect(parseHostIdentification("ZD230,V89.21.46Z,8,4096KB,\r\n")).toEqual({
      model: "ZD230",
      firmware: "V89.21.46Z",
      dpmm: 8,
      memoryKb: 4096,
      options: "",
    });
    expect(parseHostIdentification("XXXXXX,V1.0.0,dpm,000KB,X")?.dpmm).toBeUndefined();
    expect(parseHostIdentification("ZD230,V1.0,8,4096KB,X\rZZZ,V2,6,1024KB,")?.options).toBe("X");
    expect(parseHostIdentification("")).toBeUndefined();
  });

  it("reads the two state strings of ~HS behind their control bytes", () => {
    const body = `${STX}030,0,1,1200,002,0,0,0,000,0,0,0${ETX}\r\n${STX}001,0,1,0,1,2,0,0,00000005,1,003${ETX}\r\n${STX}1234,0${ETX}\r\n`;
    expect(parseHostStatus(body)).toEqual({
      paperOut: false,
      paused: true,
      labelLengthDots: 1200,
      formatsInBuffer: 2,
      bufferFull: false,
      diagnosticMode: false,
      partialFormat: false,
      corruptRam: false,
      underTemperature: false,
      overTemperature: false,
      headUp: true,
      ribbonOut: false,
      thermalTransfer: true,
      printMode: 2,
      labelWaiting: false,
      labelsRemaining: 5,
      graphicsStored: 3,
    });
    expect(parseHostStatus(`${STX}030,0,1${ETX}`)).toBeUndefined();
  });

  it("maps every ~HS flag to its own field", () => {
    const body = "030,1,0,1200,002,1,1,1,000,1,1,1\n001,0,0,1,0,3,0,1,00000010,1,007";
    expect(parseHostStatus(body)).toMatchObject({
      paperOut: true,
      paused: false,
      bufferFull: true,
      diagnosticMode: true,
      partialFormat: true,
      corruptRam: true,
      underTemperature: true,
      overTemperature: true,
      headUp: false,
      ribbonOut: true,
      thermalTransfer: false,
      printMode: 3,
      labelWaiting: true,
      labelsRemaining: 10,
      graphicsStored: 7,
    });
  });

  it("finds the state strings behind a banner line and after bare carriage returns", () => {
    const strings = "030,0,0,1200,000,0,0,0,000,0,0,0\r001,0,0,0,1,2,0,0,00000000,1,000\r";
    expect(parseHostStatus(`PRINTER STATUS\n${strings}`)?.printMode).toBe(2);
    expect(parseHostStatus(`a,b,c,d,e,f,g,h,i,j,k\n${strings}`)?.printMode).toBe(2);
  });

  it("reads the memory line of ~HM", () => {
    expect(parseHostMemory("1024,0780,0780")).toEqual({ totalKb: 1024, maxKb: 780, availableKb: 780 });
    expect(parseHostMemory("1024")).toBeUndefined();
  });

  it("decodes the guide's ~HQES example into media out, head open and a printhead to clean", () => {
    const body = `${STX}PRINTER STATUS\r\nERRORS:   1 00000000 00000005\r\nWARNINGS: 1 00000000 00000002${ETX}`;
    expect(parseHostQueryStatus(body)).toEqual({ errors: ["mediaOut", "headOpen"], warnings: ["cleanPrinthead"] });
    expect(parseHostQueryStatus("ERRORS: 0 00000000 00000000\nWARNINGS: 0 00000000 00000000")).toEqual({ errors: [], warnings: [] });
    expect(parseHostQueryStatus("PRINTER STATUS")).toBeUndefined();
  });

  it("reads flags from the nibbles above the first", () => {
    expect(parseHostQueryStatus("ERRORS: 1 00000000 00010280\nWARNINGS: 1 00000000 00000005")).toEqual({
      errors: ["printheadDetectionError", "printheadThermistorOpen", "paused"],
      warnings: ["needToCalibrateMedia", "replacePrinthead"],
    });
  });

  it("keeps an unknown condition visible instead of reporting all clear", () => {
    expect(parseHostQueryStatus("ERRORS: 1 00000000 00100000\nWARNINGS: 1 00000000 00000008")).toEqual({
      errors: ["otherError"],
      warnings: ["otherWarning"],
    });
    expect(parseHostQueryStatus("ERRORS: 1 00000001 00000000\nWARNINGS: 0 00000000 00000000")).toEqual({
      errors: ["otherError"],
      warnings: [],
    });
    expect(parseHostQueryStatus("ERRORS: 1 00000001 00000005\nWARNINGS: 0 00000000 00000000")).toEqual({
      errors: ["mediaOut", "headOpen", "otherError"],
      warnings: [],
    });
  });

  it("folds the flags and the status strings into one list of blocking conditions", () => {
    const status = parseHostStatus("030,1,1,1200,000,0,0,0,000,1,0,0\n001,0,1,0,1,2,0,0,00000000,1,000");
    const flags = { errors: ["mediaOut" as const], warnings: ["cleanPrinthead" as const] };
    expect(printerReadiness(flags, status)).toEqual({
      conditions: ["mediaOut", "headOpen", "paused", "corruptRam"],
      warnings: ["cleanPrinthead"],
      known: true,
    });
    expect(printerReadiness({ errors: [], warnings: [] }, undefined)).toEqual({ conditions: [], warnings: [], known: true });
    expect(printerReadiness(undefined, status)).toEqual({ conditions: ["mediaOut", "headOpen", "paused", "corruptRam"], warnings: [], known: true });
    expect(printerReadiness(undefined, undefined).known).toBe(false);
  });

  it("knows when ~HS would stay silent", () => {
    expect(hostStatusAnswers({ errors: [], warnings: ["cleanPrinthead"] })).toBe(true);
    expect(hostStatusAnswers({ errors: ["cutterFault"], warnings: [] })).toBe(true);
    expect(hostStatusAnswers({ errors: ["headOpen"], warnings: [] })).toBe(false);
  });
});
