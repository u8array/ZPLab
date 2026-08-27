import { describe, it, expect } from "vitest";
import { generateZPL } from "@zplab/core/lib/zplGenerator";
import { overlayText, type BlockOverlay } from "@zplab/core/lib/zplOverlay/overlay";
import { parseSingle } from "../../test/helpers";

/** Parse with overlay capture and assert the load-bearing invariant:
 *  segment texts always concatenate back to the source. */
function captured(zpl: string): BlockOverlay {
  const { overlay } = parseSingle(zpl, 8, { captureOverlay: true });
  expect(overlay, "expected an overlay to be captured").toBeDefined();
  expect(overlayText(overlay!)).toBe(zpl);
  return overlay!;
}

/** Segment linked to the object at `objectId`, or undefined. */
function objSeg(o: BlockOverlay, objectId: string) {
  return o.segments.find((s) => s.kind === "object" && s.objectId === objectId);
}

describe("parseZPL overlay capture", () => {
  it("links a clean single text field, gaps stay raw", () => {
    const zpl = "^XA\n^FO10,10^A0N,30,30^FDHello^FS\n^XZ";
    const { overlay, objects } = parseSingle(zpl, 8, { captureOverlay: true });
    expect(overlay).toBeDefined();
    expect(overlayText(overlay!)).toBe(zpl);
    expect(objects).toHaveLength(1);
    const seg = objSeg(overlay!, objects[0]!.id);
    expect(seg?.text).toBe("^FO10,10^A0N,30,30^FDHello^FS");
    // Leading and trailing raw segments wrap the field.
    expect(overlay!.segments[0]).toMatchObject({ kind: "raw" });
    expect(overlay!.segments.at(-1)).toMatchObject({ kind: "raw" });
  });

  it("links a barcode field with inline ^BY", () => {
    const zpl = "^XA^FO20,20^BY2^BCN,100,Y,N,N^FD12345^FS^XZ";
    const o = captured(zpl);
    const objSegs = o.segments.filter((s) => s.kind === "object");
    expect(objSegs).toHaveLength(1);
    expect(objSegs[0]!.text).toBe("^FO20,20^BY2^BCN,100,Y,N,N^FD12345^FS");
  });

  it("links a ^GB box field (object pushed mid-field)", () => {
    const zpl = "^XA^FO5,5^GB100,50,3^FS^XZ";
    const o = captured(zpl);
    const objSegs = o.segments.filter((s) => s.kind === "object");
    expect(objSegs).toHaveLength(1);
    expect(objSegs[0]!.text).toBe("^FO5,5^GB100,50,3^FS");
  });

  it("links a ^GD diagonal line field", () => {
    const zpl = "^XA^FO5,5^GD100,50,3,B,L^FS^XZ";
    const o = captured(zpl);
    expect(o.segments.filter((s) => s.kind === "object")).toHaveLength(1);
  });

  it("links two consecutive fields independently", () => {
    const zpl = "^XA\n^FO10,10^A0N,30,30^FDa^FS\n^FO10,60^A0N,30,30^FDb^FS\n^XZ";
    const { overlay, objects } = parseSingle(zpl, 8, { captureOverlay: true });
    expect(overlay).toBeDefined();
    expect(overlayText(overlay!)).toBe(zpl);
    expect(objSeg(overlay!, objects[0]!.id)?.text).toBe("^FO10,10^A0N,30,30^FDa^FS");
    expect(objSeg(overlay!, objects[1]!.id)?.text).toBe("^FO10,60^A0N,30,30^FDb^FS");
  });

  it("links a deferred reverse-bg box that commits standalone at ^XZ", () => {
    // Filled black ^GB with no ^FR is stashed; nothing follows to collapse it,
    // so it commits as a normal box at ^XZ. Its span must still link.
    const zpl = "^XA^FO5,5^GB80,80,80,B^FS^XZ";
    const { overlay, objects } = parseSingle(zpl, 8, { captureOverlay: true });
    expect(overlay).toBeDefined();
    expect(overlayText(overlay!)).toBe(zpl);
    expect(objects).toHaveLength(1);
    expect(objSeg(overlay!, objects[0]!.id)?.text).toBe("^FO5,5^GB80,80,80,B^FS");
  });

  it("captures a bare ^FR reverse text as one span (no synthesized ^GB)", () => {
    // Spec-true reverse emits ^FR with no background box, so the field is a
    // single reverse-text object spanning just its own ^FR^FD.
    const reverseText = [
      { id: "r", type: "text", x: 50, y: 50, rotation: 0,
        props: { content: "Hi", fontHeight: 30, fontWidth: 0, rotation: "N", reverse: true } },
    ] as unknown as Parameters<typeof generateZPL>[1];
    const zpl = generateZPL({ widthMm: 50, heightMm: 30, dpmm: 8 }, reverseText);
    const { overlay, objects } = parseSingle(zpl, 8, { captureOverlay: true });
    expect(overlay).toBeDefined();
    expect(overlayText(overlay!)).toBe(zpl);
    expect(objects).toHaveLength(1);
    const seg = objSeg(overlay!, objects[0]!.id);
    expect(seg?.text).toContain("^FR^FD");
    expect(seg?.text).not.toContain("^GB");
  });

  it("links the standalone box and the following field when bg does not collapse", () => {
    // Reverse-bg followed by a non-matching text field: the box commits
    // standalone during the text flush; both objects must link.
    const zpl =
      "^XA^FO5,5^GB200,200,200,B^FS\n^FO300,300^A0N,30,30^FDx^FS^XZ";
    const { overlay, objects } = parseSingle(zpl, 8, { captureOverlay: true });
    expect(overlay).toBeDefined();
    expect(overlayText(overlay!)).toBe(zpl);
    expect(objects).toHaveLength(2);
    expect(objSeg(overlay!, objects[0]!.id)?.text).toBe("^FO5,5^GB200,200,200,B^FS");
    expect(objSeg(overlay!, objects[1]!.id)?.text).toBe("^FO300,300^A0N,30,30^FDx^FS");
  });

  it("does not link a bare ^FN variable declaration, keeps it raw", () => {
    const zpl = "^XA^FN1^FDdefault^FS^FO10,10^A0N,30,30^FDx^FS^XZ";
    const { overlay, objects } = parseSingle(zpl, 8, { captureOverlay: true });
    expect(overlay).toBeDefined();
    expect(overlayText(overlay!)).toBe(zpl);
    // The declaration produces a Variable but no object; the real field links.
    expect(objects).toHaveLength(1);
    expect(objSeg(overlay!, objects[0]!.id)).toBeDefined();
    const raw = overlay!.segments.filter((s) => s.kind === "raw").map((s) => s.text).join("");
    expect(raw).toContain("^FN1^FDdefault^FS");
  });

  it("marks a plain block regenSafe with no frame", () => {
    const o = captured("^XA^FO10,10^A0N,30,30^FDx^FS^XZ");
    expect(o.regenSafe).toBe(true);
    expect(o.frame).toBeUndefined();
  });

  it("flags a ^MU block as not regenSafe (raw ^MU would rescale a regen)", () => {
    const o = captured("^XA^MUi^FO10,10^A0N,30,30^FDx^FS^MUd^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("flags a ^LR block as not regenSafe (raw ^LR would double-reverse a regen)", () => {
    const o = captured("^XA^LRY^FO10,10^A0N,30,30^FDx^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("flags a bare barcode (^BY outside the field) as not regenSafe", () => {
    const o = captured("^XA^BY3^FO10,10^BCN,100,Y,N,N^FD12345^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("flags any non-UTF-8 ^CI block as not regenSafe (regen would mis-encode)", () => {
    expect(captured("^XA^CI13^FO10,10^A0N,30,30^FDx^FS^XZ").regenSafe).toBe(false);
  });

  it("keeps a UTF-8 (^CI28) block regenSafe", () => {
    expect(captured("^XA^CI28^FO10,10^A0N,30,30^FDx^FS^XZ").regenSafe).toBe(true);
  });

  it("keeps a barcode with inline ^BY regenSafe", () => {
    const o = captured("^XA^FO10,10^BY3^BCN,100,Y,N,N^FD12345^FS^XZ");
    expect(o.regenSafe).toBe(true);
  });

  it("keeps a barcode with lowercase inline ^by regenSafe (ZPL is case-insensitive)", () => {
    const o = captured("^XA^FO10,10^by3^BCN,100,Y,N,N^FD12345^FS^XZ");
    expect(o.regenSafe).toBe(true);
  });

  // An unpinned ^FO QR inherits printer state on replay (see QrCodeProps.byHeight).
  it("flags an ^FO QR without in-span ^BY as not regenSafe", () => {
    expect(captured("^XA^FO10,10^BQN,2,5^FDQA,hello^FS^XZ").regenSafe).toBe(false);
  });

  it("keeps an ^FO QR with in-span ^BY regenSafe (the emit form)", () => {
    expect(captured("^XA^FO10,10^BY,,10^BQN,2,5^FDQA,hello^FS^XZ").regenSafe).toBe(true);
  });

  it("flags an ^FO QR whose in-span ^BY sets no height", () => {
    // ^BY2 pins only the width; the height the position depends on stays
    // session-inherited, so the regen would move the print.
    expect(captured("^XA^FO10,10^BY2^BQN,2,5^FDQA,hello^FS^XZ").regenSafe).toBe(false);
  });

  it("keeps a rotated QR (^GFA + sidecar) regenSafe without ^BY", () => {
    // The graphic path ignores ^BY; only a live ^BQ consumes it.
    const zpl = '^XA^FXZPLLAB:{"qr":{"content":"X","mag":4,"ec":"Q","model":2,"rot":"R"}}^FS^FO10,10^GFA,3,3,1,00,00,00^FS^XZ';
    expect(captured(zpl).regenSafe).toBe(true);
  });

  it("recognises an in-span ^BY under a remapped ^CD delimiter", () => {
    // The check reads tokenizer state, not raw bytes, so ^BY;;50 counts. The
    // page still loses regen safety, but to ^CD's own format-state reason,
    // not to a phantom missing ^BY.
    const r = parseSingle("^XA^CD;^FO10,10^BY;;50^BQN,2,5^FDQA,hello^FS^XZ", 8, {
      captureOverlay: true,
    });
    expect(r.overlay?.regenSafe).toBe(false);
    const reason = r.findings.find((f) => f.kind === "lossyEdit")?.command ?? "";
    expect(reason).toContain("format state");
    expect(reason).not.toContain("in-field ^BY");
  });

  it("treats an in-span ^BY,,0 as not pinning (zero is no height)", () => {
    // h=0 is no pin: the session height stays in charge.
    expect(captured("^XA^FO10,10^BY,,0^BQN,2,5^FDQA,hello^FS^XZ").regenSafe).toBe(false);
  });

  it("keeps an ^FT QR regenSafe without ^BY (anchor is ^BY-independent)", () => {
    expect(captured("^XA^FT10,200^BQN,2,5^FDQA,hello^FS^XZ").regenSafe).toBe(true);
  });

  it("keeps a DataMatrix regenSafe without ^BY", () => {
    expect(captured("^XA^FO10,10^BXN,5,200^FDhello^FS^XZ").regenSafe).toBe(true);
  });

  it("flags an out-of-field ^FC as not regenSafe (raw ^FC would arm a regenerated neighbour)", () => {
    const o = captured("^XA^FC$,{,#^FO50,50^A0N,30,30^FD$m/$d^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("keeps in-field ^FC/^FE arming regenSafe (regen replaces it with the field)", () => {
    const o = captured("^XA^FO50,50^A0N,30,30^FC$,{,#^FD$m/$d^FS^XZ");
    expect(o.regenSafe).toBe(true);
  });

  it("flags a bare in-field ^FC as not regenSafe (inherits chars a regen may redefine)", () => {
    const o = captured(
      "^XA^FO10,10^A0N,30,30^FC@,{,#^FD@d^FS^FO10,60^A0N,30,30^FC^FD@m^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("flags a partial ^FC (omitted params) as not regenSafe", () => {
    const o = captured("^XA^FO10,10^A0N,30,30^FC%^FD%d^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("flags a ^FE after the field's ^FD as not regenSafe (arms the next ^FD on firmware)", () => {
    const o = captured("^XA^FO50,50^A0N,30,30^FDx^FE@^FS^FO50,90^A0N,30,30^FDy^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("flags an armed field without ^FD as not regenSafe (arming rides past the ^FS)", () => {
    const o = captured("^XA^FO50,50^FE@^FS^FO50,90^A0N,30,30^FDy^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  // In-span persistent definitions: regen replaces the span and drops the
  // definition a later verbatim field consumes.
  it("flags an in-span ^CF as not regenSafe (later ^A-less field consumes it)", () => {
    const o = captured("^XA^FO50,50^CF0,80^FDAAA^FS^FO50,200^FDBBB^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("flags an in-span ^FW as not regenSafe", () => {
    const o = captured("^XA^FO50,50^FWR^FDAAA^FS^FO50,200^FDBBB^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("flags an in-span ^CW as not regenSafe", () => {
    const o = captured(
      "^XA^FO50,50^CWZ,E:FONT.FNT^A0N,30,30^FDAAA^FS^FO50,200^AZN,30,30^FDBBB^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("flags an in-span ^SO as not regenSafe", () => {
    const o = captured(
      "^XA^FO50,50^SO2,0,0,0,1,0,0^FDAAA^FS^FO50,200^FC%,{,#^FD%m^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("keeps a ^CF between fields regenSafe (raw segment survives regen)", () => {
    const o = captured("^XA^CF0,80^FO50,50^FDAAA^FS^FO50,200^FDBBB^FS^XZ");
    expect(o.regenSafe).toBe(true);
  });

  it("flags a mid-block ^LH change as not regenSafe (single end-state frame)", () => {
    const o = captured("^XA^FO50,50^FDAAA^FS^LH100,100^FO50,200^FDBBB^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("keeps a pre-field ^LH regenSafe (frame snapshot matches every field)", () => {
    const o = captured("^XA^LH50,20^FO10,10^A0N,30,30^FDx^FS^XZ");
    expect(o.regenSafe).toBe(true);
  });

  it("flags a block with a bare ^FN declaration as not regenSafe (would duplicate it)", () => {
    const o = captured("^XA^FN7^FDACME^FS^FO50,50^A0N,30,30^FDx^FS^XZ");
    expect(o.regenSafe).toBe(false);
  });

  it("captures the ^LH frame so a regen can be home-relative", () => {
    const o = captured("^XA^LH50,20^FO10,10^A0N,30,30^FDx^FS^XZ");
    expect(o.frame).toEqual({ homeX: 50, homeY: 20, top: 0 });
  });

  it("is undefined when capture is off", () => {
    const { overlay } = parseSingle("^XA^FO0,0^FDx^FS^XZ", 8);
    expect(overlay).toBeUndefined();
  });

  it("preserves comments and unmodeled commands as raw", () => {
    const zpl = "^XA^FX banner^FS^FO10,10^A0N,30,30^FDx^FS^PQ3^XZ";
    const o = captured(zpl);
    const raw = o.segments.filter((s) => s.kind === "raw").map((s) => s.text).join("");
    expect(raw).toContain("^FX banner^FS");
    expect(raw).toContain("^PQ3");
  });
});
