import { describe, it, expect } from "vitest";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { parseSingle } from "../test/helpers";

// Measured on the ZD230 on 2026-09-10: a raw CR or LF in ^FD data prints nothing
// and the rest of the field still prints. Space and tab print. Spec p.82: the escape is \&.
const HEAD = "^XA^PW800^LL1200";
const contents = (zpl: string) => parseSingle(zpl, 8).objects.map(getObjectStringContent);

describe("parseZPL — line breaks inside field data", () => {
  it("drops CR, LF and CRLF from ^FD data, wherever they sit", () => {
    expect(contents(`${HEAD}\n^FO40,40^A0N,60,60^FDal\npha^FS\n^XZ`)).toEqual(["alpha"]);
    expect(contents(`${HEAD}\r\n^FO40,40^A0N,60,60^FDbe\r\nta^FS\r\n^XZ`)).toEqual(["beta"]);
    expect(contents(`${HEAD}\n^FO40,40^A0N,60,60^FDep\rsilon^FS\n^XZ`)).toEqual(["epsilon"]);
    expect(contents(`${HEAD}\n^FO40,40^A0N,60,60^FDgamma\n^FS\n^XZ`)).toEqual(["gamma"]);
    expect(contents(`${HEAD}\n^FO40,40^A0N,60,60^FDdelta\n^XZ`)).toEqual(["delta"]);
  });

  it("keeps space and tab, which the printer prints", () => {
    expect(contents(`${HEAD}^FO40,40^A0N,60,60^FDgam ma^FS^XZ`)).toEqual(["gam ma"]);
    expect(contents(`${HEAD}^FO40,40^A0N,60,60^FDdel\tta^FS^XZ`)).toEqual(["del\tta"]);
  });

  it("keeps the indent behind a break, in a plain field and in a block alike", () => {
    // The printer renders the indent as data, in a ^FB block too, so the word-space
    // discard the spec puts on p.187 does not reach a break in the source.
    expect(contents(`${HEAD}^FO40,40^A0N,60,60^FDal\n  pha^FS^XZ`)).toEqual(["al  pha"]);
    expect(contents(`${HEAD}^FO40,40^A0N,30,30^FB400,3,0,L,0^FDHello\n  World^FS^XZ`)).toEqual([
      "Hello  World",
    ]);
  });

  it("applies to ^FV and to barcode data alike", () => {
    expect(contents(`${HEAD}^FO40,40^A0N,60,60^FVvar\n^FS^XZ`)).toEqual(["var"]);
    expect(contents(`${HEAD}^FO40,40^BY2^BCN,100^FDcode\n^FS^XZ`)).toEqual(["code"]);
    // An ^FV holding only a line break is the empty ^FV the spec ignores.
    expect(contents(`${HEAD}^FO40,40^A0N,60,60^FV\n^FS^XZ`)).toEqual([]);
  });

  it("leaves the explicit escapes alone: ^FH hex and the \\& block break", () => {
    expect(contents(`${HEAD}^FO40,40^FH^A0N,60,60^FDa_0Ab^FS^XZ`)).toEqual(["a\nb"]);
    expect(contents(`${HEAD}^FO40,40^A0N,30,30^FB300,3^FDone\\&two^FS^XZ`)).toEqual(["one\ntwo"]);
    // The printer strips the break before it decodes the hex, so a torn pair rejoins.
    expect(contents(`${HEAD}^FO40,40^FH^A0N,60,60^FDa_0\nAb^FS^XZ`)).toEqual(["a\nb"]);
  });
});
