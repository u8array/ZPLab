import { describe, it, expect } from "vitest";
import { qrFdToModel as parse, QR_EC_DEFAULT } from "./qrFd";

/** Default to ^CI28; the single-byte cases name their charset. */
const qrFdToModel = (fd: string, encoding = "utf-8") => parse(fd, encoding);

/** Switch forms from the Zebra guide (pp. 128-133), plus the payloads that
 *  look like switches. `lossy` means a re-emit would not reproduce the bytes. */
describe("qrFdToModel", () => {
  it("reads the automatic form the emitter produces, losslessly", () => {
    expect(qrFdToModel("QA,HELLO")).toEqual({
      errorCorrection: "Q",
      content: "HELLO",
      lossy: false,
    });
  });

  it("accepts a lowercase switch, which the firmware honours", () => {
    const r = qrFdToModel("qa,HELLO");
    expect(r.content).toBe("HELLO");
    expect(r.errorCorrection).toBe("Q");
    expect(r.lossy).toBe(true);
  });

  for (const [name, fd, content] of [
    ["numeric", "HM,N12345", "12345"],
    ["alphanumeric", "HM,A12AABB", "12AABB"],
    ["byte with count", "QM,B0006qrcode", "qrcode"],
    ["byte payload containing a comma", "QM,B0003a,b", "a,b"],
    ["byte segment followed by another", "QM,B0003a,b,N123", "a,b123"],
    ["kanji", "HM,K0123", "0123"],
  ] as const) {
    it(`strips the ${name} character mode of a manual payload`, () => {
      expect(qrFdToModel(fd).content).toBe(content);
    });
  }

  // ZD230-measured: a count that does not land on a comma loses only the
  // overhanging bytes; the firmware resyncs at the next comma and reads on
  // (`QM,B0002abc,N12` prints `ab12`).
  it("resyncs at the next comma when a byte count overruns its segment", () => {
    expect(qrFdToModel("QM,B0002abc,N12").content).toBe("ab12");
  });

  it("keeps a lowercase payload byte that resembles a character mode", () => {
    expect(qrFdToModel("QM,nested").content).toBe("nested");
  });

  it("joins mixed-mode segments the way the printer encodes them", () => {
    // Guide p.133 worked example.
    expect(qrFdToModel("D03040C,LM,N0123456789,A12AABB,B0006qrcode")).toEqual({
      errorCorrection: "L",
      content: "012345678912AABBqrcode",
      lossy: true,
    });
  });

  it("joins manual-input segments without a mixed-mode prefix", () => {
    expect(qrFdToModel("QM,N12345,A12AABB").content).toBe("1234512AABB");
  });

  it("treats a comma as data for plain automatic input", () => {
    expect(qrFdToModel("QA,a,b,c").content).toBe("a,b,c");
  });

  it("splits mixed-mode automatic input, whose commas are delimiters (p.132)", () => {
    expect(qrFdToModel("D03040C,LA,a,b,c").content).toBe("abc");
  });

  for (const [fd, content, ec] of [
    ["HELLO", "LO", "H"],
    ["QAHELLO", "ELLO", "Q"],
    ["AB", "", QR_EC_DEFAULT],
  ] as const) {
    it(`drops the malformed prefix of ${fd} like the firmware`, () => {
      const r = qrFdToModel(fd);
      expect(r.content).toBe(content);
      expect(r.errorCorrection).toBe(ec);
      expect(r.lossy).toBe(true);
    });
  }

  it("round-trips a payload that itself looks like a switch", () => {
    const once = qrFdToModel("QA,QA,x");
    expect(once).toEqual({ errorCorrection: "Q", content: "QA,x", lossy: false });
    expect(qrFdToModel(`QA,${once.content}`)).toEqual(once);
  });

  // `Bdddd` is a byte count, so the same two bytes are one character under
  // ^CI28 and two under a single-byte charset.
  for (const [encoding, content] of [
    ["utf-8", "é"],
    ["windows-1252", "éZ"],
  ] as const) {
    it(`counts a byte segment in ${encoding}, not in characters`, () => {
      expect(qrFdToModel("QM,B0002éZ", encoding).content).toBe(content);
    });
  }

  it("reports an empty field as lossy, since a re-emit adds the prefix", () => {
    expect(qrFdToModel("")).toEqual({
      errorCorrection: QR_EC_DEFAULT,
      content: "",
      lossy: true,
    });
  });
});
