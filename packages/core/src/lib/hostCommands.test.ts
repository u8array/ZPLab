import { describe, expect, it } from "vitest";
import { ambiguousReplies, awaitedReplies, fieldHostParams, fieldReplies, hostCommandAsks, MAX_REPLY_GROUPS, owedReplies, repliesToHost, uncountedReplies, unmarkedReplies } from "./hostCommands";
import { outsideFrames, repliesIn } from "./hostStatus";
import { ETX, STX } from "./hostStatus.fixture";

describe("repliesToHost", () => {
  it("accepts only the prefix the catalog spells", () => {
    expect(repliesToHost("^XA~HS^HW^XZ")).toEqual(["~HS", "^HW"]);
    expect(repliesToHost("^XA^HS~HW^FO10,10^XZ")).toEqual([]);
  });

  it("names every spelling once, in the order the printer meets them", () => {
    expect(repliesToHost("^XA^HW R:*.*^FO10,10^FDx^FS~HS^HH~HS^XZ")).toEqual(["^HWR:*.*", "~HS", "^HH"]);
    expect(repliesToHost("^XA~HQES~HQHA~HQES^XZ")).toEqual(["~HQES", "~HQHA"]);
  });

  it("is empty for a document that only prints", () => {
    expect(repliesToHost("^XA^FO10,10^A0N,20,20^FDHS^FS^XZ")).toEqual([]);
  });

  // ^HW is a format command, so inside field data it is data, while an immediate ~HS acts anywhere.
  it("leaves a tilde the firmware does not intercept as field data", () => {
    expect(repliesToHost("^XA^FO10,10^FDsend ~HW the drive^FS^XZ")).toEqual([]);
  });

  it("counts an immediate host command inside field data", () => {
    expect(repliesToHost("^XA^FO10,10^FDbefore ~HS after^FS^XZ")).toEqual(["~HS"]);
  });

  it("asks a format command stored behind a ^DF only where the same bytes recall the frame", () => {
    const frame = "^XA^DFR:A.ZPL^FS^FO10,10^A0N,20,20^FN1^FS^HWR:*.*^HV1,20,H,E,F~HS^XZ";
    expect(repliesToHost(frame)).toEqual(["~HS"]);
    expect(repliesToHost(`${frame}^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ`)).toEqual(["~HS", "^HWR:*.*", "^HV1,20,H,E,F"]);
    expect(repliesToHost(`${frame}^XA^XFR:B.ZPL^FS^XZ`)).toEqual(["~HS"]);
    expect(repliesToHost("^XA^HWR:*.*^DFR:A.ZPL^FS^XZ")).toEqual(["^HWR:*.*"]);
    expect(repliesToHost("^XA^FO10,10^FDx^FS^DFR:A.ZPL^FS^HWR:*.*^XZ")).toEqual([]);
  });

  it("resolves a recall like the printer: the device search order, a defaulted extension, and no match for another named device", () => {
    expect(repliesToHost("^XA^DFE:A.ZPL^FS^FN1^FS^HWR:*.*^XZ^XA^XFA.ZPL^FS^FN1^FDx^FS^XZ")).toEqual(["^HWR:*.*"]);
    expect(repliesToHost("^XA^DFR:A.ZPL^FS^FN1^FS^HWR:*.*^XZ^XA^XFR:A^FS^FN1^FDx^FS^XZ")).toEqual(["^HWR:*.*"]);
    expect(repliesToHost("^XA^DFE:A.ZPL^FS^FN1^FS^HWR:*.*^XZ^XA^XFR:A.ZPL^FS^FN1^FDx^FS^XZ")).toEqual([]);
  });

  it("keeps a recall inside a stored frame for that frame's own recall, in either declaration order, through a chain and past a cycle", () => {
    const storeA = "^XA^DFR:A.ZPL^FS^FO10,10^A0N,20,20^FN1^FS^HWR:*.*^XZ";
    const storeB = "^XA^DFR:B.ZPL^FS^XFR:A.ZPL^FS^HT^XZ";
    expect(repliesToHost(storeA + storeB)).toEqual([]);
    expect(repliesToHost(storeA + storeB + "^XA^XFR:B.ZPL^FS^XZ")).toEqual(["^HWR:*.*", "^HT"]);
    expect(repliesToHost(storeB + storeA + "^XA^XFR:B.ZPL^FS^XZ")).toEqual(["^HWR:*.*", "^HT"]);
    const storeC = "^XA^DFR:C.ZPL^FS^XFR:B.ZPL^FS^HH^XZ";
    expect(repliesToHost(storeA + storeB + storeC + "^XA^XFR:C.ZPL^FS^XZ")).toEqual(["^HWR:*.*", "^HT", "^HH"]);
    const self = "^XA^DFR:S.ZPL^FS^HWE:*.*^XFR:S.ZPL^FS^XZ";
    expect(repliesToHost(self + "^XA^XFR:S.ZPL^FS^XZ")).toEqual(["^HWE:*.*"]);
  });

  it("names the frame after the first usable ^DF, a later one being stored text", () => {
    const block = "^XA^DFR:A.ZPL^FS^HZA^FS^DFR:B.ZPL^FS^HH^FS^XZ";
    expect(repliesToHost(block + "^XA^XFR:B.ZPL^FS^XZ")).toEqual([]);
    expect(repliesToHost(block + "^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HZA", "^HH"]);
  });

  it("answers a format command only inside an open format, an immediate one anywhere", () => {
    expect(repliesToHost("^HWR:*.*^XA^FO10,10^FDx^FS^XZ")).toEqual([]);
    expect(repliesToHost("^XA^FO10,10^FDx^FS^XZ^HWR:*.*")).toEqual([]);
    expect(repliesToHost("^XA^FO10,10^FDx^FS^XZ~HS")).toEqual(["~HS"]);
    expect(repliesToHost("^HWR:*.*")).toEqual([]);
    expect(repliesToHost("^XA^DFR:A.ZPL^FS^HWR:*.*^XZ^XFR:A.ZPL")).toEqual([]);
  });

  it("follows a ^CT remap to the new tilde char", () => {
    expect(repliesToHost("^XA^CT/^FS/HS^XZ")).toEqual(["~HS"]);
    expect(repliesToHost("^XA^CT/^FS~HS^XZ")).toEqual([]);
  });

  it("follows a ^CC remap to the new caret char", () => {
    expect(repliesToHost("^XA^CC//HWR:*.*//XZ")).toEqual(["^HWR:*.*"]);
  });
});

