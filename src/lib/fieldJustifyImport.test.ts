import { describe, it, expect } from "vitest";
import { importZplText } from "@zplab/core/lib/zplImportService";
import { generateZPL } from "@zplab/core/lib/zplGenerator";
import type { LabelObject } from "@zplab/core/types/Group";

const BASE = { widthMm: 100, heightMm: 50, dpmm: 8 };
// Code 128 "123" at module width 2 is 68 modules wide.
const W123 = 136;

const leaf = (zpl: string): LabelObject => {
  const r = importZplText(zpl, 8);
  const o = r.pages[0]?.objects[0];
  expect(o).toBeDefined();
  return o!;
};

describe("^FO/^FT z-justification import", () => {
  it("stamps fieldJustify=R from an explicit z=1 on a barcode", () => {
    const o = leaf("^XA^FO100,50,1^BCN,100,Y,N,N^FD123^FS^XZ");
    expect(o.fieldJustify).toBe("R");
  });

  it("leaves fieldJustify absent without z (left is implicit)", () => {
    const o = leaf("^XA^FO100,50^BCN,100,Y,N,N^FD123^FS^XZ");
    expect(o.fieldJustify).toBeUndefined();
  });

  it("normalises a right-justified ^FT barcode x to its left edge", () => {
    const o = leaf("^XA^FT300,150,1^BCN,100,Y,N,N^FD123^FS^XZ");
    expect(o.x).toBe(300 - W123);
    expect(o.fieldJustify).toBe("R");
  });

  it("enables the emit gate on the imported label when normalisation ran", () => {
    const r = importZplText("^XA^FT300,150,1^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(r.labelConfig.emit1dZJustify).toBe(true);
    const plain = importZplText("^XA^FT300,150^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(plain.labelConfig.emit1dZJustify).toBeUndefined();
  });

  it("measures normalisation against the imported bindings, not raw markers", () => {
    const r = importZplText("^XA^FT300,150,1^BCN,100,Y,N,N^FN1^FD123^FS^XZ", 8);
    const props = r.pages[0]?.objects[0] as unknown as { x: number; props: { content: string } };
    expect(props.props.content).toContain("«");
    expect(props.x).toBe(300 - W123);
  });

  it("leaves a ROTATED ^FT z=1 barcode unshifted (rotation interaction unverified)", () => {
    const o = leaf("^XA^FT100,150,1^BCR,100,Y,N,N^FD123^FS^XZ");
    expect(o.x).toBe(100);
    expect(o.fieldJustify).toBe("R");
  });

  it("normalises a right-justified ^FO barcode x (ZD230-verified mirror)", () => {
    const o = leaf("^XA^FO300,50,1^BCN,100,Y,N,N^FD123^FS^XZ");
    expect(o.x).toBe(300 - W123);
    expect(o.fieldJustify).toBe("R");
  });

  it("stamps but never shifts text (import-time text measurement unreliable)", () => {
    const o = leaf("^XA^FO100,50,1^A0N,30,30^FDHi^FS^XZ");
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
    const textZpl = generateZPL(BASE, text.pages[0]!.objects);
    expect(textZpl).toMatch(/\^FO\d+,\d+,1/);
    const qr = importZplText("^XA^FT100,150,1^BQN,2,4^FDQA,HELLO^FS^XZ", 8);
    const qrZpl = generateZPL(BASE, qr.pages[0]!.objects);
    expect(qrZpl).toContain("^FT100,150,1");
  });
});

describe("1D z-emit behind the emit1dZJustify gate", () => {
  const barcode1dR = (over: object = {}): LabelObject =>
    ({
      id: "b1", type: "code128", x: 60, y: 50, rotation: 0,
      positionType: "FT", fieldJustify: "R",
      props: { content: "123", height: 100, moduleWidth: 2, rotation: "N",
               printInterpretation: false, checkDigit: false },
      ...over,
    }) as unknown as LabelObject;

  it("gate off emits z-less", () => {
    const zpl = generateZPL(BASE, [barcode1dR()]);
    expect(zpl).toContain("^FT60,50^");
    expect(zpl).not.toContain(",1^BC");
  });

  it("gate on: emits the printer-side anchor ^FT x+w,y,1", () => {
    const zpl = generateZPL({ ...BASE, emit1dZJustify: true }, [barcode1dR()]);
    expect(zpl).toContain(`^FT${60 + W123},50,1`);
  });

  it("round-trip fixpoint: FT+R import normalises, gated emit restores the bytes", () => {
    const r = importZplText("^XA^FT300,150,1^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(r.pages[0]!.objects[0]!.x).toBe(300 - W123);
    const zpl = generateZPL({ ...BASE, emit1dZJustify: true }, r.pages[0]!.objects);
    expect(zpl).toContain("^FT300,150,1");
  });

  it("round-trip fixpoint: FO+R import normalises, gated emit restores the bytes", () => {
    const r = importZplText("^XA^FO300,50,1^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(r.pages[0]!.objects[0]!.x).toBe(300 - W123);
    const zpl = generateZPL({ ...BASE, emit1dZJustify: true }, r.pages[0]!.objects);
    expect(zpl).toContain("^FO300,50,1");
  });

  it("home-shift drop-tests the printer anchor, not the model left edge", () => {
    // labelHomeX 30 puts the left edge off the label, the right anchor stays on it.
    const zpl = generateZPL(
      { ...BASE, emit1dZJustify: true, labelHomeX: 30 } as never,
      [barcode1dR({ x: 10 })],
    );
    expect(zpl).toContain(`^FT${10 + W123 - 30},50,1`);
  });

  it("preflight sees the printer anchor, not the model left edge", async () => {
    const { emittedAnchorDots } = await import("@zplab/core/lib/emittedAnchor");
    const a = emittedAnchorDots(
      barcode1dR({ x: -10 }) as never,
      { label: { ...BASE, emit1dZJustify: true } } as never,
    );
    expect(a.x).toBe(-10 + W123);
  });

  it("preflight anchor of a non-1D R field stays the emitted model x", async () => {
    const { emittedAnchorDots } = await import("@zplab/core/lib/emittedAnchor");
    const qr = leaf("^XA^FT100,150,1^BQN,2,4^FDQA,123^FS^XZ");
    expect(qr.type).toBe("qrcode");
    const a = emittedAnchorDots(
      qr as never,
      { label: { ...BASE, emit1dZJustify: true } } as never,
    );
    // Non-1D emits the model x with a z echo; the anchor must not gain +w.
    expect(a.x).toBe(100);
  });

  it("gate on emits the anchored ^FO for an FO-positioned R barcode", () => {
    const fo = generateZPL({ ...BASE, emit1dZJustify: true }, [barcode1dR({ positionType: undefined })]);
    expect(fo).toContain(`^FO${60 + W123},50,1^`);
  });

  it("a rotated field stays z-less with the gate on", () => {
    const rot = barcode1dR();
    (rot as unknown as { props: { rotation: string } }).props = {
      ...(rot as unknown as { props: object }).props, rotation: "R",
    } as never;
    const rotZpl = generateZPL({ ...BASE, emit1dZJustify: true }, [rot]);
    expect(rotZpl).toContain("^FT60,50^");
  });
});
