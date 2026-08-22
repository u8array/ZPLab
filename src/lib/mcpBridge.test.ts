// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { respondToDesignRequest, respondToOpenDraft, respondToRasterRequest } from "./mcpBridge";
import { postDesignResponse, postDraftReceipt, postRasterResponse } from "./mcpServer";
import { useLabelStore } from "../store/labelStore";
import { setMeasuredBounds, clearMeasuredBounds } from "./measuredBoundsCache";

// jsdom never settles an Image for a synthetic data URL, so the decode is
// stubbed: these tests are about the size guard and the reply shape.
vi.mock("@zplab/core/lib/loadImage", () => ({
  loadImage: vi.fn(async (src: string) => {
    if (src.includes("!!!")) throw new Error("Failed to load image for GFA conversion");
    return { naturalWidth: 100, naturalHeight: 1000 } as unknown as HTMLImageElement;
  }),
}));

vi.mock("./mcpServer", () => ({
  postDesignResponse: vi.fn(async () => undefined),
  postDraftReceipt: vi.fn(async () => undefined),
  postRasterResponse: vi.fn(async () => undefined),
  attachAppToSidecar: vi.fn(async () => undefined),
  mcpServerStatus: vi.fn(async () => ({ running: false, available: false })),
}));

afterEach(() => {
  // The store is module state; without this the object count leaks into the
  // next test and its assertion passes for the wrong reason.
  useLabelStore.setState({ pages: [{ objects: [] }] });
  vi.clearAllMocks();
  vi.restoreAllMocks();
  clearMeasuredBounds("bc1");
});

describe("respondToDesignRequest", () => {
  it("POSTs the current design plus measured footprints to the sidecar", async () => {
    useLabelStore.setState({
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [
        {
          objects: [
            {
              id: "bc1",
              type: "code128",
              x: 10,
              y: 10,
              rotation: 0,
              props: { content: "12345", height: 80 },
            } as never,
          ],
        },
      ],
    });
    setMeasuredBounds("bc1", { width: 321, height: 88 });

    await respondToDesignRequest(7);

    expect(postDesignResponse).toHaveBeenCalledTimes(1);
    const body = vi.mocked(postDesignResponse).mock.calls[0]?.[0] as unknown as {
      id: number;
      designFile: { label: { widthMm: number } };
      measured: Record<string, { width: number; height: number }>;
    };
    expect(body.id).toBe(7);
    expect(body.designFile.label.widthMm).toBe(100);
    expect(body.measured.bc1).toEqual({ width: 321, height: 88 });
  });
});

describe("respondToOpenDraft", () => {
  it("confirms a draft the editor could open", async () => {
    await respondToOpenDraft(3, JSON.stringify({
      schemaVersion: 5,
      label: { widthMm: 50, heightMm: 30, dpmm: 8 },
      pages: [{ objects: [] }],
    }));

    // replacedObjects counts what the store held before the push; afterEach left it empty.
    expect(vi.mocked(postDraftReceipt).mock.calls[0]?.[0]).toEqual({
      id: 3,
      ok: true,
      replacedObjects: 0,
    });
  });

  it("reports a draft the editor rejected instead of staying silent", async () => {
    await respondToOpenDraft(4, "{\"not\":\"a design\"}");

    const body = vi.mocked(postDraftReceipt).mock.calls[0]?.[0];
    expect(body?.id).toBe(4);
    expect(body?.ok).toBe(false);
    expect(body?.error).toBeTruthy();
  });
});

describe("respondToRasterRequest", () => {
  it("answers a request it cannot decode with the reason, not silence", async () => {
    await respondToRasterRequest(
      JSON.stringify({ id: 7, dataUrl: "data:image/png;base64,!!!", widthDots: 64, threshold: 128 }),
    );
    const reply = vi.mocked(postRasterResponse).mock.calls[0]?.[0];
    expect(reply?.id).toBe(7);
    expect(reply?.ok).toBe(false);
    expect(reply?.error).toBeTruthy();
  });

  it("refuses a raster whose derived height blows the budget", async () => {
    const tall = "data:image/png;base64,iVBORw0KGgo=";
    await respondToRasterRequest(
      JSON.stringify({ id: 8, dataUrl: tall, widthDots: 4000, threshold: 128 }),
    );
    const reply = vi.mocked(postRasterResponse).mock.calls[0]?.[0];
    expect(reply?.ok).toBe(false);
  });
});
