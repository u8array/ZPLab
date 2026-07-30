import { describe, it, expect } from 'vitest';
import { parseZPL } from '@zplab/core/lib/zplParser';
import { emitOverlayPage, generateMultiPageZPL, generateZPL } from '@zplab/core/lib/zplGenerator';
import { importZplText, rebaseAppendedPageDensity } from '@zplab/core/lib/zplImportService';
import { parseDesignFile, serializeDesign } from '@zplab/core/lib/designFile';
import { effectiveDpmm, type JmDensity, type LabelConfig } from "@zplab/core/types/LabelConfig";
import { printableRectDots } from '@zplab/core/lib/objectBounds';
import { blockOverlaySchema } from '@zplab/core/lib/zplOverlay/overlay';

const base: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8 };

describe('^JM density', () => {
  it('effectiveDpmm halves only under B', () => {
    expect(effectiveDpmm({ dpmm: 8 })).toBe(8);
    expect(effectiveDpmm({ dpmm: 8, jmDensity: 'A' })).toBe(8);
    expect(effectiveDpmm({ dpmm: 8, jmDensity: 'B' })).toBe(4);
  });

  it('reads ^PW/^LL as physical head dots under ^JMB (ZD230-verified)', () => {
    const { labelConfig } = parseZPL('^XA^JMB^PW400^LL200^XZ', 8);
    expect(labelConfig.jmDensity).toBe('B');
    expect(labelConfig.widthMm).toBe(50);
    expect(labelConfig.heightMm).toBe(25);
  });

  it('keeps ^PW/^LL physical when ^JM arrives after them (jm-independent)', () => {
    const { labelConfig } = parseZPL('^XA^PW400^LL200^JMB^XZ', 8);
    expect(labelConfig.widthMm).toBe(50);
    expect(labelConfig.heightMm).toBe(25);
  });

  it('reads a bare ^JM as full density A (spec default p269)', () => {
    expect(parseZPL('^XA^JM^PW400^XZ', 8).labelConfig.jmDensity).toBe('A');
  });

  it('reads ^MU inch ^ML as physical dots, ^JM-independent and order-invariant (ZD230)', () => {
    expect(parseZPL('^XA^JMB^MUI^ML2^XZ', 8).labelConfig.maxLabelLength).toBe(
      parseZPL('^XA^MUI^JMB^ML2^XZ', 8).labelConfig.maxLabelLength,
    );
    // ZD230: ^ML is physical, so 2 in = 2 * 8 * 25.4 = 406 dots under ^JMA or ^JMB.
    expect(parseZPL('^XA^MUI^JMB^ML2^XZ', 8).labelConfig.maxLabelLength).toBe(406);
  });

  it('reads unit-converted ^ML physically whether ^JM leads or trails ^MU', () => {
    expect(parseZPL('^XA^JMB^MUI^ML2^XZ', 8).labelConfig.maxLabelLength).toBe(406);
    expect(parseZPL('^XA^MUI^ML2^JMB^XZ', 8).labelConfig.maxLabelLength).toBe(406);
  });

  it('rescales a unit-converted ^FO the same whether ^JM leads or trails ^MU', () => {
    const lead = parseZPL('^XA^JMB^MUI^FO2,1^A0N,1,1^FDx^FS^XZ', 8);
    const trail = parseZPL('^XA^MUI^FO2,1^JMB^A0N,1,1^FDx^FS^XZ', 8);
    expect((lead.pages[0]?.objects[0] as { x: number }).x).toBe(203);
    expect((trail.pages[0]?.objects[0] as { x: number }).x).toBe(203);
  });

  it('does not retroactively rescale a prior format across ^XA (persistent dots)', () => {
    const r = parseZPL('^XA^MUI^ML2^XZ^XA^JMB^XZ', 8);
    expect(r.pages[1]?.labelConfig.maxLabelLength).toBe(406);
  });

  it('round-trips: emits ^JMB plus physical ^PW and parses back', () => {
    const zpl = generateZPL({ ...base, jmDensity: 'B' }, []);
    expect(zpl).toContain('^JMB');
    expect(zpl).toContain('^PW800');
    expect(zpl.indexOf('^JMB')).toBeLessThan(zpl.indexOf('^FS') === -1 ? zpl.length : zpl.indexOf('^FS'));
    const back = parseZPL(zpl, 8).labelConfig;
    expect(back.jmDensity).toBe('B');
    expect(back.widthMm).toBe(100);
    expect(back.heightMm).toBe(50);
  });

  it('an explicit ^JMA round-trips without rescaling', () => {
    const { labelConfig } = parseZPL('^XA^JMA^PW400^XZ', 8);
    expect(labelConfig.jmDensity).toBe('A');
    expect(labelConfig.widthMm).toBe(50);
    expect(generateZPL({ ...base, jmDensity: 'A' }, [])).toContain('^JMA');
  });

  it('drops an invalid ^JM value', () => {
    expect(parseZPL('^XA^JMX^PW400^XZ', 8).labelConfig.jmDensity).toBeUndefined();
  });

  it('keeps block 0 config; a later block ^JMB does not leak (retroactive rescale)', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ^XA^JMB^FO10,10^A0N,30,30^FDb^FS^XZ',
      8,
    );
    expect(r.labelConfig.jmDensity).toBeUndefined();
    // A later block that diverges in density is flagged (single-label model
    // keeps only block 0's).
    expect(
      r.report.findings.some(
        (f) => f.kind === 'mixedPageGeometry' && f.command === '^JM' && f.pageIndex === 1,
      ),
    ).toBe(true);
  });

  it('round-trips a per-page ^JM override through save/load', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^JMB^FO10,10^A0N,30,30^FDb^FS^XZ',
      8,
    );
    const label = { ...base, ...r.labelConfig };
    const loaded = parseDesignFile(serializeDesign(label, r.pages, r.variables));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages[1]?.jmDensity).toBe('B');
    expect(generateMultiPageZPL(loaded.value.label, loaded.value.pages, loaded.value.variables)).toBe(
      generateMultiPageZPL(label, r.pages, r.variables),
    );
  });

  // Main-era payloads (schemaVersion 3) never modelled ^JM: the head ^JMB rode
  // only in the overlay bytes, with no overlay.head and no page.jmDensity.
  // Load must reconstruct the override so regeneration keeps the density.
  it('reconstructs a legacy overlay ^JMB (no head, no page override) on load', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^FO10,10^JMB^A0N,30,30^FDb^FS^XZ',
      8,
    );
    const label = { ...base, ...r.labelConfig };
    expect(label.jmDensity).toBeUndefined();
    const legacyPages = r.pages.map((p) => {
      const overlay = p.overlay ? { ...p.overlay } : undefined;
      if (overlay) delete overlay.head;
      return { objects: p.objects, overlay };
    });
    const loaded = parseDesignFile(serializeDesign(label, legacyPages, r.variables));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages[1]?.jmDensity).toBe('B');
    // Force a full regeneration of page 1 (the in-span ^JMB block is regen-
    // hostile, so a dirty edit falls back to model regen).
    const pages = loaded.value.pages.map((p, i) =>
      i === 1
        ? { ...p, objects: p.objects.map((o) => ({ ...o, x: o.x + 5, dirty: true })) }
        : p,
    );
    const out = generateMultiPageZPL(loaded.value.label, pages, loaded.value.variables);
    expect(out.split('^XZ')[1]).toContain('^JMB');
  });

  it('leaves a legacy overlay without a diverging ^JM unpinned on load', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^FO10,10^A0N,30,30^FDb^FS^XZ',
      8,
    );
    const label = { ...base, ...r.labelConfig };
    const legacyPages = r.pages.map((p) => {
      const overlay = p.overlay ? { ...p.overlay } : undefined;
      if (overlay) delete overlay.head;
      return { objects: p.objects, overlay };
    });
    const loaded = parseDesignFile(serializeDesign(label, legacyPages, r.variables));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages[0]?.jmDensity).toBeUndefined();
    expect(loaded.value.pages[1]?.jmDensity).toBeUndefined();
  });

  // A main-era save carried a head ^JMB only in the overlay bytes (no head, no
  // page override). Reconstruction must synthesize the head so a zero-edit
  // export stays on the verbatim path instead of regenerating the block.
  it('replays a legacy head ^JMB byte-identically on a zero-edit export', () => {
    const src = '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^JMB^FO10,10^A0N,30,30^FDb^FS^XZ';
    const r = importZplText(src, 8);
    const label = { ...base, ...r.labelConfig };
    expect(label.jmDensity).toBeUndefined();
    const legacyPages = r.pages.map((p) => {
      const overlay = p.overlay ? { ...p.overlay } : undefined;
      if (overlay) delete overlay.head;
      return { objects: p.objects, overlay };
    });
    const loaded = parseDesignFile(serializeDesign(label, legacyPages, r.variables));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.pages[1]?.jmDensity).toBe('B');
    const out = generateMultiPageZPL(loaded.value.label, loaded.value.pages, loaded.value.variables);
    expect(out).toBe(src);
  });

  it('still carries ^JMB after an object edit on a reconstructed legacy head', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^JMB^FO10,10^A0N,30,30^FDb^FS^XZ',
      8,
    );
    const label = { ...base, ...r.labelConfig };
    const legacyPages = r.pages.map((p) => {
      const overlay = p.overlay ? { ...p.overlay } : undefined;
      if (overlay) delete overlay.head;
      return { objects: p.objects, overlay };
    });
    const loaded = parseDesignFile(serializeDesign(label, legacyPages, r.variables));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const pages = loaded.value.pages.map((p, i) =>
      i === 1
        ? { ...p, objects: p.objects.map((o) => ({ ...o, x: o.x + 5, dirty: true })) }
        : p,
    );
    const out = generateMultiPageZPL(loaded.value.label, pages, loaded.value.variables);
    expect(out.split('^XZ')[1]).toContain('^JMB');
  });

  it('rewrites a reconstructed ^JMB when the model contradicts it (density A)', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^JMB^FO10,10^A0N,30,30^FDb^FS^XZ',
      8,
    );
    const label = { ...base, ...r.labelConfig };
    const legacyPages = r.pages.map((p) => {
      const overlay = p.overlay ? { ...p.overlay } : undefined;
      if (overlay) delete overlay.head;
      return { objects: p.objects, overlay };
    });
    const loaded = parseDesignFile(serializeDesign(label, legacyPages, r.variables));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // rescaleJmDensity drops overlays on a density change, so construct the
    // model/head contradiction directly: force page 1 back to A.
    const pages = loaded.value.pages.map((p, i) => (i === 1 ? { ...p, jmDensity: 'A' as const } : p));
    const block1 = generateMultiPageZPL(loaded.value.label, pages, loaded.value.variables).split('^XZ')[1] ?? '';
    expect(block1).toContain('^JMA');
    expect(block1).not.toContain('^JMB');
  });

  it('is idempotent: a second load leaves the reconstructed head untouched', () => {
    const src = '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^JMB^FO10,10^A0N,30,30^FDb^FS^XZ';
    const r = importZplText(src, 8);
    const label = { ...base, ...r.labelConfig };
    const legacyPages = r.pages.map((p) => {
      const overlay = p.overlay ? { ...p.overlay } : undefined;
      if (overlay) delete overlay.head;
      return { objects: p.objects, overlay };
    });
    const first = parseDesignFile(serializeDesign(label, legacyPages, r.variables));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.pages[1]?.overlay?.head).toBeDefined();
    const second = parseDesignFile(
      serializeDesign(first.value.label, first.value.pages, first.value.variables),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.pages).toEqual(first.value.pages);
    expect(
      generateMultiPageZPL(second.value.label, second.value.pages, second.value.variables),
    ).toBe(src);
  });

  it('rescales a committed graphic the same whether ^JM leads or trails ^MU', () => {
    const lead = parseZPL('^XA^JMB^MUM^FO2,2^GE4,2,1^FS^XZ', 8);
    const trail = parseZPL('^XA^MUM^FO2,2^GE4,2,1^JMB^FS^XZ', 8);
    const pick = (r: ReturnType<typeof parseZPL>) => {
      const o = r.pages[0]?.objects[0] as { x: number; y: number; props: { width: number; height: number; thickness: number } };
      const { width, height, thickness } = o.props;
      return { x: o.x, y: o.y, width, height, thickness };
    };
    expect(pick(trail)).toEqual({ x: 8, y: 8, width: 16, height: 8, thickness: 4 });
    expect(pick(lead)).toEqual(pick(trail));
  });

  it('rescales ^CF default font dots the same whether ^JM leads or trails', () => {
    const lead = parseZPL('^XA^JMB^MUM^CF0,4,2^XZ', 8).labelConfig;
    const trail = parseZPL('^XA^MUM^CF0,4,2^JMB^XZ', 8).labelConfig;
    expect(trail.defaultFontHeight).toBe(16);
    expect(trail.defaultFontWidth).toBe(8);
    expect(lead.defaultFontHeight).toBe(trail.defaultFontHeight);
    expect(lead.defaultFontWidth).toBe(trail.defaultFontWidth);
  });


  it('printableRectDots follows the effective density (drag bounds, align, spawn)', () => {
    expect(printableRectDots(base).width).toBe(800);
    expect(printableRectDots({ ...base, jmDensity: 'B' })).toMatchObject({ width: 400, height: 200 });
  });

  it('^PW is jm-independent across blocks (physical, same mm both pages)', () => {
    const r = parseZPL('^XA^JMB^PW400^XZ^XA^JMA^XZ', 8);
    expect(r.pages[0]?.labelConfig.widthMm).toBe(50);
    expect(r.pages[1]?.labelConfig.widthMm).toBe(50);
    expect(r.pages[1]?.labelConfig.jmDensity).toBe('A');
  });


  it('ignores a ^JM after the format has seen its first ^FS (printer does too)', () => {
    const { labelConfig } = parseZPL('^XA^FO10,10^GB10,10,1^FS^JMB^PW400^XZ', 8);
    expect(labelConfig.jmDensity).toBeUndefined();
    expect(labelConfig.widthMm).toBe(50);
    // A later format may still set it (fresh ^FS budget per ^XA).
    const r = parseZPL('^XA^FO10,10^GB10,10,1^FS^XZ^XA^JMB^PW400^XZ', 8);
    expect(r.pages[1]?.labelConfig.jmDensity).toBe('B');
  });


  it('an in-span ^JMB survives a dirty-object regen (persistent-def fallback)', () => {
    const zpl = '^XA^FO10,10^JMB^BY2^BCN,100,N,N,N^FD123^FS^FO200,10^A0N,30,30^FDx^FS^XZ';
    const r = importZplText(zpl, 8);
    const page = r.pages[0]!;
    const first = page.objects[0]! as { x: number };
    const edited = {
      ...page,
      objects: page.objects.map((o, i) => (i === 0 ? { ...o, x: first.x + 5, dirty: true } : o)),
    };
    const out = emitOverlayPage({ widthMm: 100, heightMm: 50, dpmm: 8, ...r.labelConfig }, edited, r.variables);
    expect(out).toContain('^JMB');
  });

  it('re-emits a later page ^JMB when a dirty edit forces its full regen', () => {
    // The in-span ^JMB makes the block regen-hostile, so the dirty edit falls
    // back to model regeneration; without the page override that drops ^JMB and
    // the page silently prints at full density.
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^FO10,10^JMB^A0N,30,30^FDb^FS^XZ',
      8,
    );
    expect(r.labelConfig.jmDensity).toBeUndefined();
    expect(r.pages[1]?.jmDensity).toBe('B');
    const pages = r.pages.map((p, i) =>
      i === 1
        ? { ...p, objects: p.objects.map((o) => ({ ...o, x: o.x + 5, dirty: true })) }
        : p,
    );
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig }, pages, r.variables);
    expect(out.split('^XZ')[1]).toContain('^JMB');
  });

  it('declares an inherited ^JMB when the leading settings-only block is gone', () => {
    const r = importZplText('^XA^JMB^XZ\n^XA^FO10,10^A0N,30,30^FDa^FS^XZ', 8);
    const label = { ...base, ...r.labelConfig };
    // Full replay stays byte-identical: the leading block still carries ^JMB.
    expect(generateMultiPageZPL(label, r.pages, r.variables)).toBe(
      '^XA^JMB^XZ\n^XA^FO10,10^A0N,30,30^FDa^FS^XZ',
    );
    expect(generateMultiPageZPL(label, r.pages.slice(1), r.variables)).toBe(
      '^XA^JMB^FO10,10^A0N,30,30^FDa^FS^XZ',
    );
  });

  it('persists within the stream: block 2 inherits block 1 ^JMB', () => {
    const r = parseZPL('^XA^JMB^PW400^XZ^XA^PW400^XZ', 8);
    expect(r.pages[1]?.labelConfig.jmDensity).toBe('B');
    expect(r.pages[1]?.labelConfig.widthMm).toBe(50);
  });

  // ── Format-head lookahead: reads matching a prior block value ────────────
  it('keeps ^ML physical on a later ^JMB block (ZD230: ^JM-independent)', () => {
    // ^ML reads at physical head dots, so ^JMB does not halve it; both blocks
    // hold the same 2 in = 406.
    const r = parseZPL('^XA^MUI^ML2^XZ^XA^MUI^ML2^JMB^XZ', 8);
    expect(r.pages[0]?.labelConfig.maxLabelLength).toBe(406);
    expect(r.pages[1]?.labelConfig.maxLabelLength).toBe(406);
  });

  it('rescales a field origin equal to a prior block value', () => {
    const r = parseZPL(
      '^XA^MUI^FO2,0^A0N,1,1^FDa^FS^XZ^XA^MUI^FO2,0^JMB^A0N,1,1^FDb^FS^XZ',
      8,
    );
    expect((r.pages[0]?.objects[0] as { x: number }).x).toBe(406);
    expect((r.pages[1]?.objects[0] as { x: number }).x).toBe(203);
  });

  it('scales only the ^FO dots, not a persistent ^LH offset (composite)', () => {
    // ^LH set full-density in block 0 persists; block 1 adds it, then ^JMB.
    // Only the ^FO 2in halves (406→203); the kept 203-dot home is not scaled.
    const r = parseZPL('^XA^MUI^LH1,0^XZ^XA^MUI^FO2,0^JMB^A0N,1,1^FDx^FS^XZ', 8);
    expect((r.pages[1]?.objects[0] as { x: number }).x).toBe(406);
  });

  it('scales a same-block ^LH and the ^FO that adds it together', () => {
    const r = parseZPL('^XA^MUI^LH1,0^FO2,0^JMB^A0N,1,1^FDx^FS^XZ', 8);
    // lhX 203→102, FO 406→203, field.x = 203 + 102 = 305.
    expect((r.pages[0]?.objects[0] as { x: number }).x).toBe(305);
  });

  it('recomputes a fractional ^MU coordinate from raw (no double rounding), lead==trail', () => {
    const lead = parseZPL('^XA^JMB^MUM^FO1.1,0^A0N,1,1^FDx^FS^XZ', 8);
    const trail = parseZPL('^XA^MUM^FO1.1,0^JMB^A0N,1,1^FDx^FS^XZ', 8);
    // 1.1mm @ 4 dots/mm = 4.4 → 4. Scaling the 9-dot full-density value would
    // double-round to 5.
    expect((lead.pages[0]?.objects[0] as { x: number }).x).toBe(4);
    expect((trail.pages[0]?.objects[0] as { x: number }).x).toBe(4);
  });
});

