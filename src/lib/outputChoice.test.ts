import { describe, it, expect } from "vitest";
import {
  anyProducible,
  defaultOutputChoice,
  effectiveKind,
  effectivePrintWay,
  effectiveScope,
  offeredKinds,
  offeredScopes,
  renderableOutput,
  type OutputFacts,
} from "./outputChoice";
import { offeredWays } from "./printTarget";

const everything: OutputFacts = {
  hasObjects: true,
  documentEmits: true,
  sourceEditing: false,
  canBatchExport: true,
  canBatchPdf: true,
  pdfCurrentPageOnly: false,
  batchRowCount: 3,
};

describe("anyProducible", () => {
  it("opens the dialog for a config-only document", () => {
    // An imported overlay with no objects is a legitimate setup job, but there is nothing to draw.
    expect(anyProducible({ ...everything, hasObjects: false })).toBe(true);
  });

  it("stays shut while the source is being edited", () => {
    // The editor is about to replace the document, so nothing of it may go out meanwhile.
    expect(anyProducible({ ...everything, sourceEditing: true })).toBe(false);
  });

  it("stays shut for a document that emits nothing", () => {
    expect(anyProducible({ ...everything, hasObjects: false, documentEmits: false })).toBe(false);
  });
});

describe("offeredKinds", () => {
  it("puts a setup script on the printer and nowhere else", () => {
    expect(offeredKinds("setupScript", everything)).toEqual(["print"]);
    expect(offeredKinds("label", everything)).toEqual(["print", "file"]);
  });

  it("drops the file where rendering has nothing to draw", () => {
    expect(offeredKinds("label", { ...everything, hasObjects: false })).toEqual(["print"]);
  });

  it("offers nothing of a document being replaced", () => {
    expect(offeredKinds("label", { ...everything, sourceEditing: true })).toEqual([]);
  });

  it("asks nothing of the document for a setup script", () => {
    const empty = { ...everything, hasObjects: false, documentEmits: false };

    expect(offeredKinds("setupScript", empty)).toEqual(["print"]);
  });
});

describe("renderableOutput", () => {
  it("needs objects of the label itself", () => {
    expect(renderableOutput("label", everything)).toBe(true);
    expect(renderableOutput("label", { ...everything, hasObjects: false })).toBe(false);
    expect(renderableOutput("label", { ...everything, sourceEditing: true })).toBe(false);
    expect(renderableOutput("setupScript", everything)).toBe(false);
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
    expect(effectiveKind("file", offeredKinds("label", everything))).toBe("file");
    expect(effectiveScope("batch", offeredScopes(everything))).toBe("batch");
  });

  it("falls back to what is left, without rewriting the memory", () => {
    expect(effectiveKind("file", offeredKinds("setupScript", everything))).toBe("print");
    expect(effectiveScope("batch", offeredScopes({ ...everything, canBatchPdf: false }))).toBe("design");
  });
});

describe("effectivePrintWay", () => {
  const webWays = offeredWays(false, { local: false, usb: false }, true);

  it("shows the stored Zebra way while nothing else is remembered", () => {
    expect(effectivePrintWay(null, "browserprint", webWays)).toEqual({ way: "browserprint", tab: "browserprint" });
    expect(effectivePrintWay(null, "network", webWays)).toEqual({ way: "network", tab: "network" });
  });

  it("holds the system dialog once it was chosen, over the Zebra way behind it", () => {
    expect(effectivePrintWay("system", "browserprint", webWays)).toEqual({ way: "system", tab: "browserprint" });
  });

  it("falls back to a Zebra way where nothing renders", () => {
    const script = offeredWays(false, { local: false, usb: false }, false);

    expect(effectivePrintWay("system", "browserprint", script)).toEqual({ way: "browserprint", tab: "browserprint" });
  });
});

describe("defaultOutputChoice", () => {
  it("starts on the way the build reaches a printer by", () => {
    // A browser tab has no channel to the device, so the rendered label goes through the system dialog.
    expect(defaultOutputChoice(true)).toEqual({ kind: "print", printWay: null, fileFormat: "pdf", pdfScope: "design" });
    expect(defaultOutputChoice(false)).toEqual({ kind: "print", printWay: "system", fileFormat: "pdf", pdfScope: "design" });
  });
});
