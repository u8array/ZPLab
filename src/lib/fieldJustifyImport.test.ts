import { describe, it, expect } from "vitest";
import { importZplText } from "@zplab/core/lib/zplImportService";
import { generateZPL } from "@zplab/core/lib/zplGenerator";
import type { LabelObject } from "@zplab/core/types/Group";

const leaf = (zpl: string, opts?: Parameters<typeof importZplText>[2]): LabelObject => {
  const r = importZplText(zpl, 8, opts);
  const o = r.pages[0]?.objects[0];
  expect(o).toBeDefined();
  return o!;
};

describe("^FO/^FT z-justification import", () => {
  it("stamps fieldJustify=R from an explicit z=1 on a barcode", () => {
    const o = leaf("^XA^FO100,50,1^BCN,100,Y,N,N^FD123^FS^XZ");
    expect(o.fieldJustify).toBe("R");
    // No measurer: x stays at the ZPL (right-edge) value.
    expect(o.x).toBe(100);
  });

  it("leaves fieldJustify absent without z (left is implicit)", () => {
    const o = leaf("^XA^FO100,50^BCN,100,Y,N,N^FD123^FS^XZ");
    expect(o.fieldJustify).toBeUndefined();
  });

  it("normalises a right-justified ^FT barcode x via the injected measurer", () => {
    const o = leaf("^XA^FT100,150,1^BCN,100,Y,N,N^FD123^FS^XZ", {
      measureFootprint: () => ({ w: 40, h: 100 }),
    });
    expect(o.x).toBe(60);
    expect(o.fieldJustify).toBe("R");
  });

  it("leaves a ROTATED ^FT z=1 barcode unshifted (rotation interaction unverified)", () => {
    const o = leaf("^XA^FT100,150,1^BCR,100,Y,N,N^FD123^FS^XZ", {
      measureFootprint: () => ({ w: 40, h: 100 }),
    });
    expect(o.x).toBe(100);
    expect(o.fieldJustify).toBe("R");
  });

  it("leaves ^FO z=1 x untouched (z effect on ^FO unverified on firmware)", () => {
    const o = leaf("^XA^FO100,50,1^BCN,100,Y,N,N^FD123^FS^XZ", {
      measureFootprint: () => ({ w: 40, h: 100 }),
    });
    expect(o.x).toBe(100);
    expect(o.fieldJustify).toBe("R");
  });

  it("stamps but never shifts text (import-time text measurement unreliable)", () => {
    const o = leaf("^XA^FO100,50,1^A0N,30,30^FDHi^FS^XZ", {
      measureFootprint: () => ({ w: 40, h: 30 }),
    });
    expect(o.type).toBe("text");
    expect(o.fieldJustify).toBe("R");
    expect(o.x).toBe(100);
  });

  it("^FW z sets the default for fields whose ^FO omits z", () => {
    const zpl = "^XA^FWN,1^FO100,50^BCN,100,Y,N,N^FD123^FS^FO300,50,0^BCN,100,Y,N,N^FD456^FS^XZ";
    const r = importZplText(zpl, 8);
    const [a, b] = r.pages[0]!.objects;
    // Omitted z inherits the ^FW default; explicit z=0 overrides it.
    expect(a!.fieldJustify).toBe("R");
    expect(b!.fieldJustify).toBeUndefined();
  });

  it("^FT carries z the same way", () => {
    const o = leaf("^XA^FT100,150,1^BCN,100,Y,N,N^FD123^FS^XZ");
    expect(o.positionType).toBe("FT");
    expect(o.fieldJustify).toBe("R");
  });

  it("a position-less follow field falls back to the ^FW default, not the prior z", () => {
    const r = importZplText("^XA^FO100,50,1^A0N,30,30^FDa^FS^A0N,30,30^FDb^FS^XZ", 8);
    expect(r.pages[0]!.objects[1]!.fieldJustify).toBeUndefined();
  });

  it("^FW z=2 (auto) resets an earlier R default to left", () => {
    const zpl = "^XA^FWN,1^FWN,2^FO100,50^BCN,100,Y,N,N^FD123^FS^XZ";
    expect(importZplText(zpl, 8).pages[0]!.objects[0]!.fieldJustify).toBeUndefined();
  });

  it("a later page's position-less first field inherits the persisted ^FW default", () => {
    const zpl = "^XA^FWN,1^A0N,30,30^FDa^FS^XZ^XA^A0N,30,30^FDb^FS^XZ";
    const r = importZplText(zpl, 8);
    expect(r.pages[1]!.objects[0]!.fieldJustify).toBe("R");
  });

  it("echoes z=1 on re-emit for un-normalised text and 2D fields", () => {
    // Un-normalised fields keep their anchor x; the echo restores the
    // original placement byte-true.
    const text = importZplText("^XA^FO100,50,1^A0N,30,30^FDHi^FS^XZ", 8);
    const textZpl = generateZPL({ widthMm: 100, heightMm: 50, dpmm: 8 }, text.pages[0]!.objects);
    expect(textZpl).toMatch(/\^FO\d+,\d+,1/);
    const qr = importZplText("^XA^FT100,150,1^BQN,2,4^FDQA,HELLO^FS^XZ", 8);
    const qrZpl = generateZPL({ widthMm: 100, heightMm: 50, dpmm: 8 }, qr.pages[0]!.objects);
    expect(qrZpl).toContain("^FT100,150,1");
  });

  it("S3 tripwire: a right-justified 1D barcode emits ^FO without a z-param", () => {
    // When barcode z-emit lands this goes red; the dirty-tracking
    // emitsFieldJustify predicate must flip together with the emitter.
    const o = {
      id: "b1", type: "code128", x: 60, y: 50, rotation: 0, fieldJustify: "R",
      props: { content: "123", height: 100, moduleWidth: 2, rotation: "N",
               printInterpretation: false, checkDigit: false },
    } as unknown as LabelObject;
    const zpl = generateZPL({ widthMm: 100, heightMm: 50, dpmm: 8 }, [o]);
    expect(zpl).toContain("^FO60,50^");
    expect(zpl).not.toContain("^FO60,50,1");
  });
});