// ── Format-head ^JM lookahead ────────────────────────────────────────────────
// The lookahead resolves the format's density before any body token, so lead and
// trail placements of ^JM are identical by construction; each pair asserts that.
describe('^JM format-head lookahead', () => {
  const x0 = (r: ReturnType<typeof parseZPL>) => (r.pages[0]?.objects[0] as { x: number }).x;

  it('reads ^ML at the physical I-scale despite trailing ^MU-mode churn', () => {
    // ^MUI^ML2 = 2 in = 406 physical dots (ZD230); neither the later ^MUM nor
    // ^JMB shifts it.
    expect(parseZPL('^XA^MUI^ML2^MUM^JMB^XZ', 8).labelConfig.maxLabelLength).toBe(406);
  });

  it('leaves ^MUD reads invariant under ^JMB, lead==trail', () => {
    expect(parseZPL('^XA^JMB^MUD^ML200^XZ', 8).labelConfig.maxLabelLength).toBe(200);
    expect(parseZPL('^XA^MUD^ML200^JMB^XZ', 8).labelConfig.maxLabelLength).toBe(200);
  });

  it('applies a mid-field-flush ^JMB to the surviving field, lead==trail', () => {
    // The second ^FO flushes the first (dataless) field; ^JMB still precedes the
    // format's first ^FS, so it applies to the whole format. FO3in = 3*4*25.4=305.
    expect(x0(parseZPL('^XA^JMB^MUI^FO2,0^FO3,0^A0N,1,1^FDx^FS^XZ', 8))).toBe(305);
    expect(x0(parseZPL('^XA^MUI^FO2,0^FO3,0^JMB^A0N,1,1^FDx^FS^XZ', 8))).toBe(305);
  });

  it('rescales a stashed reverse-bg ^GB under ^JMB, lead==trail', () => {
    const pick = (r: ReturnType<typeof parseZPL>) => {
      const o = r.pages[0]?.objects[0] as { x: number; y: number };
      return { x: o.x, y: o.y };
    };
    const lead = parseZPL('^XA^JMB^MUM^FO2,2^GB4,4,4^FS^XZ', 8);
    const trail = parseZPL('^XA^MUM^FO2,2^GB4,4,4^JMB^FS^XZ', 8);
    expect(pick(trail)).toEqual({ x: 8, y: 8 });
    expect(pick(lead)).toEqual(pick(trail));
  });

  it('rescales a ^GS symbol and its width fallback under ^JMB, lead==trail', () => {
    const dims = (r: ReturnType<typeof parseZPL>) => {
      const p = (r.pages[0]?.objects[0] as { props: { height: number; width: number } }).props;
      return { height: p.height, width: p.width };
    };
    // ^GS,4 omits the width slot → it falls back to the (scaled) height.
    const lead = parseZPL('^XA^JMB^MUM^FO0,0^GS,4^FDA^FS^XZ', 8);
    const trail = parseZPL('^XA^MUM^FO0,0^GS,4^JMB^FDA^FS^XZ', 8);
    expect(dims(trail)).toEqual({ height: 16, width: 16 });
    expect(dims(lead)).toEqual(dims(trail));
  });

  it('rescales ^LS under ^JMB, lead==trail', () => {
    expect(parseZPL('^XA^JMB^MUM^LS4^XZ', 8).labelConfig.labelShift).toBe(16);
    expect(parseZPL('^XA^MUM^LS4^JMB^XZ', 8).labelConfig.labelShift).toBe(16);
  });

  it('rescales ^PF like the other dot-row commands, lead==trail', () => {
    expect(parseZPL('^XA^MUI^PF1^XZ', 8).labelConfig.slewDotRows).toBe(203);
    expect(parseZPL('^XA^JMB^MUM^PF4^XZ', 8).labelConfig.slewDotRows).toBe(16);
    expect(parseZPL('^XA^MUM^PF4^JMB^XZ', 8).labelConfig.slewDotRows).toBe(16);
  });

  it('reads ^PW/^LL at physical density under ^JMB+^MUI (ZD230), order-independent', () => {
    // ZD230-verified: 2in print width = 406 physical dots and 3in length = 609,
    // both unchanged by ^JM and its placement (only object dots are halved).
    for (const z of ['^XA^MUI^PW2^LL3^XZ', '^XA^JMB^MUI^PW2^LL3^XZ', '^XA^MUI^PW2^LL3^JMB^XZ']) {
      const { labelConfig } = parseZPL(z, 8);
      expect(labelConfig.widthMm).toBe(50.8);
      expect(labelConfig.heightMm).toBe(76.3);
    }
  });

  it('surfaces an invalid or post-^FS ^JM as a partial import', () => {
    const invalid = parseZPL('^XA^JMX^XZ', 8);
    expect(invalid.pages[0]?.findings.some((f) => f.kind === 'partial' && f.command === '^JM')).toBe(true);
    const postFs = parseZPL('^XA^FO10,10^GB10,10,1^FS^JMB^XZ', 8);
    expect(postFs.pages[0]?.findings.some((f) => f.kind === 'partial' && f.command === '^JM')).toBe(true);
  });

  it('ignores ~JM (not a real command): no density, routed as a device action', () => {
    const r = parseZPL('^XA~JMB^PW400^XZ', 8);
    expect(r.labelConfig.jmDensity).toBeUndefined();
    expect(r.pages[0]?.findings.some((f) => f.kind === 'deviceAction' && f.command === '~JM')).toBe(true);
  });

  it('a post-first-^FS in-span ^JM is a no-op, so it does not force a lossy regen', () => {
    // ^JMB sits in the SECOND field span, after the format's first ^FS. It is
    // ignored (no density change), so it defines nothing a regen would drop and
    // must not mark the overlay lossy.
    const r = parseZPL(
      '^XA^FO10,10^A0N,30,30^FDa^FS^FO50,50^JMB^A0N,30,30^FDb^FS^XZ',
      8,
      { captureOverlay: true },
    );
    expect(r.pages[0]?.overlay).toBeDefined();
    expect(r.pages[0]?.findings.some((f) => f.kind === 'lossyEdit')).toBe(false);
  });

  it('a pre-first-^FS in-span ^JM stays regen-hostile (definition lives in the span)', () => {
    // ^JMB before the field's ^FS is applied by the lookahead; the span replace
    // would drop it, so the overlay must be flagged lossy.
    const r = parseZPL(
      '^XA^FO10,10^JMB^A0N,30,30^FDa^FS^XZ',
      8,
      { captureOverlay: true },
    );
    expect(r.pages[0]?.findings.some((f) => f.kind === 'lossyEdit')).toBe(true);
  });

  it('a headless format does not inherit the next format ^JM (lookahead stops at ^XA)', () => {
    // Format 0 has no ^FS/^XZ before the next ^XA; its head must not scan into
    // format 1 and pick up that block's ^JMB. Format 0 stays ^JMA, so ^MUI^ML2
    // reads full-density physical 406, not the halved 203.
    const r = parseZPL('^XA^MUI^ML2^XA^JMB^ML2^XZ', 8);
    expect(r.pages[0]?.labelConfig.jmDensity).toBeUndefined();
    expect(r.pages[0]?.labelConfig.maxLabelLength).toBe(406);
  });

  it('tracks a ^CC prefix remap in the head so a remapped ^JM still resolves', () => {
    // ^CC/ remaps the caret to '/'; the head lookahead must follow it to see /JMB.
    expect(parseZPL('^XA^CC//JMB/XZ', 8).labelConfig.jmDensity).toBe('B');
  });

  it('reports a pre-^XA ^JM as partial without applying a density (no format head)', () => {
    const r = parseZPL('^JMB^XA^PW400^XZ', 8);
    expect(r.labelConfig.jmDensity).toBeUndefined();
    expect(r.pages[0]?.findings.some((f) => f.kind === 'partial' && f.command === '^JM')).toBe(true);
  });
});

