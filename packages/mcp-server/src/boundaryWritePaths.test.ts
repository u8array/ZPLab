// Input-validation corpus for this tool's own boundary: each case is a
// malformed value it must reject, so caller data is not read as printer
// commands. Each test pins a validation rule already in place.
import { describe, it, expect } from "vitest";
import { createDraft, exportZpl, openInApp, validateDraft } from "./tools";
import { patchDesign } from "./patchOps";

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r as Extract<T, { ok: true }>;
}

// Every check here guards a rule the SIBLING write path already enforced. The
// recurring defect is a predicate wired into one entry point only, so the same
// state is refused through create_draft and waved through in a design file.
describe("the label config reaches the wire like any other free text", () => {
  it("cannot end a parameter slot and start a command", () => {
    const design = {
      schemaVersion: 5,
      label: {
        widthMm: 100, heightMm: 50, dpmm: 8,
        defaultFontId: "0^XZ~JB^XA",
        customFonts: [{ alias: "A", path: "E:X.FNT^FS^XZ~JA^XA" }],
      },
      pages: [{ objects: [{ id: "t", type: "text", x: 10, y: 10, rotation: 0,
        props: { content: "hi" } }] }],
    };
    const zpl = ok(exportZpl(design)).zpl;
    expect(zpl).not.toContain("~JA");
    expect(zpl).not.toContain("~JB");
    // Kept as data, not dropped: the alias, path and default font id still name the font.
    expect(zpl).toContain("^CWA,E:X.FNTFSXZJAXA");
    expect(zpl).toContain("^CF0XZJBXA");
    expect(zpl).toContain("^A0XZJBXAN,30,0");
  });
});

describe("variables a design file carries in", () => {
  const design = (variables: unknown[]) => ({
    schemaVersion: 5,
    label: { widthMm: 100, heightMm: 50, dpmm: 8 },
    variables,
    pages: [{ objects: [{ id: "a", type: "text", x: 10, y: 10, rotation: 0,
      props: { content: "«sku»", fontSize: 20, fontId: "0" } }] }],
  });

  it("refuses a duplicate ^FN slot, the way create_draft already did", () => {
    // Two fields on one slot cannot be set independently; the second is lost.
    const r = validateDraft(design([
      { id: "var-1", name: "sku", fnNumber: 1, defaultValue: "S1" },
      { id: "var-2", name: "lot", fnNumber: 1, defaultValue: "L1" },
    ])) as { ok: boolean; errors?: string[] };
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toContain("^FN slot");
  });

  it("refuses a duplicate variable id", () => {
    const r = exportZpl(design([
      { id: "var-1", name: "sku", fnNumber: 1, defaultValue: "S1" },
      { id: "var-1", name: "lot", fnNumber: 2, defaultValue: "L1" },
    ])) as { ok: boolean; errors?: string[] };
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toContain("variable id");
  });

  it("still takes the shape the importer produces", () => {
    expect(ok(validateDraft(design([
      { id: "var-1", name: "sku", fnNumber: 1, defaultValue: "S1" },
    ]))).ok).toBe(true);
  });
});

describe("fieldJustify C, which only 1D barcodes expose", () => {
  it("is canonicalized away on update, not just on create", () => {
    const draft = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "text", x: 10, y: 10, props: { content: "x" } }],
    })) as { designFile: { pages: { objects: { id: string }[] }[] } };
    const id = draft.designFile.pages[0]!.objects[0]!.id;
    const patched = ok(patchDesign(draft.designFile, [
      { op: "update", id, fieldJustify: "C" },
    ])) as { designFile: { pages: { objects: Record<string, unknown>[] }[] } };
    expect(patched.designFile.pages[0]!.objects[0]!.fieldJustify).toBeUndefined();
  });
});

describe("a hand-built envelope with sparse props", () => {
  it("emits registry defaults, never NaN or undefined", () => {
    // create_draft merges defaults under sparse caller props; a design file
    // used to skip that merge, so a missing prop reached the wire as
    // ^FO10,NaN^A0undefined with ok:true and no warning.
    const design = {
      schemaVersion: 5,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [{ id: "t", type: "text", x: 10, y: 10, rotation: 0,
        props: { content: "hi" } }] }],
    };
    const zpl = ok(exportZpl(design)).zpl;
    expect(zpl).not.toContain("NaN");
    expect(zpl).not.toContain("undefined");
    expect(zpl).toContain("^FDhi^FS");
  });

  it("keeps a legacy image without its rotation prop resolvable", () => {
    const design = {
      schemaVersion: 5,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [{ id: "img", type: "image", x: 0, y: 0, rotation: 0,
        props: { imageId: "gone", widthDots: 8, threshold: 128,
          _gfaCache: "^GFA,4,4,2,FF00FF00" } }] }],
    };
    expect(ok(exportZpl(design)).zpl).toContain("^GFA,4,4,2,FF00FF00");
  });
});

describe("open_in_app forwards the parsed design, not the raw envelope", () => {
  it("fills defaults before the app sees the file", () => {
    // The app fills no defaults on load: forwarding the raw sparse envelope
    // printed ^FO10,NaN from the app while every sidecar tool reported ok.
    const design = {
      schemaVersion: 5,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [{ id: "t", type: "text", x: 10, y: 10, rotation: 0,
        props: { content: "hello" } }] }],
    };
    const out = ok(openInApp(design));
    const forwarded = out.designFile as {
      pages: { objects: { props: Record<string, unknown> }[] }[];
    };
    expect(forwarded.pages[0]!.objects[0]!.props.fontHeight).toBe(30);
    expect(forwarded).not.toBe(design);
  });
});

