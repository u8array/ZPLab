import { describe, expect, it, vi } from "vitest";
import type { OwedReply } from "@zplab/core/lib/documentReplies";
import { ETX, STX, ZD230_HI, ZD230_HS, ZD230_HW } from "@zplab/core/lib/hostStatus.fixture";
import { fallbackTranslations as en } from "../locales";
import { DOCUMENT_DEADLINE_MS, queryDocument } from "./printerDocumentQuery";
import { documentReply } from "./printerDocumentQuery.testkit";
import type * as PrinterQuery from "./printerQuery";
import { documentReplyLines } from "./printerStatusText";
import { formatTemplate } from "./formatTemplate";

const readPrinterReply = vi.fn<typeof PrinterQuery.readPrinterReply>();
vi.mock("./printerQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof PrinterQuery>()),
  readPrinterReply: (...args: Parameters<typeof PrinterQuery.readPrinterReply>) => readPrinterReply(...args),
}));
const came = (body: string, unanswered: OwedReply[] = []) => readPrinterReply.mockResolvedValue({ kind: "ok", value: { body, unanswered } });

const TARGET = { kind: "network", host: "172.17.17.175", port: 9100 } as const;
const loc = en.printerSettings.printerStatus;

const HI = `${ZD230_HI}\r\n`;
const HS = `${ZD230_HS}\r\n`;

describe("queryDocument", () => {
  it("sends the document unchanged, waits with the stop signal, and interprets the replies its commands earned", async () => {
    // The identity line sits behind the status strings.
    came(`${HS}${HI}${ZD230_HW}`);
    const document = "^XA~HS~HI^HWR:*.*^FO10,10^FDx^FS^XZ";
    const signal = new AbortController().signal;
    const res = await queryDocument(TARGET, document, signal);
    expect(readPrinterReply).toHaveBeenCalledWith(TARGET, document, { signal, deadlineMs: DOCUMENT_DEADLINE_MS, awaited: [] });
    if (res.kind !== "ok") throw new Error(res.kind);
    expect(res.value.unanswered).toEqual([]);
    expect(res.value.parsed.identity?.model).toBe("ZD230-200dpi");
    expect(res.value.parsed.status?.labelLengthDots).toBe(892);
    expect(res.value.parsed.directories?.[0]?.objects).toHaveLength(1);
    expect(res.value.raw).toContain("ZD230-200dpi,V89.21.46Z");
    expect(res.value.raw).not.toContain(STX);
  });

  it("hands the reader the replies the document earns, and passes the owed ones through", async () => {
    came(`${HS}HEADER 4711 END`, [{ commands: ["^HV1,20,HEADER ,END,L"], missing: 1, of: 2 }]);
    const document = "^XA~HS^FN1^FD1^FS^HV1,20,HEADER ,END,L^PQ2^XZ";
    const res = await queryDocument(TARGET, document);
    expect(readPrinterReply).toHaveBeenLastCalledWith(TARGET, document, {
      signal: undefined,
      deadlineMs: DOCUMENT_DEADLINE_MS,
      awaited: [{ header: "HEADER ", terminator: "END", count: 2, commands: ["^HV1,20,HEADER ,END,L"] }],
    });
    if (res.kind !== "ok") throw new Error(res.kind);
    expect(res.value.unanswered).toEqual([{ commands: ["^HV1,20,HEADER ,END,L"], missing: 1, of: 2 }]);
    expect(res.value.parsed.status).toBeDefined();
    expect(res.value.raw).toContain("HEADER 4711 END");
  });

  it("keeps the owed replies in view when a stopped read got nothing or only a frame", async () => {
    for (const body of ["", `${STX}${ETX}`]) {
      came(body, [{ commands: ["^HV1,20,H,E"], missing: 1, of: 1 }]);
      const res = await queryDocument(TARGET, "^XA^FN1^FD1^FS^HV1,20,H,E^XZ");
      expect(res).toEqual({ kind: "ok", value: documentReply({ unanswered: [{ commands: ["^HV1,20,H,E"], missing: 1, of: 1 }] }) });
    }
  });

  it("leaves a parser out where the document never asked it", async () => {
    came(HS);
    const res = await queryDocument(TARGET, "^XA~HS^XZ");
    if (res.kind !== "ok") throw new Error(res.kind);
    expect(res.value.parsed.status).toBeDefined();
    expect(res.value.parsed.identity).toBeUndefined();
    expect(res.value.parsed.directories).toBeUndefined();
  });

  it("hands the ^HH echo back as the raw reply", async () => {
    came(`${STX}DARKNESS\r\n+10.0\r\n${ETX}`);
    const res = await queryDocument(TARGET, "^XA^HH^XZ");
    if (res.kind !== "ok") throw new Error(res.kind);
    expect(res.value.parsed).toEqual({});
    expect(res.value.configuration).toBe(true);
    expect(res.value.raw).toBe("DARKNESS\r\n+10.0");
  });

  it("tells a silent printer apart and hands a transport failure straight back", async () => {
    readPrinterReply.mockResolvedValue({ kind: "silent" });
    expect(await queryDocument(TARGET, "^XA~HU^XZ")).toEqual({ kind: "silent" });
    readPrinterReply.mockResolvedValue({ kind: "refused", port: 9100 });
    expect(await queryDocument(TARGET, "^XA~HS^XZ")).toEqual({ kind: "refused", port: 9100 });
  });
});

describe("documentReplyLines", () => {
  it("names the state, the model and the listed objects", async () => {
    came(`${HI}${HS}${ZD230_HW}`);
    const res = await queryDocument(TARGET, "^XA~HI~HS^HWR:*.*^XZ");
    if (res.kind !== "ok") throw new Error(res.kind);
    const lines = documentReplyLines(en.printerSettings.printerStatus, en.printerSettings.objects, res.value);
    expect(lines[0]).toBe(loc.ready);
    expect(lines).toContain(`${loc.model}: ZD230-200dpi V89.21.46Z`);
    expect(lines).toContain("R:PRE.GRF");
    expect(lines.at(-1)).toBe(formatTemplate(en.printerSettings.objects.usageFmt, { device: "R", used: "49", free: "7292" }));
  });

  it("stays empty where no parser read anything", () => {
    expect(documentReplyLines(en.printerSettings.printerStatus, en.printerSettings.objects, documentReply({ raw: "x" }))).toEqual([]);
  });
});