// ── Wire transition matrix ───────────────────────────────────────────────────
// ^JM is persistent (p269): what a block must declare depends on what the
// preceding blocks left on the wire. `[]` = declares nothing and inherits.
describe('^JM wire transitions across exported blocks', () => {
  const declaredJm = (block: string) => [...block.matchAll(/\^JM(.)/g)].map((m) => m[1]);
  const blocks = (zpl: string) => zpl.split('^XZ').slice(0, -1);

  const cases: {
    name: string;
    design?: JmDensity;
    pages: (JmDensity | undefined)[];
    expected: string[][];
  }[] = [
    { name: 'unset -> unset', pages: [undefined, undefined], expected: [[], []] },
    { name: 'unset -> A', pages: [undefined, 'A'], expected: [[], ['A']] },
    { name: 'unset -> B', pages: [undefined, 'B'], expected: [[], ['B']] },
    { name: 'A -> B', pages: ['A', 'B'], expected: [['A'], ['B']] },
    { name: 'B -> A', pages: ['B', 'A'], expected: [['B'], ['A']] },
    { name: 'B -> unset resets the wire', pages: ['B', undefined], expected: [['B'], ['A']] },
    { name: 'A -> unset needs no reset', pages: ['A', undefined], expected: [['A'], []] },
    { name: 'B -> B stays on one density', pages: ['B', 'B'], expected: [['B'], ['B']] },
    { name: 'B -> unset -> B', pages: ['B', undefined, 'B'], expected: [['B'], ['A'], ['B']] },
    {
      name: 'design B: an unset page inherits it',
      design: 'B',
      pages: [undefined, undefined],
      expected: [['B'], ['B']],
    },
    {
      name: 'design B: a page overriding to A resets, the next inherits B again',
      design: 'B',
      pages: [undefined, 'A', undefined],
      expected: [['B'], ['A'], ['B']],
    },
  ];

  for (const { name, design, pages, expected } of cases) {
    it(name, () => {
      const label: LabelConfig = design ? { ...base, jmDensity: design } : base;
      const modelPages = pages.map((jm) => (jm ? { objects: [], jmDensity: jm } : { objects: [] }));
      const out = generateMultiPageZPL(label, modelPages, []);
      expect(blocks(out).map(declaredJm)).toEqual(expected);
    });
  }

  it('lets the last ^JM in a format head win', () => {
    expect(parseZPL('^XA^JMB^JMA^PW400^XZ', 8).labelConfig.jmDensity).toBe('A');
    expect(parseZPL('^XA^JMA^JMB^PW400^XZ', 8).labelConfig.jmDensity).toBe('B');
  });

  it('resets an inherited ^JMB for a page added after it (empty new page)', () => {
    const r = importZplText('^XA^JMB^FO10,10^A0N,30,30^FDa^FS^XZ', 8);
    const label = { ...base, ...r.labelConfig, jmDensity: undefined };
    const pages = [{ ...r.pages[0]!, jmDensity: 'B' as const }, { objects: [] }];
    expect(blocks(generateMultiPageZPL(label, pages, r.variables)).map(declaredJm)).toEqual([
      ['B'],
      ['A'],
    ]);
  });

  it('declares an inherited density with the block own caret after a ^CC remap', () => {
    // Block 0 remaps the caret to '/', so block 1 opens as /XA. Dropping block 0
    // takes its ^JMB with it; the declaration has to go back in as /JMB, since
    // a literal ^JM would not reach a printer left on the remapped prefix.
    const r = importZplText('^XA^JMB^CC/^XZ\n/XA/FO10,10/A0N,30,30/FDa/FS/XZ', 8);
    const label = { ...base, ...r.labelConfig };
    expect(label.jmDensity).toBe('B');
    const out = generateMultiPageZPL(label, r.pages.slice(1), r.variables);
    expect(out).toContain('/JMB');
    expect(out).not.toContain('^JM');
  });

  it('lets a model ^JM change overrule the imported head bytes', () => {
    const r = importZplText('^XA^JMA^FO10,10^A0N,30,30^FDa^FS^XZ', 8);
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig, jmDensity: 'B' }, r.pages, r.variables);
    expect(declaredJm(out)).toEqual(['B']);
  });

  it('leaves the head alone when it already matches the model', () => {
    const r = importZplText('^XA^JMB^FO10,10^A0N,30,30^FDa^FS^XZ', 8);
    const label = { ...base, ...r.labelConfig };
    expect(label.jmDensity).toBe('B');
    expect(generateMultiPageZPL(label, r.pages, r.variables)).toBe(
      generateMultiPageZPL(label, r.pages, r.variables),
    );
    expect(declaredJm(generateMultiPageZPL(label, r.pages, r.variables))).toEqual(['B']);
  });

  it('does not credit the wire with a density a corrected head never carried', () => {
    // Block 0's ^JMA is corrected to B, so block 1 (also B) must not re-declare,
    // and a following unset page still needs its reset.
    const r = importZplText(
      '^XA^JMA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^FO10,10^A0N,30,30^FDb^FS^XZ',
      8,
    );
    const pages = [...r.pages, { objects: [], jmDensity: 'A' as const }];
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig, jmDensity: 'B' }, pages, r.variables);
    expect(blocks(out).map(declaredJm)).toEqual([['B'], [], ['A']]);
  });

  it('finds a remapped opener behind a ^CC preamble in the same block', () => {
    // The caret is remapped inside the block, ahead of its own opener, so the
    // declaration has to follow /XA; a literal ^JM would not reach the printer.
    const r = importZplText('^CC/\n/XA/FO10,10/A0N,30,30/FDa/FS/XZ', 8);
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig, jmDensity: 'B' }, r.pages, r.variables);
    expect(out).toContain('/JMB');
    expect(out).not.toContain('^JM');
    expect(out.indexOf('/JMB')).toBe(out.indexOf('/XA') + '/XA'.length);
  });

  it('keeps export idempotent across a re-import (no ^JM accretion)', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^JMB^FO10,10^A0N,30,30^FDb^FS^XZ\n^XA^FO10,10^A0N,30,30^FDc^FS^XZ',
      8,
    );
    const label = { ...base, ...r.labelConfig };
    const first = generateMultiPageZPL(label, r.pages, r.variables);
    // Block 3 declares nothing: ^JMB persists on the wire, so the import read
    // it as B too and the export has nothing to change.
    expect(blocks(first).map(declaredJm)).toEqual([[], ['B'], []]);
    const back = importZplText(first, 8);
    const second = generateMultiPageZPL({ ...base, ...back.labelConfig }, back.pages, back.variables);
    expect(second).toBe(first);
  });
});

