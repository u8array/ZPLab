import { describe, it, expect, afterEach } from "vitest";
import { importZplText } from "@zplab/core/lib/zplImportService";
import { generateZPL } from "@zplab/core/lib/zplGenerator";
import { registerFootprintMeasurer } from "@zplab/core/lib/footprintProber";
import type { LabelObject } from "@zplab/core/types/Group";

const BASE = { widthMm: 100, heightMm: 50, dpmm: 8 };
const measure40 = () => ({ w: 40, h: 100 });

const leaf = (zpl: string): LabelObject => {
  const r = importZplText(zpl, 8);
  const o = r.pages[0]?.objects[0];
  expect(o).toBeDefined();
  return o!;
};

afterEach(() => registerFootprintMeasurer(null));

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

  it("normalises a right-justified ^FT barcode x via the registered measurer", () => {
    registerFootprintMeasurer(measure40);
    const o = leaf("^XA^FT100,150,1^BCN,100,Y,N,N^FD123^FS^XZ");
    expect(o.x).toBe(60);
    expect(o.fieldJustify).toBe("R");
  });

  it("enables the emit gate on the imported label when normalisation ran", () => {
    registerFootprintMeasurer(measure40);
    const r = importZplText("^XA^FT100,150,1^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(r.labelConfig.emit1dZJustify).toBe(true);
    const plain = importZplText("^XA^FT100,150^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(plain.labelConfig.emit1dZJustify).toBeUndefined();
    registerFootprintMeasurer(null);
    const unmeasured = importZplText("^XA^FT100,150,1^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(unmeasured.labelConfig.emit1dZJustify).toBeUndefined();
  });

  it("measures normalisation against the imported bindings, not raw markers", () => {
    const seen: string[] = [];
    registerFootprintMeasurer((o) => {
      seen.push((o as { props: { content: string } }).props.content);
      return { w: 40, h: 100 };
    });
    const r = importZplText("^XA^FT100,150,1^BCN,100,Y,N,N^FN1^FD123^FS^XZ", 8);
    const props = r.pages[0]?.objects[0] as unknown as { x: number; props: { content: string } };
    // The parsed field itself is marker-bound; only the measured clone resolves.
    expect(props.props.content).toContain("«");
    expect(props.x).toBe(60);
    expect(seen.length).toBeGreaterThan(0);
    for (const c of seen) expect(c).not.toContain("«");
  });

  it("measures with the sidecar dpmm when the stream carries one", () => {
    const seen: number[] = [];
    registerFootprintMeasurer((_o, dpmm) => {
      if (dpmm !== undefined) seen.push(dpmm);
      return { w: 40, h: 100 };
    });
    const meta = String.raw`^FXZPLLAB:{"dpmm":12,"wMm":100,"hMm":50}^FS`;
    importZplText(`^XA${meta}^FT100,150,1^BCN,100,Y,N,N^FD123^FS^XZ`, 8);
    expect(seen).toEqual([12]);
  });

  it("leaves a ROTATED ^FT z=1 barcode unshifted (rotation interaction unverified)", () => {
    registerFootprintMeasurer(measure40);
    const o = leaf("^XA^FT100,150,1^BCR,100,Y,N,N^FD123^FS^XZ");
    expect(o.x).toBe(100);
    expect(o.fieldJustify).toBe("R");
  });

  it("leaves ^FO z=1 x untouched (z effect on ^FO unverified on firmware)", () => {
    registerFootprintMeasurer(measure40);
    const o = leaf("^XA^FO100,50,1^BCN,100,Y,N,N^FD123^FS^XZ");
    expect(o.x).toBe(100);
    expect(o.fieldJustify).toBe("R");
  });

  it("stamps but never shifts text (import-time text measurement unreliable)", () => {
    registerFootprintMeasurer(measure40);
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

  it("gate off (S3 tripwire): emits z-less regardless of measurement", () => {
    registerFootprintMeasurer(measure40);
    const zpl = generateZPL(BASE, [barcode1dR()]);
    expect(zpl).toContain("^FT60,50^");
    expect(zpl).not.toContain(",1^BC");
  });

  it("gate on: emits the printer-side anchor ^FT x+w,y,1", () => {
    registerFootprintMeasurer(measure40);
    const zpl = generateZPL({ ...BASE, emit1dZJustify: true }, [barcode1dR()]);
    expect(zpl).toContain("^FT100,50,1");
  });

  it("round-trip fixpoint: FT+R import normalises, gated emit restores the bytes", () => {
    registerFootprintMeasurer(measure40);
    const r = importZplText("^XA^FT100,150,1^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(r.pages[0]!.objects[0]!.x).toBe(60);
    const zpl = generateZPL({ ...BASE, emit1dZJustify: true }, r.pages[0]!.objects);
    expect(zpl).toContain("^FT100,150,1");
  });

  it("home-shift drop-tests the printer anchor, not the model left edge", () => {
    registerFootprintMeasurer(measure40);
    // labelHomeX 30: left edge 10-30 < 0, right anchor 50-30 = 20 stays on-label.
    const zpl = generateZPL(
      { ...BASE, emit1dZJustify: true, labelHomeX: 30 } as never,
      [barcode1dR({ x: 10 })],
    );
    expect(zpl).toContain("^FT20,50,1");
  });

  it("preflight sees the printer anchor, not the model left edge", async () => {
    registerFootprintMeasurer(measure40);
    const { emittedAnchorDots } = await import("@zplab/core/lib/emittedAnchor");
    const a = emittedAnchorDots(
      barcode1dR({ x: -10 }) as never,
      { label: { ...BASE, emit1dZJustify: true } } as never,
    );
    // Left edge -10 but the emitted anchor is -10+40 = 30 (on-label).
    expect(a.x).toBe(30);
  });

  it("preflight anchor of a non-1D R field stays the emitted model x", async () => {
    registerFootprintMeasurer(measure40);
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

  it("gate on but unverified combos stay z-less (FO, rotated, no measurer)", () => {
    registerFootprintMeasurer(measure40);
    const fo = generateZPL({ ...BASE, emit1dZJustify: true }, [barcode1dR({ positionType: undefined })]);
    expect(fo).toContain("^FO60,50^");
    const rot = barcode1dR();
    (rot as unknown as { props: { rotation: string } }).props = {
      ...(rot as unknown as { props: object }).props, rotation: "R",
    } as never;
    const rotZpl = generateZPL({ ...BASE, emit1dZJustify: true }, [rot]);
    expect(rotZpl).toContain("^FT60,50^");
    registerFootprintMeasurer(null);
    const unmeasured = generateZPL({ ...BASE, emit1dZJustify: true }, [barcode1dR()]);
    expect(unmeasured).toContain("^FT60,50^");
  });
});
