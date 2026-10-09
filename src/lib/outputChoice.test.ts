import { describe, it, expect } from "vitest";
import { effectiveKind, effectiveScope, offeredKinds, offeredScopes, producibleKinds, type OutputFacts } from "./outputChoice";

const everything: OutputFacts = {
  hasObjects: true,
  documentEmits: true,
  sourceEditing: false,
  canBatchExport: true,
  canBatchPdf: true,
  pdfCurrentPageOnly: false,
  batchRowCount: 3,
};

describe("producibleKinds", () => {
  it("sends a config-only document as code and renders nothing from it", () => {
    // An imported overlay with no objects is a legitimate setup job, but there is nothing to draw.
    const overlayOnly = { ...everything, hasObjects: false };

    expect(producibleKinds(overlayOnly)).toEqual({ zpl: true, image: false, pdf: false });
  });

  it("offers nothing while the source is being edited", () => {
    // The editor is about to replace the document, so nothing of it may go out meanwhile.
    expect(producibleKinds({ ...everything, sourceEditing: true })).toEqual({ zpl: false, image: false, pdf: false });
  });

  it("offers nothing from a document that emits nothing", () => {
    expect(producibleKinds({ ...everything, hasObjects: false, documentEmits: false })).toEqual({
      zpl: false,
      image: false,
      pdf: false,
    });
  });
});

describe("offeredKinds", () => {
  it("puts a setup script on the printer and nowhere else", () => {
    expect(offeredKinds("setupScript", everything)).toEqual(["zpl"]);
    expect(offeredKinds("label", everything)).toEqual(["zpl", "image", "pdf"]);
  });

  it("drops the rendered kinds where rendering has nothing to draw", () => {
    expect(offeredKinds("label", { ...everything, hasObjects: false })).toEqual(["zpl"]);
  });

  it("asks nothing of the document for a setup script", () => {
    // The script is the printer's own settings, so an empty design still has it to send.
    const empty = { ...everything, hasObjects: false, documentEmits: false };

    expect(offeredKinds("setupScript", empty)).toEqual(["zpl"]);
  });
});

describe("offeredScopes", () => {
  it("needs a dataset and a renderer for the batch", () => {
    expect(offeredScopes(everything)).toEqual(["design", "batch"]);
    expect(offeredScopes({ ...everything, canBatchExport: false })).toEqual(["design"]);
    // Without a renderer the batch export draws nothing and returns without a file.
    expect(offeredScopes({ ...everything, canBatchPdf: false })).toEqual(["design"]);
  });
});

describe("the remembered decision", () => {
  it("holds where it still can", () => {
    expect(effectiveKind("pdf", offeredKinds("label", everything))).toBe("pdf");
    expect(effectiveScope("batch", offeredScopes(everything))).toBe("batch");
  });

  it("falls back to what is left, without rewriting the memory", () => {
    expect(effectiveKind("pdf", offeredKinds("setupScript", everything))).toBe("zpl");
    expect(effectiveScope("batch", offeredScopes({ ...everything, canBatchPdf: false }))).toBe("design");
  });
});