describe('^JM format opener from the parsed head', () => {
  const declaredJm = (block: string) => [...block.matchAll(/.JM(.)/g)].map((m) => m[1]);

  it('injects at the block own opener, not at a literal ^XA in the bytes', () => {
    const r = importZplText('~CC!\n!XA!FO10,10!A0N,30,30!FD^XA!FS!XZ', 8);
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig, jmDensity: 'B' }, r.pages, r.variables);
    expect(out).toContain('!XA!JMB');
    expect(out).toContain('!FD^XA!FS');
  });

  it('follows a ~CT tilde remap ahead of the prefix setter', () => {
    const r = importZplText('~CT?\n?CC!\n!XA!FO10,10!A0N,30,30!FDa!FS!XZ', 8);
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig, jmDensity: 'B' }, r.pages, r.variables);
    expect(out).toContain('!XA!JMB');
    expect(declaredJm(out)).toEqual(['B']);
  });

  it('rewrites the head ^JM behind a remapped prefix instead of appending one', () => {
    const r = importZplText('~CC!\n!XA!JMA!FO10,10!A0N,30,30!FDa!FS!XZ', 8);
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig, jmDensity: 'B' }, r.pages, r.variables);
    expect(declaredJm(out)).toEqual(['B']);
    expect(out).toContain('!JMB');
  });

  it('injects at position 0 of a wrapper-less block', () => {
    const parsed = parseZPL('^FO10,10^A0N,30,30^FDa^FS', 8, { captureOverlay: true });
    const page = { ...parsed.pages[0]!, jmDensity: 'B' as const };
    const out = generateMultiPageZPL(base, [page], []);
    expect(out.startsWith('^JMB^FO10,10')).toBe(true);
  });

  it('persists the head through save/load so a reloaded design still patches it', () => {
    const r = importZplText('~CC!\n!XA!JMA!FO10,10!A0N,30,30!FDa!FS!XZ', 8);
    const loaded = parseDesignFile(serializeDesign({ ...base, ...r.labelConfig }, r.pages, r.variables));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const out = generateMultiPageZPL(
      { ...loaded.value.label, jmDensity: 'B' },
      loaded.value.pages,
      loaded.value.variables,
    );
    expect(declaredJm(out)).toEqual(['B']);
    expect(out).toContain('!JMB');
  });

  it('never mistakes a ~DY payload for the format head', () => {
    const src = '~DYR:L.GRF,B,G,4,2,^JMA\n^XA^FO10,10^A0N,30,30^FDa^FS^XZ';
    const r = importZplText(src, 8);
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig, jmDensity: 'B' }, r.pages, r.variables);
    expect(out.indexOf('^JMB')).toBe(out.indexOf('^XA') + '^XA'.length);
  });
});