describe("fieldHostParams", () => {
  it("reads the slot, the header, the terminator and the per-label flag, each with a default", () => {
    expect(fieldHostParams("1,20,HEAD,END,F")).toEqual({ slot: 1, bytes: 20, header: "HEAD", terminator: "END", perLabel: false });
    expect(fieldHostParams("12,20,, END , l")).toEqual({ slot: 12, bytes: 20, header: "", terminator: " END ", perLabel: true });
    expect(fieldHostParams("3")).toEqual({ slot: 3, bytes: 64, header: "", terminator: "", perLabel: false });
    expect(fieldHostParams("")).toEqual({ slot: 0, bytes: 64, header: "", terminator: "", perLabel: false });
    expect(fieldHostParams("1;20;H,X;E;L", ";")).toEqual({ slot: 1, bytes: 20, header: "H,X", terminator: "E", perLabel: true });
    // The reply carries 1 to 256 bytes of the field, 64 unless spelled so (spec p.239).
    expect(["1,1", "1, 256 ", "1,0", "1,257", "1,x", "1,1.5"].map((params) => fieldHostParams(params).bytes)).toEqual([1, 256, 64, 64, 64, 1]);
  });
});

describe("hostCommandAsks", () => {
  const plain = { caretChar: "^", tildeChar: "~", delimiterChar: "," };
  // The tokenizer carries a ^CD remap in the chars it is handed, so each call gets its own copy.
  const labelsOf = (zpl: string) => hostCommandAsks(zpl, { ...plain }).map((a) => `${a.id}:${a.ask}:${a.labels}`);
  const dataOf = (zpl: string) => hostCommandAsks(zpl, { ...plain }).filter((a) => a.ask === "asked").map((a) => a.data);

  it("gives every answered command the labels of its format, from a ^PQ before or behind it", () => {
    expect(labelsOf("^XA^PQ3^HV1,20,H,E,L~HS^XZ")).toEqual(["^HV:asked:3", "~HS:asked:3"]);
    expect(labelsOf("^XA^PQ100000000^HV1,20^XZ^HV2,20")).toEqual(["^HV:asked:100000000", "^HV:ignored:0"]);
    expect(labelsOf("^XA^PQ3^PQ0^HV1,20^XZ^XA^CD;^PQ4;1^HV1,20^XZ")).toEqual(["^HV:asked:3", "^HV:asked:4"]);
    expect(labelsOf("^XA^PQ3^HV1,20,H,E,L")).toEqual(["^HV:asked:3"]);
    expect(labelsOf("^XA^HV1,20,H,E,L^PQ3^XZ^XA^HV1,20,H,E,L^XZ")).toEqual(["^HV:asked:3", "^HV:asked:1"]);
    expect(labelsOf("^XA^PQ0^HV1,20^XZ^XA^PQ 2,1^HV1,20^XZ")).toEqual(["^HV:asked:1", "^HV:asked:2"]);
    // A bare q is the spec's default of 1, p.324.
    expect(labelsOf("^XA^PQ3^PQ^HV1,20,H,E,L^XZ^XA^PQ,2^HV1,20,H,E,L^XZ")).toEqual(["^HV:asked:1", "^HV:asked:1"]);
  });

  it("replays a stored ^PQ at the recall, where a later ^PQ in the recalling format wins", () => {
    const frame = "^XA^DFR:A.ZPL^FS^FN1^FS^PQ5^HV1,20,H,E,L^XZ";
    expect(labelsOf(frame)).toEqual(["^HV:stored:0"]);
    expect(labelsOf("^XA^HWR:*.*^HV1,20,H,E^DFR:A.ZPL^FS^PQ5^XZ")).toEqual(["^HW:asked:0", "^HV:asked:0"]);
    expect(labelsOf(`${frame}^XA^XFR:A.ZPL^FS^FN1^FDa^FS^XZ`).at(-1)).toBe("^HV:asked:5");
    expect(labelsOf(`${frame}^XA^PQ2^XFR:A.ZPL^FS^FN1^FDa^FS^XZ`).at(-1)).toBe("^HV:asked:5");
    expect(labelsOf(`${frame}^XA^XFR:A.ZPL^FS^FN1^FDa^FS^PQ2^XZ`).at(-1)).toBe("^HV:asked:2");
  });

  it("gives a ^HV the field data of its slot from the printing format, decoded under ^FH, and none where the document holds none", () => {
    expect(dataOf("^XA^HV1,20,H,E^FN1^FDone^FS^FN2^FVtwo^FS^HV2,20,H,E^HV3,20,H,E^XZ")).toEqual([["one"], ["two"], []]);
    expect(dataOf("^XA^FH_^FN1^FD_45H^FS^HV1,20,H,E^XZ^XA^FN1^FDx^XZ^XA^HV1,20,H,E^XZ")).toEqual([["EH"], []]);
    expect(dataOf("^XA^FN1^FDa^FS^FDb^FS^FN1^SNx^FS^HV1,20,H,E^XZ")).toEqual([["a"]]);
    // An empty ^FV is ignored, spec p.207, so the ^FD stays.
    expect(dataOf("^XA^FN1^FDaH^FS^FN1^FV^FS^HV1,20,H,E^XZ")).toEqual([["aH"]]);
    expect(dataOf("^XA^FN1^FDa\r\nb^FS^HV1,20,H,E^XZ")).toEqual([["ab"]]);
    // The stored ^FD seals the slot on the ZD230 and the recall's prints as a stray field, so both may be what the ^HV returns.
    expect(dataOf("^XA^DFR:A.ZPL^FS^FN1^FDstored^FS^HV1,20,H,E^XZ^XA^XFR:A.ZPL^FS^FN1^FDfilled^FS^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual([["stored", "filled"], ["stored"]]);
  });

  it("cuts the field data to the bytes the ^HV returns, as the transport decodes them", () => {
    expect(dataOf("^XA^FN1^FDabc^FS^HV1,2,H,E^XZ")).toEqual([["ab"]]);
    expect(dataOf(`^XA^FN1^FD${"x".repeat(70)}^FS^HV1,,H,E^HV1,300,H,E^HV1,256,H,E^XZ`)).toEqual([["x".repeat(64)], ["x".repeat(64)], ["x".repeat(70)]]);
    expect(dataOf("^XA^FN1^FD\u00e4^FS^HV1,1,H,E^XZ")).toEqual([["\ufffd"]]);
    // A ^FH run is the bytes it spells, so the cut falls on them and the transport decodes what is left.
    expect(dataOf("^XA^FH_^FN1^FD_E4H^FS^HV1,2,H,E^XZ")).toEqual([["\ufffdH"]]);
    expect(dataOf("^XA^FH_^FN1^FD\u00e4_45^FS^HV1,2,H,E^HV1,3,H,E^XZ")).toEqual([["\u00e4"], ["\u00e4E"]]);
    expect(dataOf("^XA^DFR:A.ZPL^FS^FN1^FDabc^FS^HV1,2,H,E^XZ^XA^XFR:A.ZPL^FS^FN1^FDabd^FS^XZ")).toEqual([["ab"]]);
  });
});

describe("fieldReplies", () => {
  it("counts a reply per format, and per label through the format's ^PQ", () => {
    expect(fieldReplies("^XA^FN1^FDx^FS^HV1,20,H,E,F^PQ3^XZ")).toEqual([{ command: "^HV1,20,H,E,F", header: "H", terminator: "E", count: 1, data: ["x"] }]);
    expect(fieldReplies("^XA^FN1^FDx^FS^HV1,20,,END,L^PQ3^XZ")).toEqual([{ command: "^HV1,20,,END,L", header: "", terminator: "END", count: 3, data: ["x"] }]);
    expect(fieldReplies("^XA^PQ2^FN1^FDx^FS^HV1,20,H^XZ^XA^FN1^FDy^FS^HV1,20,H^XZ")).toEqual([{ command: "^HV1,20,H", header: "H", terminator: "", count: 2, data: ["x", "y"] }]);
  });

  it("names exactly the groups a reader would miscount in two replies in a row, over every small document", () => {
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
                const texts = all.flatMap((group) => [group.header + group.terminator, ...group.data.map((d) => group.header + d + group.terminator)].map((text) => ({ group, text })));
                const own = (group: Group, ...parts: { group: Group }[]) => parts.filter((part) => part.group === group).length;
                const expected = all.filter((group) => texts.some((p) => texts.some((q) => repliesIn(outsideFrames(p.text + q.text), group) !== own(group, p, q)))).flatMap((group) => group.commands);
                expect(ambiguousReplies(awaitedReplies(fieldReplies(zpl))), zpl).toEqual(expected);
                checked += 1;
              }
    expect(checked).toBe(81 * 64);
  });

  it("vouches for no ^HV where the document recalls a frame it does not hold, which may count, fill or ask on its own", () => {
    const recall = "^XA^XFR:A.ZPL^FS^FN1^FDx^FS^HV1,20,H,E,L^XZ";
    expect(fieldReplies(recall)).toEqual([]);
    expect(uncountedReplies(recall)).toEqual(["^HV1,20,H,E,L"]);
    expect(fieldReplies("^XA^XFR:A.ZPL^FS^HV1,20,H,,F^XZ")).toEqual([]);
    expect(uncountedReplies("^XA^XFR:A.ZPL^FS^HV1,20,H,,F^XZ")).toEqual(["^HV1,20,H,,F"]);
    // The frame may answer with marks of its own, so a format that recalls nothing is not vouched for either.
    expect(uncountedReplies("^XA^XFR:A.ZPL^FS^XZ^XA^FN1^FDx^FS^HV1,20,Z,,F^XZ")).toEqual(["^HV1,20,Z,,F"]);
    expect(uncountedReplies("^XA^DFR:K.ZPL^FS^XFR:U.ZPL^FS^PQ3^XZ^XA^XFR:K.ZPL^FS^FN1^FDx^FS^HV1,20,H,E,L^XZ")).toEqual(["^HV1,20,H,E,L"]);
    // A frame stored behind its recall lies on the printer at the recall, if anywhere.
    expect(uncountedReplies(`${recall}^XA^DFR:A.ZPL^FS^PQ3^XZ`)).toEqual(["^HV1,20,H,E,L"]);
    expect(uncountedReplies(`^XA^DFR:A.ZPL^FS^PQ3^XZ${recall}`)).toEqual([]);
    expect(fieldReplies(`^XA^DFR:A.ZPL^FS^PQ3^XZ${recall}`)).toEqual([{ command: "^HV1,20,H,E,L", header: "H", terminator: "E", count: 3, data: ["x"] }]);
    expect(fieldReplies("^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^FN1^FDx^FS^XZ")).toEqual([{ command: "^HV1,20,H,E,F", header: "H", terminator: "E", count: 1, data: ["x"] }]);
  });

  it("vouches for no ^HV whose slot the printer fills at print time: ^SN, ^SF, ^FC, a reading ^RF, or any ^FD behind a ^RU", () => {
    expect(uncountedReplies("^XA^FN1^SN1,1,N^FS^HV1,20,1,,L^PQ2^XZ")).toEqual(["^HV1,20,1,,L"]);
    expect(uncountedReplies("^XA^FN1^FDABCD1000^SF%%%%dddd,1^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(uncountedReplies("^XA^FC%^FN1^FD%H:%M^FS^HV1,20,H,E^XZ")).toEqual(["^HV1,20,H,E"]);
    // Behind the data the clock stays text, spec p.1614.
    expect(uncountedReplies("^XA^FN1^FD%H:%M^FC%^FS^HV1,20,H,E^XZ")).toEqual([]);
    expect(uncountedReplies("^XA^RFR,H,0,8,2^FN1^FS^HV1,,8-byte Tag ID Data:^FS^XZ")).toEqual(["^HV1,,8-byte Tag ID Data:"]);
    expect(uncountedReplies("^XA^RU^XZ^XA^FN1^FDSerial #H^FS^HV1,20,H,E^XZ")).toEqual(["^HV1,20,H,E"]);
    expect(uncountedReplies("^XA^DFR:A.ZPL^FS^FN1^SN1,1,Y^FS^HV1,20,H,E,L^XZ^XA^XFR:A.ZPL^FS^PQ2^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(fieldReplies("^XA^FN1^SN1,1,N^FS^HV1,20,1,,L^PQ2^XZ")).toEqual([]);
    // A writing ^RF takes the field's data, a serial on another slot or in another format leaves this one alone, and a ^SN
    // behind ^FS opens a field of its own.
    const vouched = "^XA^RFW,H^FN1^FDx^FS^FN2^SN1^FS^SN2^FS^HV1,20,H,E^XZ^XA^FN1^SN1^FS^XZ^XA^FN1^FDx^FS^HV1,20,H,E^XZ";
    expect(uncountedReplies(vouched)).toEqual([]);
    expect(fieldReplies(vouched)).toEqual([{ command: "^HV1,20,H,E", header: "H", terminator: "E", count: 2, data: ["x"] }]);
  });

  it("vouches for no ^HV whose field an ^FE ahead of its data splices other fields into, spec p.191", () => {
    const spliced = uncountedReplies;
    expect(spliced("^XA^FN2^FDH^FS^FN1^FE#^FD#2#^FS^HV1,20,H,,L^PQ2^XZ")).toEqual(["^HV1,20,H,,L"]);
    expect(spliced("^XA^FN2^FDH^FS^FE#^FN1^FV#2#^FS^HV1,20,H,,L^PQ2^XZ")).toEqual(["^HV1,20,H,,L"]);
    expect(spliced("^XA^DFR:A.ZPL^FS^FN1^FE#^FS^HV1,20,H,,L^XZ^XA^XFR:A.ZPL^FS^FN2^FDH^FS^FN1^FD#2#^FS^PQ2^XZ")).toEqual(["^HV1,20,H,,L"]);
    // The printer ignores the empty ^FV, so the ^FE still stands ahead of the data.
    expect(spliced("^XA^FN2^FDH^FS^FN1^FV^FE#^FD#2#^FS^HV1,20,H,,L^PQ2^XZ")).toEqual(["^HV1,20,H,,L"]);
    // An ^FE behind the data concatenates nothing, so the data stands as spelled.
    expect(uncountedReplies("^XA^FN2^FDH^FS^FN1^FD#2#^FE#^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual([]);
    expect(fieldReplies("^XA^FN2^FDH^FS^FN1^FD#2#^FE#^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual([{ command: "^HV1,20,H,E,L", header: "H", terminator: "E", count: 2, data: ["#2#"] }]);
    expect(uncountedReplies("^XA^FN2^FDH^FS^FN1^FD#2#^FE#^FV^FS^HV1,20,H,,L^PQ2^XZ")).toEqual([]);
    expect(fieldReplies("^XA^FN2^FDH^FS^FN1^FD#2#^FE#^FV^FS^HV1,20,H,,L^PQ2^XZ")).toEqual([{ command: "^HV1,20,H,,L", header: "H", terminator: "", count: 2, data: ["#2#"] }]);
    // Data counts as seen on either side of the ^FN, as the parser reads it.
    expect(uncountedReplies("^XA^FN2^FDH^FS^FD#2#^FN1^FE#^FS^HV1,20,H,,L^PQ2^XZ")).toEqual([]);
    expect(fieldReplies("^XA^FN2^FDH^FS^FD#2#^FN1^FE#^FS^HV1,20,H,,L^PQ2^XZ")).toEqual([{ command: "^HV1,20,H,,L", header: "H", terminator: "", count: 2, data: ["#2#"] }]);
  });

  it("counts no per-label ^HV in a format that reads, writes or locks the tag, since a void prints the label again, spec p.239 and p.434", () => {
    const voided = uncountedReplies;
    expect(voided("^XA^RS8^RFW,H^FD1111^FS^FN1^FDx^FS^HV1,20,H,E,L^PQ1^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^RLP^FN1^FDx^FS^HV1,20,H,E,L^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^RU^XZ^XA^FN1^FDx^FS^HV1,20,H,E,L^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^RT2^FN1^FDx^FS^HV1,20,H,E,L^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^DFR:A.ZPL^FS^RFW,H^FD1111^FS^FN1^FS^HV1,20,H,E,L^XZ^XA^XFR:A.ZPL^FS^FN1^FDx^FS^PQ2^XZ")).toEqual(["^HV1,20,H,E,L"]);
    expect(voided("^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E,L^XZ^XA^XFR:A.ZPL^FS^RFR,H,0,8,2^FN2^FS^FN1^FDx^FS^XZ")).toEqual(["^HV1,20,H,E,L"]);
    // A per-format ^HV answers once whatever the printer voids, and without a tag command nothing voids.
    expect(uncountedReplies("^XA^RS8^RFW,H^FD1111^FS^FN1^FDx^FS^HV1,20,H,E^PQ2^XZ")).toEqual([]);
    expect(fieldReplies("^XA^RS8^RFW,H^FD1111^FS^FN1^FDx^FS^HV1,20,H,E^PQ2^XZ")).toEqual([{ command: "^HV1,20,H,E", header: "H", terminator: "E", count: 1, data: ["x"] }]);
    expect(uncountedReplies("^XA^RS8^RB96,8,3,3,20,24,38^FN1^FDx^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual([]);
    expect(fieldReplies("^XA^RS8^RB96,8,3,3,20,24,38^FN1^FDx^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual([{ command: "^HV1,20,H,E,L", header: "H", terminator: "E", count: 2, data: ["x"] }]);
  });

  it("vouches for no ^HV whose field an ^RT or ^RI reads the tag into, RFID Programming Guide p.115 and Guide 2 p.76", () => {
    const read = uncountedReplies;
    expect(read("^XA^RT1^HV1,20,H,,F^XZ")).toEqual(["^HV1,20,H,,F"]);
    expect(read("^XA^RI1^FN1^FS^HV1,20,H,E,F^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(read("^XA^RT^FN0^FS^HV0,20,H,E,F^XZ")).toEqual(["^HV0,20,H,E,F"]);
    expect(read("^XA^DFR:A.ZPL^FS^RT1^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(uncountedReplies("^XA^RT2^FN1^FDx^FS^HV1,20,H,E,F^XZ")).toEqual([]);
    expect(fieldReplies("^XA^RT2^FN1^FDx^FS^HV1,20,H,E,F^XZ")).toEqual([{ command: "^HV1,20,H,E,F", header: "H", terminator: "E", count: 1, data: ["x"] }]);
  });

  it("numbers a bare ^FN 0 like the printer, spec p.200", () => {
    expect((uncountedReplies)("^XA^FN^SN001,1^FS^HV0,20,H,E,F^XZ")).toEqual(["^HV0,20,H,E,F"]);
    expect(((zpl: string) => ambiguousReplies(awaitedReplies(fieldReplies(zpl))))("^XA^FN^FDH^FS^HV0,20,H,,F^XZ")).toEqual(["^HV0,20,H,,F"]);
  });

  it("takes a tag command only inside a format, where the printer runs it", () => {
    expect(uncountedReplies("^RU^XA^FN1^FDx^FS^HV1,20,H,E,L^XZ")).toEqual([]);
    expect(uncountedReplies("^RT1^XA^FN1^FDx^FS^HV1,20,H,E,F^XZ")).toEqual([]);
  });

  it("serialises the fields behind a stored ^RU where its frame is recalled, not where it is stored", () => {
    const serial = uncountedReplies;
    expect(uncountedReplies("^XA^DFR:A.ZPL^FS^RU^XZ^XA^FN1^FDx^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual([]);
    expect(fieldReplies("^XA^DFR:A.ZPL^FS^RU^XZ^XA^FN1^FDx^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual([{ command: "^HV1,20,H,E,L", header: "H", terminator: "E", count: 2, data: ["x"] }]);
    expect(serial("^XA^DFR:A.ZPL^FS^RU^XZ^XA^XFR:A.ZPL^FS^XZ^XA^FN1^FDx^FS^HV1,20,H,E,L^PQ2^XZ")).toEqual(["^HV1,20,H,E,L"]);
    // A field runs at its recall, so a ^RU anywhere ahead of that in printer order reaches it.
    expect(serial("^XA^DFR:A.ZPL^FS^FN1^FDx^FS^HV1,20,H,E,F^XZ^XA^RU^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(serial("^XA^RU^XZ^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(serial("^XA^DFR:A.ZPL^FS^FN1^FDx^RU^FS^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
    expect(serial("^XA^DFR:A.ZPL^FS^RU^FN1^FDx^FS^HV1,20,H,E,F^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E,F"]);
  });

  it("ignores an empty ^FV like the printer does, spec p.207, so the ^FD before it still spoils the marks", () => {
    expect(ambiguousReplies(awaitedReplies(fieldReplies("^XA^FN1^FDaH^FS^FN1^FV^FS^HV1,20,H,,L^PQ2^XZ")))).toEqual(["^HV1,20,H,,L"]);
  });

  it("judges a batch of distinct field values in linear time", () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => `^XA^XFR:B.ZPL^FS^FN1^FDv${i}^FS^XZ`).join("");
    const zpl = `^XA^DFR:B.ZPL^FS^FN1^FS^HV1,20,H,E,L^XZ${rows}`;
    const started = performance.now();
    const groups = awaitedReplies(fieldReplies(zpl));
    expect(ambiguousReplies(groups)).toEqual([]);
    expect(groups).toMatchObject([{ header: "H", terminator: "E", count: 50_000, commands: ["^HV1,20,H,E,L"] }]);
    // Collecting the values by linear search took 2.4 s for 40000 rows.
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("counts a stored ^HV once per recall, each with the labels its recall prints", () => {
    const frame = "^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E,L^XZ";
    expect(fieldReplies(frame)).toEqual([]);
    expect(fieldReplies(`${frame}^XA^XFR:A.ZPL^FS^FN1^FDa^FS^PQ2^XZ^XA^XFR:A.ZPL^FS^FN1^FDb^FS^XZ`)).toEqual([{ command: "^HV1,20,H,E,L", header: "H", terminator: "E", count: 3, data: ["a", "b"] }]);
  });

  it("lists a bare ^HV, leaves one outside a format and the other host commands out, and follows a prefix remap", () => {
    expect(fieldReplies("^XA~HS^HWR:*.*^HV1,20^XZ")).toEqual([{ command: "^HV1,20", header: "", terminator: "", count: 1, data: [] }]);
    expect(fieldReplies("^HV1,20,H,E^XA^FDx^FS^XZ")).toEqual([]);
    expect(fieldReplies("^XA^CC#^FN1^FDx^FS#HV1,20,H,E,F#PQ2#XZ")).toEqual([{ command: "^HV1,20,H,E,F", header: "H", terminator: "E", count: 1, data: [] }]);
    expect(fieldReplies("^XA^CC#^FN1^FDx^FS#HV1,20,H,E,L#PQ2#XZ")).toEqual([{ command: "^HV1,20,H,E,L", header: "H", terminator: "E", count: 2, data: [] }]);
  });

  it("tells no groups apart past the cap, where the seam check would hold the dialog", () => {
    const doc = (groups: number) => `^XA^FN1^FDa^FS${Array.from({ length: groups }, (_, i) => `^HV1,20,H${i}x,E${i}y,F`).join("")}^XZ`;
    expect(ambiguousReplies(awaitedReplies(fieldReplies(doc(MAX_REPLY_GROUPS))))).toEqual([]);
    expect(ambiguousReplies(awaitedReplies(fieldReplies(doc(MAX_REPLY_GROUPS + 1))))).toHaveLength(MAX_REPLY_GROUPS + 1);
  });

  it("names the ^HV a reader would miscount as ambiguous, and keeps the rest apart", () => {
    const ambiguous = (zpl: string) => ambiguousReplies(awaitedReplies(fieldReplies(zpl)));
    expect(ambiguous("^XA^FN1^FDa^FS^FN2^FDb^FS^HV1,5,Q,,F^HV2,5,,Q,F^XZ")).toEqual(["^HV1,5,Q,,F", "^HV2,5,,Q,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^HV1,5,A,T,F^HV2,5,B,T,F^HV3,5,,T,F^XZ")).toEqual(["^HV3,5,,T,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^HV1,5,[,],F^HV2,5,],[,F^XZ")).toEqual(["^HV1,5,[,],F", "^HV2,5,],[,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^HV1,5,X,,F^HV2,5,XY,,F^HV3,5,K,U,F^XZ")).toEqual(["^HV1,5,X,,F"]);
    expect(ambiguous("^XA^FN1^FDa^FS^HV1,5,H,E,F^HV2,5,K,U,F^HV2,5,H,E,F^XZ")).toEqual([]);
    // The guide's own pair shares a terminator behind distinct headers, which a reader counts right.
    expect(ambiguous("^XA^FH_^HV1,24,EPC[,]_0D_0A,F^FH_^HV2,24,TID[,]_0D_0A,F^XZ")).toEqual([]);
    // A reply with an empty field, or the seam between two replies, can show a mark too.
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
    // The reply carries n bytes of the field, so a mark behind them never shows.
    expect(ambiguous("^XA^FN1^FDEH^FS^HV1,1,H,E,F^XZ")).toEqual([]);
    expect(ambiguous("^XA^FN1^FDEH^FS^HV1,2,H,E,F^XZ")).toEqual(["^HV1,2,H,E,F"]);
    expect(ambiguous(`^XA^FN1^FD${"x".repeat(64)}EH^FS^HV1,,H,E,F^XZ`)).toEqual([]);
    // A stored ^FD prints too, so its data counts beside the recall's.
    expect(ambiguous("^XA^DFR:A.ZPL^FS^FN1^FDEH^FS^HV1,20,H,E^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HV1,20,H,E"]);
    expect(ambiguous("^XA^DFR:A.ZPL^FS^FN1^FDEH^FS^HV1,20,H,E^XZ^XA^XFR:A.ZPL^FS^FN1^FDx^FS^XZ")).toEqual(["^HV1,20,H,E"]);
    // A frame byte in the data hides the terminator from a reader, unless the data closes the frame again.
    expect(ambiguous("^XA^FH_^FN1^FD_02x^FS^HV1,20,H,E^XZ")).toEqual(["^HV1,20,H,E"]);
    expect(ambiguous("^XA^FH_^FN1^FD_02x_03^FS^HV1,20,H,E^XZ")).toEqual([]);
    expect(ambiguous("^XA^FH_^FN1^FD_03x^FS^HV1,20,H,E^XZ")).toEqual([]);
    expect(awaitedReplies(fieldReplies("^XA^FN1^FDa^FS^HV1,5,H,E,F^HV2,5,K,U,F^HV2,5,H,E,F^XZ"))).toEqual([
      { header: "H", terminator: "E", count: 2, commands: ["^HV1,5,H,E,F", "^HV2,5,H,E,F"], data: new Set(["a"]) },
      { header: "K", terminator: "U", count: 1, commands: ["^HV2,5,K,U,F"], data: new Set() },
    ]);
  });

  it("derives the replies a body still owes, counted outside the frames", () => {
    const groups = awaitedReplies(fieldReplies("^XA^FN1^FDa^FS^HV1,5,H,E,L^HV2,5,K,U,F^PQ2^XZ"));
    expect(owedReplies("", groups)).toEqual([
      { commands: ["^HV1,5,H,E,L"], missing: 2, of: 2 },
      { commands: ["^HV2,5,K,U,F"], missing: 1, of: 1 },
    ]);
    expect(owedReplies(`${STX}HaE${ETX}HaE
KbU
`, groups)).toEqual([{ commands: ["^HV1,5,H,E,L"], missing: 1, of: 2 }]);
    expect(owedReplies("HaEHaEKbU", groups)).toEqual([]);
  });

  it("decodes a header or terminator spelled in hex under ^FH the way the transport decodes the reply, as the guide's RFID example does", () => {
    expect(fieldReplies("^XA^FH_^HV0,8,EPC[,]_0D_0A,L^XZ")).toEqual([{ command: "^HV0,8,EPC[,]_0D_0A,L", header: "EPC[", terminator: "]\r\n", count: 1, data: [] }]);
    // A mark the transport garbles merges with its neighbours on the wire, so it is no mark.
    expect(fieldReplies("^XA^CI27^FH_^HV1,8,_E4,END^XZ")).toEqual([{ command: "^HV1,8,_E4,END", header: "", terminator: "END", count: 1, data: [] }]);
    expect(fieldReplies("^XA^FH_^HV1,8,H,_E4^XZ^XA^FH_^HV1,8,_A4_B8,E^XZ").map((reply) => [reply.header, reply.terminator])).toEqual([["H", ""], ["", "E"]]);
    expect(unmarkedReplies(fieldReplies("^XA^FH_^HV1,8,_E4,_A4^XZ"))).toEqual(["^HV1,8,_E4,_A4"]);
    expect(fieldReplies("^XA^CI28^FH_^HV1,8,_C3_A4,END^XZ")).toEqual([{ command: "^HV1,8,_C3_A4,END", header: "\u00e4", terminator: "END", count: 1, data: [] }]);
    expect(fieldReplies("^XA^FH_^HV1,8,_5B,END^FS^HV1,8,_5B,END^XZ")).toEqual([
      { command: "^HV1,8,_5B,END", header: "[", terminator: "END", count: 1, data: [] },
      { command: "^HV1,8,_5B,END", header: "_5B", terminator: "END", count: 1, data: [] },
    ]);
    expect(fieldReplies("^XA^FH#^FDx^FS^HV0,8,EPC[,]#0D#0A^XZ")).toEqual([{ command: "^HV0,8,EPC[,]#0D#0A", header: "EPC[", terminator: "]#0D#0A", count: 1, data: [] }]);
    const frame = "^XA^DFR:A.ZPL^FS^FN1^FS^FH_^HV1,20,_5BH,_5D^XZ^XA^XFR:A.ZPL^FS^FN1^FDa^FS^XZ";
    expect(fieldReplies(frame)).toEqual([{ command: "^HV1,20,_5BH,_5D", header: "[H", terminator: "]", count: 1, data: ["a"] }]);
  });

  it("spells a remapped delimiter back to the comma, so the header and terminator read right", () => {
    expect(fieldReplies("^XA^CD;^FN1^FDx^FS^PQ3^HV1;20;H;E;L^XZ")).toEqual([{ command: "^HV1,20,H,E,L", header: "H", terminator: "E", count: 3, data: ["x"] }]);
    expect(repliesToHost("^XA^CD;^HWR:*.*^HV1;20;H;E;F^XZ")).toEqual(["^HWR:*.*", "^HV1,20,H,E,F"]);
  });

  it("reads a ^HV no comma spelling exists for under the delimiter in force, and leaves out one asked in a format that only stores", () => {
    expect(fieldReplies("^XA^CD;^FN1^FDx^FS^PQ4^HV1;20;H,X;E;L^XZ")).toEqual([{ command: "^HV1;20;H,X;E;L", header: "H,X", terminator: "E", count: 4, data: ["x"] }]);
    expect(fieldReplies("^XA^HV1,20,H,E,F^DFR:A.ZPL^FS^FN1^FS^XZ")).toEqual([]);
  });
});

describe("unmarkedReplies and awaitedReplies", () => {
  const reply = (command: string, header: string, terminator: string, count = 1) => ({ command, header, terminator, count, data: [] });

  it("names a reply unmarked where one mark is only whitespace, which goes out but a reader cannot find", () => {
    expect(unmarkedReplies(fieldReplies("^XA^HV1,,a, ^HV2,, ,b^HV3,,a,b^XZ"))).toEqual(["^HV1,,a, ", "^HV2,, ,b"]);
  });

  it("names a reply a reader could not find: no header, no terminator, only whitespace, or a frame byte in the mark", () => {
    expect(unmarkedReplies([reply("^HV1,20,H", "H", ""), reply("^HV2,20,,E,L", "", "E")])).toEqual([]);
    expect(unmarkedReplies([reply("^HV1,20", "", ""), reply("^HV2,20, , ", " ", " "), reply(`^HV3,20,${STX}H,${ETX}`, `${STX}H`, ETX)])).toEqual(["^HV1,20", "^HV2,20, , ", `^HV3,20,${STX}H,${ETX}`]);
    expect(unmarkedReplies([reply(`^HV1,20,${STX}H,END`, `${STX}H`, "END")])).toEqual([`^HV1,20,${STX}H,END`]);
  });

  it("groups the replies by their exact marks, adds their counts, and drops marks that are only whitespace", () => {
    const groups = awaitedReplies([reply("^HV1,20,A,END", "A", "END"), reply("^HV2,20,A,END,L", "A", "END", 3), reply("^HV3,20,,END", "", "END"), reply("^HV4,20, ,", " ", "")]);
    expect(groups).toEqual([
      { header: "A", terminator: "END", count: 4, commands: ["^HV1,20,A,END", "^HV2,20,A,END,L"], data: new Set() },
      { header: "", terminator: "END", count: 1, commands: ["^HV3,20,,END"], data: new Set() },
    ]);
    expect(ambiguousReplies(groups)).toEqual(["^HV3,20,,END"]);
  });

  it("names groups whose leading mark lies inside another's marks ambiguous, and keeps distinct marks apart", () => {
    expect(ambiguousReplies(awaitedReplies([reply("^HV1,20,H1,E,L", "H1", "E", 3), reply("^HV2,20,H,E", "H", "E")]))).toEqual(["^HV2,20,H,E"]);
    expect(ambiguousReplies(awaitedReplies([reply("^HV1,20,H", "H", ""), reply("^HV2,20,HEAD", "HEAD", "")]))).toEqual(["^HV1,20,H"]);
    expect(ambiguousReplies(awaitedReplies([reply("^HV1,20,A,X", "A", "X"), reply("^HV2,20,B,Y", "B", "Y")]))).toEqual([]);
  });
});