describe("the envelope write path canonicalizes like its siblings", () => {
  it("drops fieldJustify C from a non-1D leaf in a design file", () => {
    const design = {
      schemaVersion: 5,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [{ id: "t", type: "text", x: 10, y: 10, rotation: 0,
        fieldJustify: "C", props: { content: "x" } }] }],
    };
    const out = ok(openInApp(design));
    const leaf = (out.designFile as { pages: { objects: Record<string, unknown>[] }[] })
      .pages[0]!.objects[0]!;
    expect(leaf.fieldJustify).toBeUndefined();
  });

  it("refuses a group chain past the nesting cap with a real error", () => {
    // Deep nesting used to answer with a bare "Maximum call stack size exceeded".
    let node: Record<string, unknown> = { id: "leaf", type: "text", x: 0, y: 0,
      rotation: 0, props: { content: "x" } };
    for (let i = 0; i < 100; i++) {
      node = { id: `g${i}`, type: "group", x: 0, y: 0, rotation: 0, children: [node] };
    }
    const design = {
      schemaVersion: 5,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [node] }],
    };
    const r = validateDraft(design) as { ok: boolean; errors?: string[] };
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toContain("nesting limit");
  });
});

describe("an update carrying fieldJustify C on a non-1D object", () => {
  it("keeps the existing anchor instead of clearing it", () => {
    // canonicalFieldJustify returns undefined for the meaningless ask; writing
    // that into the merge cleared an 'R' and shifted the field by its width.
    const draft = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "text", x: 400, y: 10, fieldJustify: "R", props: { content: "x" } }],
    }));
    const id = (draft.designFile as { pages: { objects: { id: string }[] }[] })
      .pages[0]!.objects[0]!.id;
    const patched = ok(patchDesign(draft.designFile, [{ op: "update", id, fieldJustify: "C" }]));
    const leaf = (patched.designFile as { pages: { objects: Record<string, unknown>[] }[] })
      .pages[0]!.objects[0]!;
    expect(leaf.fieldJustify).toBe("R");
  });
});

describe("an add op's unknown-prop note", () => {
  it("names the assigned id, not the type", () => {
    // The note exists to enable a corrective follow-up; labelling it with the
    // type sent the agent to update an id that does not exist.
    const draft = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "text", x: 0, y: 0, props: { content: "a" } }],
    }));
    const patched = ok(patchDesign(draft.designFile, [{
      op: "add",
      object: { type: "text", x: 0, y: 30, props: { content: "b", fontSize: 60 } },
    }]));
    const note = patched.notes?.find((n) => n.includes("fontSize"));
    expect(note).toBeDefined();
    expect(note).toMatch(/^text-\d+:/);
  });
});

describe("a variable referenced only by a hidden object", () => {
  it("is not reported as never referenced", () => {
    // The false note invited a removeVariable that rewrites hidden leaves too,
    // freezing their binding to a literal.
    const design = {
      schemaVersion: 5,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      variables: [{ id: "var-1", name: "lot", fnNumber: 1, defaultValue: "L1" }],
      pages: [{ objects: [{ id: "h", type: "text", x: 10, y: 10, rotation: 0,
        includeInExport: false, props: { content: "«lot»" } }] }],
    };
    const r = ok(validateDraft(design));
    expect((r as { notes?: string[] }).notes?.some((n) => n.includes("never referenced")) ?? false)
      .toBe(false);
    // Positive control: a truly unreferenced variable still gets the note.
    const bare = { ...design, pages: [{ objects: [] }] };
    const r2 = ok(validateDraft(bare));
    expect((r2 as { notes?: string[] }).notes?.some((n) => n.includes("never referenced")))
      .toBe(true);
  });
});

describe("a page past the geometry cap", () => {
  it("says the probes were skipped instead of showing a clean report", () => {
    // Off-label checks judge registry-default boxes there; a clean warnings
    // array on such a page is partiality, not health.
    const objects = Array.from({ length: 2001 }, (_, i) => ({
      id: `t${i}`, type: "text", x: 0, y: 0, rotation: 0, props: { content: "x" },
    }));
    const design = {
      schemaVersion: 5,
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects }],
    };
    const r = ok(exportZpl(design)) as { notes?: string[] };
    expect(r.notes?.some((n) => n.includes("were not probed"))).toBe(true);
  });
});

describe("optional core props the tables had drifted from", () => {
  it("are neither typo-flagged nor type-unchecked", () => {
    // Nine emit-read optional props were missing from every table: correct
    // input drew a typo note, and a wrong-typed value reached the ZPL slot.
    const r = ok(createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "maxicode", x: 0, y: 0, props: { content: "x", mode: 4, symbolNumber: 2 } }],
    })) as { notes?: string[] };
    expect(r.notes?.some((n) => n.includes("symbolNumber")) ?? false).toBe(false);
    const bad = createDraft({
      widthMm: 100, heightMm: 50, dpmm: 8,
      objects: [{ type: "maxicode", x: 0, y: 0, props: { content: "x", mode: 4, symbolNumber: "2" } }],
    });
    expect(bad.ok).toBe(false);
  });
});

describe("export_zpl metadata", () => {
  const design = {
    schemaVersion: 5,
    label: { widthMm: 100, heightMm: 50, dpmm: 8 },
    pages: [{ objects: [{ id: "t", type: "text", x: 10, y: 10, rotation: 0, props: { content: "hi" } }] }],
  };

  it("returns plain printer bytes by default", () => {
    const zpl = ok(exportZpl(design)).zpl;
    expect(zpl).not.toContain("ZPLLAB");
    expect(zpl).toContain("^FDhi^FS");
  });

  it("keeps the ZPLLAB metadata when asked for a re-importable export", () => {
    expect(ok(exportZpl(design, { metadata: true })).zpl).toContain("^FXZPLLAB:");
  });
});