describe('^JM in a wrapper-less stream', () => {
  it('applies a leading ^JM when no ^XA wraps the fields', () => {
    const r = importZplText('^JMB^FO10,10^A0N,30,30^FDX^FS', 8);
    expect(r.labelConfig.jmDensity).toBe('B');
    expect(r.pages[0]?.jmDensity).toBeUndefined();
  });

  it('rescales wrapper-less field dots at the halved density', () => {
    const bare = importZplText('^JMB^MUI^FO2,1^A0N,30,30^FDX^FS', 8);
    const wrapped = importZplText('^XA^JMB^MUI^FO2,1^A0N,30,30^FDX^FS^XZ', 8);
    expect((bare.pages[0]?.objects[0] as { x: number }).x).toBe(
      (wrapped.pages[0]?.objects[0] as { x: number }).x,
    );
  });

  it('still only reports a ^JM sitting before a real ^XA', () => {
    const r = importZplText('^JMB^XA^FO10,10^A0N,30,30^FDX^FS^XZ', 8);
    expect(r.labelConfig.jmDensity).toBeUndefined();
    expect(r.report.partial).toContain('^JM');
  });

  it('reports a preamble ^JM even behind a field of its own', () => {
    const r = importZplText('^JMB^FO10,10^A0N,30,30^FDX^FS^XA^FO1,1^A0N,30,30^FDy^FS^XZ', 8);
    expect(r.labelConfig.jmDensity).toBeUndefined();
    expect(r.report.partial).toContain('^JM');
  });
});

