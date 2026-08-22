import { describe, it, expect } from "vitest";
import { exportZpl, importZpl, patchDesign, validateDraft } from "./tools";

/** Streams chosen to hit every form the parser PRESERVES rather than models:
 *  those are the bytes that reach the boundary as-is, where three review
 *  rounds found the validation stricter than the importer. */
const CORPUS: Record<string, string> = {
  gfaPlainHex: "^XA^FO10,10^GFA,8,8,1,00FF00FF00FF00FF^FS^XZ",
  gfaCompressed: "^XA^FO10,10^GFA,16,16,2,MN03hFF,!^FS^XZ",
  gfbB64: "^XA^FO10,10^GFB,4,4,2,:B64:AAAA:9c02^FS^XZ",
  gfbRawWithControlBytes: "^XA^FO10,10^GFB,4,4,2,A^B~^FS^XZ",
  gfcZ64: "^XA^FO10,10^GFC,4,16,2,:Z64:eJxjYGBgAAAABAAB:c953^FS^XZ",
  storedGraphic: "^XA~DYR:LOGO,A,G,8,1,00FF00FF00FF00FF^FO10,10^XGR:LOGO.GRF,1,1^FS^XZ",
  feTemplate: "^XA^FN1^FDdef^FS^FO10,10^A0N,20,20^FE#^FDx #1# y^FS^XZ",
  serialField: "^XA^FO10,10^A0N,20,20^SN0001,1,Y^FS^XZ",
  serialMask: "^XA^FO10,10^A0N,20,20^FDAB0001^SFAAdddd,1^FS^XZ",
  clockField: "^XA^FO10,10^A0N,20,20^FC%,{,#^FD%H:%M^FS^XZ",
  fieldHexEscape: "^XA^FO10,10^A0N,20,20^FH_^FD_41_42^FS^XZ",
  passThroughConfig: "^XA^FWR^ZZ99,7^LT30^FO10,10^A0N,20,20^FDx^FS^XZ",
  multiPage: "^XA^FO10,10^A0N,20,20^FDone^FS^XZ^XA^FO10,10^A0N,20,20^FDtwo^FS^XZ",
  gs1Code128: "^XA^FO10,10^BCN,60,Y,N,N,D^FD(01)04150123456782(10)AB^FS^XZ",
  gs1DataMatrix: "^XA^FO10,10^BXN,6,200,,,,_^FD_101041501234567821AB^FS^XZ",
  blockText: "^XA^FO10,10^A0N,20,20^FB300,2,0,C,0^FDwrapped\\&text^FS^XZ",
};

describe("everything the importer accepts, the other tools accept back", () => {
  for (const [name, zpl] of Object.entries(CORPUS)) {
    it(`round-trips ${name}`, () => {
      const imported = importZpl(zpl, 8);
      expect(imported.ok, "import").toBe(true);
      if (!imported.ok) return;
      expect(validateDraft(imported.designFile).ok, "validate").toBe(true);
      expect(exportZpl(imported.designFile).ok, "export").toBe(true);
      // A no-op-shaped patch walks the same envelope plus the op pipeline.
      const first = (imported.designFile as { pages: { objects: { id: string }[] }[] })
        .pages[0]?.objects[0];
      if (first) {
        expect(
          patchDesign(imported.designFile, [{ op: "update", id: first.id, x: 11 }]).ok,
          "patch",
        ).toBe(true);
      }
    });
  }
});
