import { describe, expect, it, vi } from "vitest";
import { ETX, STX, ZD230_HI, ZD230_HS, ZD230_HW } from "@zplab/core/lib/hostStatus.fixture";
import { fallbackTranslations as en } from "../locales";
import { queryDocument } from "./printerDocumentQuery";
import type * as PrinterQuery from "./printerQuery";
import { documentReplyLines } from "./printerStatusText";
import { formatTemplate } from "./formatTemplate";

const queryPrinter = vi.fn<typeof PrinterQuery.queryPrinter>();
vi.mock("./printerQuery", async (importOriginal) => ({ ...(await importOriginal<typeof PrinterQuery>()), queryPrinter: (...args: Parameters<typeof PrinterQuery.queryPrinter>) => queryPrinter(...args) }));

const TARGET = { kind: "network", host: "172.17.17.175", port: 9100 } as const;
const loc = en.printerSettings.printerStatus;

const HI = `${ZD230_HI}\r\n`;
const HS = `${ZD230_HS}\r\n`;

describe("queryDocument", () => {
  it("sends the document unchanged and interprets the replies its commands earned", async () => {
    // The identity line sits behind the status strings.
    queryPrinter.mockResolvedValue({ kind: "ok", value: `${HS}${HI}${ZD230_HW}` });
    const document = "^XA~HS~HI^HWR:*.*^FO10,10^FDx^FS^XZ";
    const res = await queryDocument(TARGET, document, ["~HS", "~HI", "^HW"]);
    expect(queryPrinter).toHaveBeenCalledWith(TARGET, document);
    if (res.kind !== "ok") throw new Error(res.kind);
    expect(res.value.commands).toEqual(["~HS", "~HI", "^HW"]);
    expect(res.value.parsed.identity?.model).toBe("ZD230");
    expect(res.value.parsed.status?.labelLengthDots).toBe(892);
    expect(res.value.parsed.directories?.[0]?.objects).toHaveLength(1);
    expect(res.value.raw).toContain("ZD230,V89.21.46Z");
    expect(res.value.raw).not.toContain(STX);
  });

  it("leaves a parser out where the document never asked it", async () => {
    queryPrinter.mockResolvedValue({ kind: "ok", value: HS });
    const res = await queryDocument(TARGET, "^XA~HS^XZ", ["~HS"]);
    if (res.kind !== "ok") throw new Error(res.kind);
    expect(res.value.parsed.status).toBeDefined();
    expect(res.value.parsed.identity).toBeUndefined();
    expect(res.value.parsed.directories).toBeUndefined();
  });

  it("hands the ^HH echo back as the raw reply", async () => {
    queryPrinter.mockResolvedValue({ kind: "ok", value: `${STX}DARKNESS\r\n+10.0\r\n${ETX}` });
    const res = await queryDocument(TARGET, "^XA^HH^XZ", ["^HH"]);
    if (res.kind !== "ok") throw new Error(res.kind);
    expect(res.value.parsed).toEqual({});
    expect(res.value.configuration).toBe(true);
    expect(res.value.raw).toBe("DARKNESS\r\n+10.0");
  });

  it("tells a silent printer apart and hands a transport failure straight back", async () => {
    queryPrinter.mockResolvedValue({ kind: "silent" });
    expect(await queryDocument(TARGET, "^XA~HU^XZ", ["~HU"])).toEqual({ kind: "silent" });
    queryPrinter.mockResolvedValue({ kind: "ok", value: `${STX}${ETX}` });
    expect(await queryDocument(TARGET, "^XA~HU^XZ", ["~HU"])).toEqual({ kind: "silent" });
    queryPrinter.mockResolvedValue({ kind: "refused", port: 9100 });
    expect(await queryDocument(TARGET, "^XA~HS^XZ", ["~HS"])).toEqual({ kind: "refused", port: 9100 });
  });
});

describe("documentReplyLines", () => {
  it("names the state, the model and the listed objects", async () => {
    queryPrinter.mockResolvedValue({ kind: "ok", value: `${HI}${HS}${ZD230_HW}` });
    const res = await queryDocument(TARGET, "^XA~HI~HS^HWR:*.*^XZ", ["~HI", "~HS", "^HW"]);
    if (res.kind !== "ok") throw new Error(res.kind);
    const lines = documentReplyLines(en.printerSettings.printerStatus, en.printerSettings.objects, res.value);
    expect(lines[0]).toBe(loc.ready);
    expect(lines).toContain(`${loc.model}: ZD230 V89.21.46Z`);
    expect(lines).toContain("R:PRE.GRF");
    expect(lines.at(-1)).toBe(formatTemplate(en.printerSettings.objects.usageFmt, { device: "R", used: "49", free: "7292" }));
  });

  it("stays empty where no parser read anything", () => {
    expect(documentReplyLines(en.printerSettings.printerStatus, en.printerSettings.objects, { raw: "x", commands: ["^HF"], configuration: false, parsed: {} })).toEqual([]);
  });
});