// A head runs from ^XA to the format's first ^FS. Outside one, a ^JM neither
// declares a density nor may be rewritten; inside one, it does both even when
// the value or the byte layout is not what the model expects.
describe('^JM outside a format head', () => {
  const declaredJm = (block: string) => [...block.matchAll(/\^JM(.)/g)].map((m) => m[1]);

  it('does not fold a ^JM between two blocks into the preceding head', () => {
    const src = '^XA^MMT^XZ\n^JMB\n^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n';
    const r = importZplText(src, 8);
    expect(r.labelConfig.jmDensity).toBeUndefined();
    expect(r.report.partial).toContain('^JM');
    expect(generateMultiPageZPL({ ...base, ...r.labelConfig }, r.pages, r.variables)).toBe(src);
  });

  it('does not swallow a ^JM after the format own first ^FS', () => {
    const r = importZplText('^XA^FO10,10^A0N,30,30^FDa^FS^JMB^XZ', 8);
    expect(r.labelConfig.jmDensity).toBeUndefined();
    expect(r.report.partial).toContain('^JM');
  });

  it('declares behind a head ^JM the printer may still read, not before it', () => {
    const r = importZplText('^XA^JMZ^FO10,10^A0N,30,30^FDa^FS^XZ', 8);
    expect(r.labelConfig.jmDensity).toBeUndefined();
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig, jmDensity: 'B' }, r.pages, r.variables);
    expect(out).toContain('^JMZ^JMB');
    expect(importZplText(out, 8).labelConfig.jmDensity).toBe('B');
  });

  it('reads the head value the way the parser does, delimiter included', () => {
    const r = importZplText('^XA^JMB,X^FO10,10^A0N,30,30^FDa^FS^XZ', 8);
    expect(r.labelConfig.jmDensity).toBe('B');
    // Model and bytes agree, so nothing is rewritten and the extra slot stays.
    const same = generateMultiPageZPL({ ...base, ...r.labelConfig }, r.pages, r.variables);
    expect(same).toContain('^JMB,X');
    const flipped = generateMultiPageZPL({ ...base, jmDensity: 'A' }, r.pages, r.variables);
    expect(flipped).toContain('^JMA,X');
    expect(importZplText(flipped, 8).labelConfig.jmDensity).toBe('A');
  });

  it('reads the head value at a ^CD-remapped delimiter', () => {
    const r = importZplText('^XA^CD;^JMB;X^FO10,10^A0N,30,30^FDa^FS^XZ', 8);
    expect(r.labelConfig.jmDensity).toBe('B');
    const flipped = generateMultiPageZPL({ ...base, jmDensity: 'A' }, r.pages, r.variables);
    expect(flipped).toContain('^JMA;X');
  });

  it('regenerates instead of splicing when a head span left the block', () => {
    const parsed = parseZPL('^XA^JMB^FO10,10^A0N,30,30^FDa^FS^XZ', 8, { captureOverlay: true });
    const page = parsed.pages[0]!;
    const overlay = { ...page.overlay!, head: { ...page.overlay!.head!, jmSpans: [{ start: 3, end: 9999, delim: ',', caret: '^' }] } };
    const out = generateMultiPageZPL({ ...base, jmDensity: 'A' }, [{ ...page, overlay, jmDensity: 'A' }], []);
    expect(declaredJm(out)).toEqual(['A']);
    expect(out.endsWith('^XZ')).toBe(true);
  });

  it('rejects a persisted head whose spans overlap or run backwards', () => {
    const parsed = parseZPL('^XA^JMB^FO10,10^A0N,30,30^FDa^FS^XZ', 8, { captureOverlay: true });
    const overlay = parsed.pages[0]!.overlay!;
    expect(blockOverlaySchema.safeParse(overlay).success).toBe(true);
    for (const jmSpans of [[{ start: 7, end: 3 }], [{ start: 3, end: 5 }], [{ start: 3, end: 7 }, { start: 5, end: 9 }]]) {
      expect(blockOverlaySchema.safeParse({ ...overlay, head: { ...overlay.head, jmSpans } }).success).toBe(false);
    }
  });
});

