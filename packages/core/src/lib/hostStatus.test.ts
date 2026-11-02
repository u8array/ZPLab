import { describe, it, expect } from "vitest";
import { ETX, STX, ZD230_HI, ZD230_HS } from "./hostStatus.fixture";
import { hostStatusAnswers, leavesFrameOpen, outsideFrames, parseHostIdentification, parseHostMemory, parseHostQueryStatus, parseHostStatus, printerReadiness, repliesIn, scanReplies } from "./hostStatus";

describe("host replies", () => {
  it("reads the identity line of ~HI", () => {
    expect(parseHostIdentification(`${ZD230_HI}\r\n`)).toEqual({
      model: "ZD230-200dpi",
      firmware: "V89.21.46Z",
      dpmm: 8,
      memoryKb: 8176,
      options: "",
    });
    expect(parseHostIdentification("XXXXXX,V1.0.0,dpm,000KB,X")?.dpmm).toBeUndefined();
    expect(parseHostIdentification("ZD230,V1.0,8,4096KB,X\rZZZ,V2,6,1024KB,")?.options).toBe("X");
    expect(parseHostIdentification("")).toBeUndefined();
    expect(parseHostIdentification("ZQ520,89.21.46Z,8,4096,X")).toEqual({ model: "ZQ520", firmware: "89.21.46Z", dpmm: 8, memoryKb: 4096, options: "X" });
    // A lone ~HS string or memory line is not an identity.
    expect(parseHostIdentification("030,0,0,0892,000,0,0,0,000,0,0,0")).toBeUndefined();
    expect(parseHostIdentification("4096,2048,1500")).toBeUndefined();
  });

  it("finds the identity line behind the ~HS strings of the same reply", () => {
    expect(parseHostIdentification(`${ZD230_HS}\r\n${ZD230_HI}`)).toEqual({
      model: "ZD230-200dpi",
      firmware: "V89.21.46Z",
      dpmm: 8,
      memoryKb: 8176,
      options: "",
    });
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
    expect(parseHostMemory("1024,0800,0696,0")).toEqual({ totalKb: 1024, maxKb: 800, availableKb: 696 });
    expect(parseHostMemory("1024")).toBeUndefined();
    // A lone ~HS string is not memory.
    expect(parseHostMemory("030,0,0,0892,000,0,0,0,000,0,0,0")).toBeUndefined();
  });

  it("finds the memory line behind the ~HS strings of the same reply", () => {
    expect(parseHostMemory(`${ZD230_HS}\r\n4096,2048,1500`)).toEqual({ totalKb: 4096, maxKb: 2048, availableKb: 1500 });
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

describe("outsideFrames and repliesIn", () => {
  it("keeps the text outside the frames, and nothing of a frame still open", () => {
    expect(outsideFrames(`A${STX}030,0${ETX}B${STX}1,2${ETX}C`)).toBe("ABC");
    expect(outsideFrames(`A${STX}HEADER x END`)).toBe("A");
    expect(outsideFrames(`A${ETX}B`)).toBe(`A${ETX}B`);
    expect(outsideFrames("")).toBe("");
  });

  it("counts a header and terminator pair once, a lone mark per occurrence, never overlapping, and nothing for no marks", () => {
    expect(repliesIn("A x END A y END", { header: "A", terminator: "END" })).toBe(2);
    expect(repliesIn("A x END A y", { header: "A", terminator: "END" })).toBe(1);
    expect(repliesIn("END END", { header: "", terminator: "END" })).toBe(2);
    expect(repliesIn("ENDEND", { header: "", terminator: "END" })).toBe(2);
    expect(repliesIn("AA", { header: "A", terminator: "A" })).toBe(1);
    expect(repliesIn("", { header: "A", terminator: "" })).toBe(0);
    expect(repliesIn("anything", { header: "", terminator: "" })).toBe(0);
  });

  it("scans from the start or from behind a header, and says where it stopped", () => {
    const marks = { header: "A", terminator: "END" };
    expect(scanReplies("A x END A y", marks)).toEqual({ count: 1, afterHeader: true, at: 9 });
    expect(scanReplies("A x END", marks)).toEqual({ count: 1, afterHeader: false, at: 7 });
    expect(scanReplies("x END", marks, true)).toEqual({ count: 1, afterHeader: false, at: 5 });
    expect(scanReplies("ENDEND", { header: "", terminator: "END" })).toEqual({ count: 2, afterHeader: true, at: 6 });
    expect(scanReplies("AA", { header: "A", terminator: "" })).toEqual({ count: 2, afterHeader: false, at: 2 });
    expect(scanReplies("x", { header: "", terminator: "" })).toEqual({ count: 0, afterHeader: false, at: 0 });
  });

  it("knows a frame left open, and reads the next text from inside one", () => {
    expect(leavesFrameOpen(`A${STX}B`)).toBe(true);
    expect(leavesFrameOpen(`A${STX}B${ETX}C`)).toBe(false);
    expect(leavesFrameOpen(`${ETX}A`)).toBe(false);
    expect(outsideFrames(`x${ETX}y${STX}z`, true)).toBe("y");
    expect(outsideFrames("xy", true)).toBe("");
  });
});
