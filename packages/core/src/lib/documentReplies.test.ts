import { describe, expect, it } from "vitest";
import { documentReplies, owedReplies, MAX_REPLY_GROUPS, repliesIn, scanReplies } from "./documentReplies";
import { outsideFrames } from "./hostStatus";
import { ETX, STX } from "./hostStatus.fixture";

const commandsOf = (zpl: string): string[] => documentReplies(zpl).commands;
const NOTHING = { commands: [], awaited: [], unmarked: [], ambiguous: [], uncounted: [] };

describe("documentReplies commands", () => {
  it("accepts only the prefix the catalog spells", () => {
    expect(commandsOf("^XA~HS^HW^XZ")).toEqual(["~HS", "^HW"]);
    expect(commandsOf("^XA^HS~HW^FO10,10^XZ")).toEqual([]);
  });

  it("names every spelling once, in the order the printer meets them", () => {
    expect(commandsOf("^XA^HW R:*.*^FO10,10^FDx^FS~HS^HH~HS^XZ")).toEqual(["^HWR:*.*", "~HS", "^HH"]);
    expect(commandsOf("^XA~HQES~HQHA~HQES^XZ")).toEqual(["~HQES", "~HQHA"]);
  });

  it("is empty for a document that only prints", () => {
    expect(commandsOf("^XA^FO10,10^A0N,20,20^FDHS^FS^XZ")).toEqual([]);
  });

  // ^HW is a format command, so inside field data it is data, while an immediate ~HS acts anywhere.
  it("leaves a tilde the firmware does not intercept as field data", () => {
    expect(commandsOf("^XA^FO10,10^FDsend ~HW the drive^FS^XZ")).toEqual([]);
  });

  it("counts an immediate host command inside field data", () => {
    expect(commandsOf("^XA^FO10,10^FDbefore ~HS after^FS^XZ")).toEqual(["~HS"]);
  });

  it("asks a format command stored behind a ^DF only where the same bytes recall the frame", () => {
    const frame = "^XA^DFR:A.ZPL^FS^FO10,10^A0N,20,20^FN1^FS^HWR:*.*^HV1,20,H,E,F~HS^XZ";
    expect(commandsOf(frame)).toEqual(["~HS"]);
    expect(commandsOf(`${frame}^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ`)).toEqual(["~HS", "^HWR:*.*", "^HV1,20,H,E,F"]);
    expect(commandsOf(`${frame}^XA^XFR:B.ZPL^FS^XZ`)).toEqual(["~HS"]);
    expect(commandsOf("^XA^HWR:*.*^DFR:A.ZPL^FS^XZ")).toEqual(["^HWR:*.*"]);
    expect(commandsOf("^XA^FO10,10^FDx^FS^DFR:A.ZPL^FS^HWR:*.*^XZ")).toEqual([]);
  });

  it("resolves a recall like the printer: the device search order, a defaulted extension, and no match for another named device", () => {
    expect(commandsOf("^XA^DFE:A.ZPL^FS^FN1^FS^HWR:*.*^XZ^XA^XFA.ZPL^FS^FN1^FDx^FS^XZ")).toEqual(["^HWR:*.*"]);
    expect(commandsOf("^XA^DFR:A.ZPL^FS^FN1^FS^HWR:*.*^XZ^XA^XFR:A^FS^FN1^FDx^FS^XZ")).toEqual(["^HWR:*.*"]);
    expect(commandsOf("^XA^DFE:A.ZPL^FS^FN1^FS^HWR:*.*^XZ^XA^XFR:A.ZPL^FS^FN1^FDx^FS^XZ")).toEqual([]);
  });

  it("keeps a recall inside a stored frame for that frame's own recall, in either declaration order, through a chain and past a cycle", () => {
    const storeA = "^XA^DFR:A.ZPL^FS^FO10,10^A0N,20,20^FN1^FS^HWR:*.*^XZ";
    const storeB = "^XA^DFR:B.ZPL^FS^XFR:A.ZPL^FS^HT^XZ";
    expect(commandsOf(storeA + storeB)).toEqual([]);
    expect(commandsOf(storeA + storeB + "^XA^XFR:B.ZPL^FS^XZ")).toEqual(["^HWR:*.*", "^HT"]);
    expect(commandsOf(storeB + storeA + "^XA^XFR:B.ZPL^FS^XZ")).toEqual(["^HWR:*.*", "^HT"]);
    const storeC = "^XA^DFR:C.ZPL^FS^XFR:B.ZPL^FS^HH^XZ";
    expect(commandsOf(storeA + storeB + storeC + "^XA^XFR:C.ZPL^FS^XZ")).toEqual(["^HWR:*.*", "^HT", "^HH"]);
    const self = "^XA^DFR:S.ZPL^FS^HWE:*.*^XFR:S.ZPL^FS^XZ";
    expect(commandsOf(self + "^XA^XFR:S.ZPL^FS^XZ")).toEqual(["^HWE:*.*"]);
  });

  it("names the frame after the first usable ^DF, a later one being stored text", () => {
    const block = "^XA^DFR:A.ZPL^FS^HZA^FS^DFR:B.ZPL^FS^HH^FS^XZ";
    expect(commandsOf(block + "^XA^XFR:B.ZPL^FS^XZ")).toEqual([]);
    expect(commandsOf(block + "^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HZA", "^HH"]);
  });

  it("answers a format command only inside an open format, an immediate one anywhere", () => {
    expect(commandsOf("^HWR:*.*^XA^FO10,10^FDx^FS^XZ")).toEqual([]);
    expect(commandsOf("^XA^FO10,10^FDx^FS^XZ^HWR:*.*")).toEqual([]);
    expect(commandsOf("^XA^FO10,10^FDx^FS^XZ~HS")).toEqual(["~HS"]);
    expect(commandsOf("^HWR:*.*")).toEqual([]);
    expect(commandsOf("^XA^DFR:A.ZPL^FS^HWR:*.*^XZ^XFR:A.ZPL")).toEqual([]);
  });

  it("follows a ^CT remap to the new tilde char", () => {
    expect(commandsOf("^XA^CT/^FS/HS^XZ")).toEqual(["~HS"]);
    expect(commandsOf("^XA^CT/^FS~HS^XZ")).toEqual([]);
  });

  it("follows a ^CC remap to the new caret char", () => {
    expect(commandsOf("^XA^CC//HWR:*.*//XZ")).toEqual(["^HWR:*.*"]);
  });
});