describe('^JM head offsets from the model emitter', () => {
  const declaredJm = (block: string) => [...block.matchAll(/\^JM(.)/g)].map((m) => m[1]);

  it('declares inside the block when a ~SD/~DY preamble precedes the opener', () => {
    const label: LabelConfig = { ...base, instantDarkness: 12, jmDensity: 'B' };
    const out = generateMultiPageZPL(label, [{ objects: [] }, { objects: [], jmDensity: 'A' }], []);
    expect(out).toContain('~SD12\n^XA\n^JMB');
    expect(declaredJm(out)).toEqual(['B', 'A']);
    expect(importZplText(out, 8).labelConfig.jmDensity).toBe('B');
  });
});

describe('^JM import fold divergence', () => {
  it('does not leak the design density onto a settings-only block that prints at A', () => {
    const r = importZplText('^XA^MNY^XZ\n^XA^JMB^FO10,10^A0N,30,30^FDy^FS^XZ', 8);
    expect(r.labelConfig.jmDensity).toBe('B');
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig }, r.pages, r.variables);
    const [block0, block1] = out.split('^XZ');
    expect(block0).not.toContain('^JMB');
    expect(block1).toContain('^JMB');
  });

  it('keeps ^JMB after a ^CC arg the handler rejects (space)', () => {
    const r = importZplText('^XA^CC ^JMB^FO10,10^A0N,30,30^FDy^FS^XZ', 8);
    expect(r.labelConfig.jmDensity).toBe('B');
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig }, r.pages, r.variables);
    expect(out).toContain('^JMB');
    expect(out).not.toContain('^JMA');
  });

  it('keeps ^JMB after a ^CD arg the handler rejects (caret)', () => {
    const r = importZplText('^XA^CD^^JMB,x^FO10,10^A0N,30,30^FDy^FS^XZ', 8);
    expect(r.labelConfig.jmDensity).toBe('B');
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig }, r.pages, r.variables);
    expect(out).not.toContain('^JMA');
  });

  it('reads each head ^JM span with the delimiter live at that span', () => {
    const r = importZplText('^XA^CD;^JMB;x^CD,^JMQ,y^FO10,10^A0N,30,30^FDa^FS^XZ', 8);
    expect(r.labelConfig.jmDensity).toBe('B');
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig }, r.pages, r.variables);
    expect((out.match(/\^JM/g) ?? []).length).toBe(2);
  });

  it('rewrites a head ^JM behind an in-head ^CC remap with its live caret', () => {
    // ^CC/ ahead of the ^JM makes the span open as /JMB, not ^JMB; a model flip
    // must patch it in place as /JMA rather than fall back to regeneration.
    const r = importZplText('^XA^CC//JMB/FO10,10/A0N,30,30/FDa/FS/XZ', 8);
    expect(r.labelConfig.jmDensity).toBe('B');
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig, jmDensity: 'A' }, r.pages, r.variables);
    expect(out).toContain('/JMA');
    expect(out).not.toContain('/JMB');
  });

  it('round-trips an in-head ^CC-before-^JM block byte-for-byte across re-import', () => {
    // Block 0 remaps the caret before its ^JMB, so block 1 opens as /XA. Block 0
    // must replay verbatim (keeping the ^CC) or block 1 becomes unreadable.
    const src = '^XA^CC//JMB/XZ\n/XA/FO10,10/A0N,30,30/FDa/FS/XZ';
    const r = importZplText(src, 8);
    const out = generateMultiPageZPL({ ...base, ...r.labelConfig }, r.pages, r.variables);
    expect(out).toBe(src);
    const re = importZplText(out, 8);
    expect(re.pages.length).toBe(2);
    expect(re.pages[1]?.objects.length).toBe(1);
  });
});