const awaited = (zpl: string) => documentReplies(zpl).awaited;
const one = (command: string, header: string, terminator: string, count = 1) => [{ header, terminator, count, commands: [command] }];

describe("documentReplies", () => {
  it("counts a reply per format, and per label through the format's ^PQ", () => {
    expect(awaited("^XA^FN1^FDx^FS^HV1,20,H,E,F^PQ3^XZ")).toEqual(one("^HV1,20,H,E,F", "H", "E"));
    expect(awaited("^XA^FN1^FDx^FS^HV1,20,,END,L^PQ3^XZ")).toEqual(one("^HV1,20,,END,L", "", "END", 3));
    expect(awaited("^XA^PQ2^FN1^FDx^FS^HV1,20,H^XZ^XA^FN1^FDy^FS^HV1,20,H^XZ")).toEqual(one("^HV1,20,H", "H", "", 2));
  });

  it("counts a stored ^HV once per recall, each with the labels its recall prints", () => {
    const frame = "^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E,L^XZ";
    expect(documentReplies(frame)).toEqual(NOTHING);
    expect(awaited(`${frame}^XA^XFR:A.ZPL^FS^FN1^FDa^FS^PQ2^XZ^XA^XFR:A.ZPL^FS^FN1^FDb^FS^XZ`)).toEqual(one("^HV1,20,H,E,L", "H", "E", 3));
  });

  it("names a bare ^HV as unmarked and leaves the other host commands out of the awaited replies", () => {
    expect(documentReplies("^XA~HS^HWR:*.*^HV1,20^XZ")).toEqual({ commands: ["~HS", "^HWR:*.*", "^HV1,20"], awaited: [], unmarked: ["^HV1,20"], ambiguous: [], uncounted: [] });
  });

  it("asks nothing for a ^HV outside a format", () => {
    expect(documentReplies("^HV1,20,H,E^XA^FDx^FS^XZ")).toEqual(NOTHING);
  });

  it("counts a ^HV under a ^CC remap", () => {
    expect(awaited("^XA^CC#^FN1^FDx^FS#HV1,20,H,E,F#PQ2#XZ")).toEqual(one("^HV1,20,H,E,F", "H", "E"));
    expect(awaited("^XA^CC#^FN1^FDx^FS#HV1,20,H,E,L#PQ2#XZ")).toEqual(one("^HV1,20,H,E,L", "H", "E", 2));
  });

  it("tells no groups apart past the cap, where the seam check would hold the dialog", () => {
    const doc = (groups: number) => `^XA^FN1^FDa^FS${Array.from({ length: groups }, (_, i) => `^HV1,20,H${i}x,E${i}y,F`).join("")}^XZ`;
    expect(documentReplies(doc(MAX_REPLY_GROUPS)).ambiguous).toEqual([]);
    expect(documentReplies(doc(MAX_REPLY_GROUPS + 1)).ambiguous).toHaveLength(MAX_REPLY_GROUPS + 1);
  });

  it("names the ^HV a reader would miscount as ambiguous, and keeps the rest apart", () => {
    const ambiguous = (zpl: string) => documentReplies(zpl).ambiguous;
    expect(ambiguous("^XA^FN1^FDa^FS^FN2^FDb^FS^HV1,5,Q,,F^HV2,5,,Q,F^XZ")).toEqual(["^HV1,5,Q,,F", "^HV2,5,,Q,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^HV1,5,A,T,F^HV2,5,B,T,F^HV3,5,,T,F^XZ")).toEqual(["^HV3,5,,T,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^HV1,5,[,],F^HV2,5,],[,F^XZ")).toEqual(["^HV1,5,[,],F", "^HV2,5,],[,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^HV1,5,X,,F^HV2,5,XY,,F^HV3,5,K,U,F^XZ")).toEqual(["^HV1,5,X,,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^HV1,5,H,E,F^HV2,5,K,U,F^HV2,5,H,E,F^XZ")).toEqual([]);
    // The guide's own pair shares a terminator behind distinct headers, which a reader counts right.
    expect(ambiguous("^XA^FH_^HV1,24,EPC[,]_0D_0A,F^FH_^HV2,24,TID[,]_0D_0A,F^XZ")).toEqual([]);
    expect(ambiguous("^XA^HV1,20,AB,CD,F^HV2,20,DA,,F^XZ")).toEqual(["^HV2,20,DA,,F"]);
    expect(ambiguous("^XA^HV1,20,QY,ZX,F^HV2,20,YZ,,F^XZ")).toEqual(["^HV2,20,YZ,,F"]);
    // The field data the document holds can read as a mark too, in the reply itself or in another group's.
    expect(ambiguous("^XA^FN1^FDEH^FS^HV1,20,H,E,F^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(ambiguous("^XA^FN1^FDWHEEL^FS^HV1,20,H,E,F^XZ")).toEqual([]);
    expect(ambiguous("^XA^FN1^FDH^FS^HV1,20,H,,F^XZ")).toEqual(["^HV1,20,H,,F"]);
    expect(ambiguous("^XA^FH_^FN1^FD_45H^FS^HV1,20,H,E,F^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^FN2^FDKxU^FS^HV1,5,K,U,F^HV2,5,A,B,F^XZ")).toEqual(["^HV1,5,K,U,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^FN2^FDK^FS^HV1,5,K,U,F^HV2,5,A,B,F^XZ")).toEqual([]);
    expect(ambiguous("^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E^XZ^XA^XFR:A.ZPL^FS^FN1^FDEH^FS^XZ")).toEqual(["^HV1,20,H,E"]);
    // Two replies in a row read differently from one, at the seam of a reply's tail and the next one's data.
    expect(ambiguous("^XA^PQ2^FN1^FDa|b^FS^HV1,20,|,|,L^XZ")).toEqual(["^HV1,20,|,|,L"]);
    expect(ambiguous("^XA^PQ2^FN1^FD#^FS^HV1,20,,##,L^XZ")).toEqual(["^HV1,20,,##,L"]);
    expect(ambiguous("^XA^FN1^FDx^FS^FN2^FDEND^FS^HV1,20,S,;^HV2,20,,;END^XZ")).toEqual(["^HV2,20,,;END"]);
    expect(ambiguous("^XA^FN1^FDEA\nB^FS^HV1,20,AB,E^XZ")).toEqual(["^HV1,20,AB,E"]);
    // A mark behind the reply's byte count never shows.
    expect(ambiguous("^XA^FN1^FDEH^FS^HV1,1,H,E,F^XZ")).toEqual([]);
    expect(ambiguous("^XA^FN1^FDEH^FS^HV1,2,H,E,F^XZ")).toEqual(["^HV1,2,H,E,F"]);
    expect(ambiguous(`^XA^FN1^FD${"x".repeat(64)}EH^FS^HV1,,H,E,F^XZ`)).toEqual([]);
    expect(ambiguous("^XA^DFR:A.ZPL^FS^FN1^FDEH^FS^HV1,20,H,E^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E"]);
    expect(ambiguous("^XA^DFR:A.ZPL^FS^FN1^FDEH^FS^HV1,20,H,E^XZ^XA^XFR:A.ZPL^FS^FN1^FDx^FS^XZ")).toEqual(["^HV1,20,H,E"]);
    // A frame byte in the data hides the terminator from a reader, unless the data closes the frame again.
    expect(ambiguous("^XA^FH_^FN1^FD_02x^FS^HV1,20,H,E^XZ")).toEqual(["^HV1,20,H,E"]);
    expect(ambiguous("^XA^FH_^FN1^FD_02x_03^FS^HV1,20,H,E^XZ")).toEqual([]);
    expect(ambiguous("^XA^FH_^FN1^FD_03x^FS^HV1,20,H,E^XZ")).toEqual([]);
  });

  it("names exactly the groups a reader would miscount in up to three replies in a row, over every small document", () => {
    const marks = ["", "a", "ab"];
    const data: [string, string][] = [["", ""], ["a", "a"], ["b", "b"], ["ab", "ab"], ["ba", "ba"], ["_02", STX], ["_02a_03", `${STX}a${ETX}`], ["_03", ETX]];
    interface Group {
      header: string;
      terminator: string;
      data: string[];
      commands: string[];
    }
    let checked = 0;
    for (const h1 of marks)
      for (const t1 of marks)
        for (const h2 of marks)
          for (const t2 of marks)
            for (const [d1, v1] of data)
              for (const [d2, v2] of data) {
                const zpl = `^XA^FH_^FN1^FD${d1}^FS^FH_^FN2^FD${d2}^FS^HV1,20,${h1},${t1},F^HV2,20,${h2},${t2},F^XZ`;
                const groups = new Map<string, Group>();
                for (const [n, header, terminator, value] of [[1, h1, t1, v1], [2, h2, t2, v2]] as const) {
                  if (header === "" && terminator === "") continue;
                  const group = groups.get(`${header},${terminator}`) ?? { header, terminator, data: [], commands: [] };
                  if (!group.data.includes(value)) group.data.push(value);
                  group.commands.push(`^HV${n},20,${header},${terminator},F`);
                  groups.set(`${header},${terminator}`, group);
                }
                const all = [...groups.values()];
                const parts = all.flatMap((group) => [group.header + group.terminator, ...group.data.map((d) => group.header + d + group.terminator)].map((text) => ({ group, text })));
                const own = (group: Group, ...parts: { group: Group }[]) => parts.filter((part) => part.group === group).length;
                const runs = parts.flatMap((p) => [[p], ...parts.flatMap((q) => [[p, q], ...parts.map((r) => [p, q, r])])]);
                const expected = all.filter((group) => runs.some((run) => repliesIn(outsideFrames(run.map((part) => part.text).join("")), group) !== own(group, ...run))).flatMap((group) => group.commands);
                expect(documentReplies(zpl).ambiguous, zpl).toEqual(expected);
                checked += 1;
              }
    expect(checked).toBe(marks.length ** 4 * data.length ** 2);
  });

  it("vouches for no ^HV where the document recalls a frame it does not hold, which may count, fill or ask on its own", () => {
    const recall = "^XA^XFR:A.ZPL^FS^FN1^FDx^FS^HV1,20,H,E,L^XZ";
    expect(documentReplies(recall)).toMatchObject({ awaited: [], uncounted: ["^HV1,20,H,E,L"] });
    expect(documentReplies("^XA^XFR:A.ZPL^FS^HV1,20,H,,F^XZ")).toMatchObject({ awaited: [], uncounted: ["^HV1,20,H,,F"] });
    // The frame may answer with marks of its own, so a format that recalls nothing is not vouched for either.
    expect(documentReplies("^XA^XFR:A.ZPL^FS^XZ^XA^FN1^FDx^FS^HV1,20,Z,,F^XZ")).toMatchObject({ awaited: [], uncounted: ["^HV1,20,Z,,F"] });
    expect(documentReplies("^XA^DFR:K.ZPL^FS^XFR:U.ZPL^FS^PQ3^XZ^XA^XFR:K.ZPL^FS^FN1^FDx^FS^HV1,20,H,E,L^XZ")).toMatchObject({ awaited: [], uncounted: ["^HV1,20,H,E,L"] });
    // A frame stored behind its recall lies on the printer at the recall, if anywhere.
    expect(documentReplies(`${recall}^XA^DFR:A.ZPL^FS^PQ3^XZ`)).toMatchObject({ awaited: [], uncounted: ["^HV1,20,H,E,L"] });
    expect(documentReplies(`^XA^DFR:A.ZPL^FS^PQ3^XZ${recall}`)).toMatchObject({ awaited: one("^HV1,20,H,E,L", "H", "E", 3), uncounted: [] });
    expect(documentReplies("^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^FN1^FDx^FS^XZ")).toMatchObject({ awaited: one("^HV1,20,H,E,F", "H", "E"), uncounted: [] });
  });

  it("vouches for no ^HV whose slot the printer fills at print time: ^SN, ^SF, ^FC, a reading ^RF, or any ^FD behind a ^RU", () => {
    const filled = (zpl: string) => documentReplies(zpl).uncounted;
    expect(filled("^XA^FN1^SN1,1,N^FS^HV1,20,1,,L^PQ2^XZ")).toEqual(["^HV1,20,1,,L"]);
    expect(filled("^XA^FN1^FDABCD1000^SF%%%%dddd,1^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(filled("^XA^FC%^FN1^FD%H:%M^FS^HV1,20,H,E^XZ")).toEqual(["^HV1,20,H,E"]);
    expect(filled("^XA^FN1^FD%H:%M^FC%^FS^HV1,20,H,E^XZ")).toEqual([]);
    expect(filled("^XA^RFR,H,0,8,2^FN1^FS^HV1,,8-byte Tag ID Data:^FS^XZ")).toEqual(["^HV1,,8-byte Tag ID Data:"]);
    expect(filled("^XA^RU^XZ^XA^FN1^FDSerial #H^FS^HV1,20,H,E^XZ")).toEqual(["^HV1,20,H,E"]);
    expect(filled("^XA^DFR:A.ZPL^FS^FN1^SN1,1,Y^FS^HV1,20,H,E,L^XZ^XA^XFR:A.ZPL^FS^PQ2^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(documentReplies("^XA^FN1^SN1,1,N^FS^HV1,20,1,,L^PQ2^XZ").awaited).toEqual([]);
    // A ^SN behind ^FS opens a field of its own.
    const vouched = "^XA^RFW,H^FN1^FDx^FS^FN2^SN1^FS^SN2^FS^HV1,20,H,E^XZ^XA^FN1^SN1^FS^XZ^XA^FN1^FDx^FS^HV1,20,H,E^XZ";
    expect(documentReplies(vouched)).toMatchObject({ awaited: one("^HV1,20,H,E", "H", "E", 2), uncounted: [] });
  });

  it("vouches for no ^HV whose field an ^FE ahead of its data splices other fields into, spec p.191", () => {
    const spliced = (zpl: string) => documentReplies(zpl).uncounted;
    expect(spliced("^XA^FN2^FDH^FS^FN1^FE#^FD#2#^FS^HV1,20,H,,L^PQ2^XZ")).toEqual(["^HV1,20,H,,L"]);
    expect(spliced("^XA^FN2^FDH^FS^FE#^FN1^FV#2#^FS^HV1,20,H,,L^PQ2^XZ")).toEqual(["^HV1,20,H,,L"]);
    expect(spliced("^XA^DFR:A.ZPL^FS^FN1^FE#^FS^HV1,20,H,,L^XZ^XA^XFR:A.ZPL^FS^FN2^FDH^FS^FN1^FD#2#^FS^PQ2^XZ")).toEqual(["^HV1,20,H,,L"]);
    expect(spliced("^XA^FN2^FDH^FS^FN1^FV^FE#^FD#2#^FS^HV1,20,H,,L^PQ2^XZ")).toEqual(["^HV1,20,H,,L"]);
    expect(documentReplies("^XA^FN2^FDH^FS^FN1^FD#2#^FE#^FS^HV1,20,H,E,L^PQ2^XZ")).toMatchObject({ awaited: one("^HV1,20,H,E,L", "H", "E", 2), uncounted: [] });
    expect(documentReplies("^XA^FN2^FDH^FS^FN1^FD#2#^FE#^FV^FS^HV1,20,H,,L^PQ2^XZ")).toMatchObject({ awaited: one("^HV1,20,H,,L", "H", "", 2), uncounted: [] });
    // Data counts as seen on either side of the ^FN, as the parser reads it.
    expect(documentReplies("^XA^FN2^FDH^FS^FD#2#^FN1^FE#^FS^HV1,20,H,,L^PQ2^XZ")).toMatchObject({ awaited: one("^HV1,20,H,,L", "H", "", 2), uncounted: [] });
  });

  it("counts no per-label ^HV in a format that reads, writes or locks the tag, since a void prints the label again, spec p.239 and p.434", () => {
    const voided = (zpl: string) => documentReplies(zpl).uncounted;
    expect(voided("^XA^RS8^RFW,H^FD1111^FS^FN1^FDx^FS^HV1,20,H,E,L^PQ1^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^RLP^FN1^FDx^FS^HV1,20,H,E,L^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^RU^XZ^XA^FN1^FDx^FS^HV1,20,H,E,L^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^RT2^FN1^FDx^FS^HV1,20,H,E,L^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^DFR:A.ZPL^FS^RFW,H^FD1111^FS^FN1^FS^HV1,20,H,E,L^XZ^XA^XFR:A.ZPL^FS^FN1^FDx^FS^PQ2^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E,L^XZ^XA^XFR:A.ZPL^FS^RFR,H,0,8,2^FN2^FS^FN1^FDx^FS^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(documentReplies("^XA^RS8^RFW,H^FD1111^FS^FN1^FDx^FS^HV1,20,H,E^PQ2^XZ")).toMatchObject({ awaited: one("^HV1,20,H,E", "H", "E", 1), uncounted: [] });
    expect(documentReplies("^XA^RS8^RB96,8,3,3,20,24,38^FN1^FDx^FS^HV1,20,H,E,L^PQ2^XZ")).toMatchObject({ awaited: one("^HV1,20,H,E,L", "H", "E", 2), uncounted: [] });
  });

  it("vouches for no ^HV whose field an ^RT or ^RI reads the tag into, RFID Programming Guide p.115 and Guide 2 p.76", () => {
    const read = (zpl: string) => documentReplies(zpl).uncounted;
    expect(read("^XA^RT1^HV1,20,H,,F^XZ")).toEqual(["^HV1,20,H,,F"]);
    expect(read("^XA^RI1^FN1^FS^HV1,20,H,E,F^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(read("^XA^RT^FN0^FS^HV0,20,H,E,F^XZ")).toEqual(["^HV0,20,H,E,F"]);
    expect(read("^XA^DFR:A.ZPL^FS^RT1^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(documentReplies("^XA^RT2^FN1^FDx^FS^HV1,20,H,E,F^XZ")).toMatchObject({ awaited: one("^HV1,20,H,E,F", "H", "E", 1), uncounted: [] });
  });

  it("numbers a bare ^FN 0 like the printer, spec p.200", () => {
    expect(documentReplies("^XA^FN^SN001,1^FS^HV0,20,H,E,F^XZ").uncounted).toEqual(["^HV0,20,H,E,F"]);
    expect(documentReplies("^XA^FN^FDH^FS^HV0,20,H,,F^XZ").ambiguous).toEqual(["^HV0,20,H,,F"]);
  });

  it("takes a tag command only inside a format, where the printer runs it", () => {
    expect(documentReplies("^RU^XA^FN1^FDx^FS^HV1,20,H,E,L^XZ").uncounted).toEqual([]);
    expect(documentReplies("^RT1^XA^FN1^FDx^FS^HV1,20,H,E,F^XZ").uncounted).toEqual([]);
  });

  it("serialises the fields behind a stored ^RU where its frame is recalled, not where it is stored", () => {
    const serial = (zpl: string) => documentReplies(zpl).uncounted;
    expect(documentReplies("^XA^DFR:A.ZPL^FS^RU^XZ^XA^FN1^FDx^FS^HV1,20,H,E,L^PQ2^XZ")).toMatchObject({ awaited: one("^HV1,20,H,E,L", "H", "E", 2), uncounted: [] });
    expect(serial("^XA^DFR:A.ZPL^FS^RU^XZ^XA^XFR:A.ZPL^FS^XZ^XA^FN1^FDx^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual(["^HV1,20,H,E,L"]);
    // A field runs at its recall, so a ^RU anywhere ahead of that in printer order reaches it.
    expect(serial("^XA^DFR:A.ZPL^FS^FN1^FDx^FS^HV1,20,H,E,F^XZ^XA^RU^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(serial("^XA^RU^XZ^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(serial("^XA^DFR:A.ZPL^FS^FN1^FDx^RU^FS^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(serial("^XA^DFR:A.ZPL^FS^RU^FN1^FDx^FS^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
  });

  it("names exactly the groups a reader would miscount in up to five replies in a row, over one group with longer marks", () => {
    const marks = ["", "a", "ab", "aa", "aba"];
    const data = ["", "a", "b", "ab", "ba", "aa", "aab", "baa", "aba"];
    for (const h of marks)
      for (const t of marks)
        for (const d of data) {
          if (h === "" && t === "") continue;
          const texts = [...new Set([h + t, h + d + t])];
          let runs = texts.map((text) => [text]);
          let miscounts = false;
          for (let depth = 1; depth <= 5 && !miscounts; depth += 1) {
            miscounts = runs.some((run) => repliesIn(run.join(""), { header: h, terminator: t }) !== run.length);
            runs = runs.flatMap((run) => texts.map((text) => [...run, text]));
          }
          const zpl = `^XA^FN1^FD${d}^FS^HV1,20,${h},${t},L^PQ5^XZ`;
          expect(documentReplies(zpl).ambiguous, zpl).toEqual(miscounts ? ["^HV1,20," + h + "," + t + ",L"] : []);
        }
  });

  it("tells the reader's state behind two replies apart, which no single reply leaves behind", () => {
    expect(documentReplies("^XA^PQ3^FN1^FDa^FS^HV1,64,aa,a,L^XZ").ambiguous).toEqual(["^HV1,64,aa,a,L"]);
    expect(documentReplies("^XA^PQ3^FN1^FDx^FS^FN2^FDab^FS^HV1,64,abc,b,F^HV2,64,a,aa,L^XZ").ambiguous).toEqual(["^HV2,64,a,aa,L"]);
  });

  it("ignores an empty ^FV like the printer does, spec p.207, so the ^FD before it still spoils the marks", () => {
    expect(documentReplies("^XA^FN1^FDaH^FS^FN1^FV^FS^HV1,20,H,,L^PQ2^XZ").ambiguous).toEqual(["^HV1,20,H,,L"]);
  });

  it("judges a batch of distinct field values in linear time", () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => `^XA^XFR:B.ZPL^FS^FN1^FDv${i}^FS^XZ`).join("");
    const zpl = `^XA^DFR:B.ZPL^FS^FN1^FS^HV1,20,H,E,L^XZ${rows}`;
    const started = performance.now();
    expect(documentReplies(zpl).awaited).toEqual(one("^HV1,20,H,E,L", "H", "E", 50_000));
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("derives the replies a body still owes, counted outside the frames", () => {
    const groups = awaited("^XA^FN1^FDa^FS^HV1,5,H,E,L^HV2,5,K,U,F^PQ2^XZ");
    expect(owedReplies("", groups)).toEqual([
      { commands: ["^HV1,5,H,E,L"], missing: 2, of: 2 },
      { commands: ["^HV2,5,K,U,F"], missing: 1, of: 1 },
    ]);
    expect(owedReplies(`${STX}HaE${ETX}HaE\r\nKbU\r\n`, groups)).toEqual([{ commands: ["^HV1,5,H,E,L"], missing: 1, of: 2 }]);
    expect(owedReplies("HaEHaEKbU", groups)).toEqual([]);
  });

  it("decodes a header or terminator spelled in hex under ^FH the way the transport decodes the reply, as the guide's RFID example does", () => {
    expect(awaited("^XA^FH_^HV0,8,EPC[,]_0D_0A,L^XZ")).toEqual(one("^HV0,8,EPC[,]_0D_0A,L", "EPC[", "]\r\n"));
    expect(awaited("^XA^CI27^FH_^HV1,8,_E4,END^XZ")).toEqual(one("^HV1,8,_E4,END", "", "END"));
    expect(awaited("^XA^FH_^HV1,8,H,_E4^XZ^XA^FH_^HV1,8,_A4_B8,E^XZ")).toEqual([...one("^HV1,8,H,_E4", "H", ""), ...one("^HV1,8,_A4_B8,E", "", "E")]);
    expect(documentReplies("^XA^FH_^HV1,8,_E4,_A4^XZ").unmarked).toEqual(["^HV1,8,_E4,_A4"]);
    expect(awaited("^XA^CI28^FH_^HV1,8,_C3_A4,END^XZ")).toEqual(one("^HV1,8,_C3_A4,END", "\u00e4", "END"));
    expect(awaited("^XA^FH_^HV1,8,_5B,END^FS^HV1,8,_5B,END^XZ")).toEqual([...one("^HV1,8,_5B,END", "[", "END"), ...one("^HV1,8,_5B,END", "_5B", "END")]);
    expect(awaited("^XA^FH#^FDx^FS^HV0,8,EPC[,]#0D#0A^XZ")).toEqual(one("^HV0,8,EPC[,]#0D#0A", "EPC[", "]#0D#0A"));
    const frame = "^XA^DFR:A.ZPL^FS^FN1^FS^FH_^HV1,20,_5BH,_5D^XZ^XA^XFR:A.ZPL^FS^FN1^FDa^FS^XZ";
    expect(awaited(frame)).toEqual(one("^HV1,20,_5BH,_5D", "[H", "]"));
  });

  it("spells a remapped delimiter back to the comma, so the header and terminator read right", () => {
    expect(awaited("^XA^CD;^FN1^FDx^FS^PQ3^HV1;20;H;E;L^XZ")).toEqual(one("^HV1,20,H,E,L", "H", "E", 3));
    expect(commandsOf("^XA^CD;^HWR:*.*^HV1;20;H;E;F^XZ")).toEqual(["^HWR:*.*", "^HV1,20,H,E,F"]);
  });

  it("reads a ^HV no comma spelling exists for under the delimiter in force, and leaves out one asked in a format that only stores", () => {
    expect(documentReplies("^XA^CD;^FN1^FDx^FS^PQ4^HV1;20;H,X;E;L^XZ")).toEqual({ commands: ["^HV1;20;H,X;E;L"], awaited: one("^HV1;20;H,X;E;L", "H,X", "E", 4), unmarked: [], ambiguous: [], uncounted: [] });
    expect(documentReplies("^XA^HV1,20,H,E,F^DFR:A.ZPL^FS^FN1^FS^XZ")).toEqual({ commands: ["^HV1,20,H,E,F"], awaited: [], unmarked: [], ambiguous: [], uncounted: [] });
  });

  it("names a reply a reader could not find: no header, no terminator, only whitespace, or a frame byte in the mark", () => {
    expect(documentReplies("^XA^HV1,20,H^FS^HV2,20,,E,L^XZ").unmarked).toEqual([]);
    expect(documentReplies("^XA^HV1,,a, ^HV2,, ,b^HV3,,a,b^XZ").unmarked).toEqual(["^HV1,,a, ", "^HV2,, ,b"]);
    expect(documentReplies("^XA^HV1,20^FS^HV2,20, , ^FS^FH_^HV3,20,_02H,_03^XZ").unmarked).toEqual(["^HV1,20", "^HV2,20, , ", "^HV3,20,_02H,_03"]);
    expect(documentReplies("^XA^FH_^HV1,20,_02H,END^XZ").unmarked).toEqual(["^HV1,20,_02H,END"]);
    expect(documentReplies("^XA^FH_^HV1,20,_02#02,E^FS^FH#^HV1,20,_02#02,E^XZ").unmarked).toEqual(["^HV1,20,_02#02,E"]);
  });

  it("counts no ^HV beside a host reply the reader cannot frame off, since the format text a ^HF returns may hold its marks", () => {
    expect(documentReplies("^XA^HFR:A.ZPL^FN1^FDx^FS^HV1,20,H,E,F^HV2,20,K,U,F^XZ").ambiguous).toEqual(["^HV1,20,H,E,F", "^HV2,20,K,U,F"]);
    expect(documentReplies("^XA^HFR:A.ZPL^XZ^XA^FN1^FDx^FS^HV1,20,H,E,F^XZ").ambiguous).toEqual(["^HV1,20,H,E,F"]);
    expect(documentReplies("^XA~HI~HM~HS~HQES^HH^HWR:*.*^FN1^FDx^FS^HV1,20,H,E,F^XZ").ambiguous).toEqual([]);
    // One that is ignored or only stored sends nothing, and an unmarked ^HV stays unmarked.
    expect(documentReplies("^XA^FN1^FDx^FS^HV1,20,H,E,F^XZ^HFR:A.ZPL").ambiguous).toEqual([]);
    expect(documentReplies("^XA^DFR:A.ZPL^FS^HFR:A.ZPL^XZ^XA^FN1^FDx^FS^HV1,20,H,E,F^XZ").ambiguous).toEqual([]);
    expect(documentReplies("^XA^HFR:A.ZPL^HV1,20^XZ")).toMatchObject({ unmarked: ["^HV1,20"], ambiguous: [] });
  });

  it("groups the replies by their exact marks and adds their counts, and names groups whose marks lie inside each other's ambiguous", () => {
    const doc = documentReplies("^XA^FN1^FDx^FS^HV1,20,A,END^HV2,20,A,END,L^HV3,20,,END^HV4,20, ,^PQ3^XZ");
    expect(doc.awaited).toEqual([
      { header: "A", terminator: "END", count: 4, commands: ["^HV1,20,A,END", "^HV2,20,A,END,L"] },
      { header: "", terminator: "END", count: 1, commands: ["^HV3,20,,END"] },
    ]);
    expect(doc.unmarked).toEqual(["^HV4,20, ,"]);
    expect(doc.ambiguous).toEqual(["^HV3,20,,END"]);
    expect(awaited("^XA^FN1^FDa^FS^HV1,5,H,E,F^HV2,5,K,U,F^HV2,5,H,E,F^XZ")).toEqual([
      { header: "H", terminator: "E", count: 2, commands: ["^HV1,5,H,E,F", "^HV2,5,H,E,F"] },
      { header: "K", terminator: "U", count: 1, commands: ["^HV2,5,K,U,F"] },
    ]);
    expect(documentReplies("^XA^FN1^FDx^FS^HV1,20,H1,E,L^HV2,20,H,E^PQ3^XZ").ambiguous).toEqual(["^HV2,20,H,E"]);
    expect(documentReplies("^XA^HV1,20,H^HV2,20,HEAD^XZ").ambiguous).toEqual(["^HV1,20,H"]);
    expect(documentReplies("^XA^HV1,20,A,X^HV2,20,B,Y^XZ")).toMatchObject({ ambiguous: [], uncounted: [] });
    expect(awaited("^XA^HV1,20,A,X^HV2,20,B,Y^XZ")).toHaveLength(2);
  });
});

describe("scanReplies and repliesIn", () => {
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
});