// A main-era save carried no ^JM in the model: the density rode only in the
// overlay bytes. Loading such a payload must land on the exact fold a fresh
// import of the same bytes would produce, not a stale full-density A.
describe('^JM legacy reconstruction mirrors the import fold', () => {
  const foldVsLegacyLoad = (src: string) => {
    const imp = importZplText(src, 8);
    const label = { ...base, ...imp.labelConfig };
    const legacyPages = imp.pages.map((p) => {
      const overlay = p.overlay ? { ...p.overlay } : undefined;
      if (overlay) delete overlay.head;
      return { objects: p.objects, overlay };
    });
    const loaded = parseDesignFile(
      serializeDesign({ ...label, jmDensity: undefined }, legacyPages, imp.variables),
    );
    expect(loaded.ok).toBe(true);
    return { imp, loaded };
  };

  const cases = [
    {
      name: 'single-page ^JMB lifts to the label, no page override',
      src: '^XA^JMB^FO10,10^A0N,30,30^FDa^FS^XZ',
    },
    {
      name: 'anchor B, later A pins A as an override',
      src: '^XA^JMB^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^JMA^FO50,50^A0N,30,30^FDb^FS^XZ',
    },
    {
      name: 'anchor A, later B pins B as an override',
      src: '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^JMB^FO50,50^A0N,30,30^FDb^FS^XZ',
    },
    {
      name: 'settings-only block before an anchor B pins that block to A',
      src: '^XA^MNY^XZ\n^XA^JMB^FO10,10^A0N,30,30^FDy^FS^XZ',
    },
    {
      name: 'both blocks at full density stay unset',
      src: '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^FO50,50^A0N,30,30^FDb^FS^XZ',
    },
    {
      // A settings-only block declares ^JMB; the object anchor carries no ^JM of
      // its own but inherits B on the wire, so the fold must lift B to the label
      // instead of reading the anchor block alone as A.
      name: 'a settings block ^JMB is inherited by the following object anchor',
      src: '^XA^JMB^XZ^XA^FO0,0^A0N,30,30^FDX^FS^XZ',
    },
    {
      // Block 0 remaps the caret to '!' (persists past ^XZ); block 1 opens as
      // !XA and declares !JMB. The fold must track the remap through the whole
      // stream to see both the opener and the density.
      name: 'a ^CC-remapped opener block still resolves its inherited-prefix ^JMB',
      src: '^XA^CC!^XZ!XA!JMB!FO0,0!A0N,30,30!FDX!FS!XZ',
    },
  ];

  for (const { name, src } of cases) {
    it(name, () => {
      const { imp, loaded } = foldVsLegacyLoad(src);
      if (!loaded.ok) return;
      expect(loaded.value.label.jmDensity).toBe(imp.labelConfig.jmDensity);
      expect(loaded.value.pages.map((p) => p.jmDensity)).toEqual(imp.pages.map((p) => p.jmDensity));
    });
  }

  // Reconstructing the head must make a zero-edit export replay the whole
  // ^CC/!JMB chain byte-for-byte (matching a fresh import) and stay stable
  // across a reload, or a re-export regenerates and drops the remap.
  it('replays a threaded ^CC-remapped chain byte-identically and idempotently', () => {
    const src = '^XA^CC!^XZ!XA!JMB!FO0,0!A0N,30,30!FDX!FS!XZ';
    const { imp, loaded } = foldVsLegacyLoad(src);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const freshOut = generateMultiPageZPL({ ...base, ...imp.labelConfig }, imp.pages, imp.variables);
    const legacyOut = generateMultiPageZPL(loaded.value.label, loaded.value.pages, loaded.value.variables);
    expect(legacyOut).toBe(freshOut);
    const reloaded = parseDesignFile(
      serializeDesign(loaded.value.label, loaded.value.pages, loaded.value.variables),
    );
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(generateMultiPageZPL(reloaded.value.label, reloaded.value.pages, reloaded.value.variables)).toBe(legacyOut);
  });
});

describe('rebaseAppendedPageDensity', () => {
  it('pins an appended B stream against a full-density design', () => {
    const r = importZplText('^XA^JMB^FO10,10^A0N,30,30^FDy^FS^XZ', 8);
    expect(r.pages[0]?.jmDensity).toBeUndefined();
    const rebased = rebaseAppendedPageDensity(r.pages, r.labelConfig.jmDensity, undefined);
    expect(rebased[0]?.jmDensity).toBe('B');
  });

  it('clears an override that already matches the target design', () => {
    const r = importZplText('^XA^JMB^FO10,10^A0N,30,30^FDy^FS^XZ', 8);
    const rebased = rebaseAppendedPageDensity(r.pages, r.labelConfig.jmDensity, 'B');
    expect(rebased[0]?.jmDensity).toBeUndefined();
  });
});

// A main-era save never modelled ^JM; a remapped-opener block kept the density
// only in its bytes. `headless()` skips head reconstruction to exercise the
// generator's cold path, which must still replay the bytes verbatim.
describe('^JM headless remapped-opener replay', () => {
  const declaredJm = (block: string) => [...block.matchAll(/.JM(.)/g)].map((m) => m[1]);

  // Fresh import, then drop overlay.head to mimic the headless legacy shape.
  const headless = (src: string) => {
    const r = importZplText(src, 8);
    const pages = r.pages.map((p) => {
      const overlay = p.overlay ? { ...p.overlay } : undefined;
      if (overlay) delete overlay.head;
      return { ...p, overlay };
    });
    return { label: { ...base, ...r.labelConfig }, pages, variables: r.variables };
  };

  it('replays a self-declaring ^JMB byte-identically on a zero-edit export', () => {
    const src = '^CC/\n/XA/JMB/FO10,10/A0N,30,30/FDa/FS/XZ';
    const r = importZplText(src, 8);
    const legacyPages = r.pages.map((p) => {
      const overlay = p.overlay ? { ...p.overlay } : undefined;
      if (overlay) delete overlay.head;
      return { objects: p.objects, overlay, jmDensity: p.jmDensity };
    });
    // Legacy design never carried the density; the threaded reconstruction
    // latches it from the bytes onto the design default (single block = the
    // fold's anchor) and recovers the head behind the remapped opener.
    const loaded = parseDesignFile(
      serializeDesign({ ...base, ...r.labelConfig, jmDensity: undefined }, legacyPages, r.variables),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.label.jmDensity).toBe('B');
    expect(loaded.value.pages[0]?.jmDensity).toBeUndefined();
    expect(loaded.value.pages[0]?.overlay?.head?.caret).toBe('/');
    const out = generateMultiPageZPL(loaded.value.label, loaded.value.pages, loaded.value.variables);
    expect(out).toBe(src);
    expect(importZplText(out, 8).labelConfig.jmDensity).toBe('B');
  });

  it('regenerates when the model contradicts the self-declared density', () => {
    const { label, pages, variables } = headless('^CC/\n/XA/JMB/FO10,10/A0N,30,30/FDa/FS/XZ');
    const pagesA = pages.map((p, i) => (i === 0 ? { ...p, jmDensity: 'A' as const } : p));
    const out = generateMultiPageZPL(label, pagesA, variables);
    expect(out).not.toContain('JMB');
    expect(out).toContain('^JMA');
    expect(importZplText(out, 8).labelConfig.jmDensity).toBe('A');
  });

  it('replays the whole remap chain so an inheriting /XA block stays readable', () => {
    const src =
      '^CC/\n/XA/JMB/FO10,10/A0N,30,30/FDa/FS/XZ\n/XA/FO50,50/A0N,30,30/FDb/FS/XZ';
    const { label, pages, variables } = headless(src);
    const out = generateMultiPageZPL(label, pages, variables);
    expect(out).toBe(src);
    const re = importZplText(out, 8);
    expect(re.pages.length).toBe(2);
    expect(re.pages.map((p) => p.objects.length)).toEqual([1, 1]);
  });

  it('marks the wire from the kept block so a following A page declares its reset', () => {
    const src = '^CC/\n/XA/JMB/FO10,10/A0N,30,30/FDa/FS/XZ';
    const { label, pages, variables } = headless(src);
    const withA = [...pages, { objects: [], jmDensity: 'A' as const }];
    const out = generateMultiPageZPL(label, withA, variables);
    // Block 0 stays verbatim, not regenerated, and its B marks the wire so
    // the appended A page emits an explicit reset.
    expect(out.startsWith(`${src}\n`)).toBe(true);
    expect(declaredJm(out)).toEqual(['B', 'A']);
  });
});
