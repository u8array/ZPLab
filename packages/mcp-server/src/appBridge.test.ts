import { describe, it, expect, vi, afterEach } from "vitest";
import { DECODE_TIMEOUT_MS } from "@zplab/core/lib/loadImage";
import {
  APP_RESPONSE_TIMEOUT_MS,
  DESIGN_RESPONSE_TIMEOUT_MS,
  OPEN_DRAFT_TIMEOUT_MS,
  RASTER_TIMEOUT_MS,
  requestCurrentDesign,
  requestOpenDraft,
  requestRaster,
  resolveDesignResponse,
  resolveDraftReceipt,
  resolveRasterResponse,
} from "./appBridge";
import { designFile } from "./testFixtures";

function spyStdout(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
  return { writes, restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("appBridge", () => {
  it("writes a designRequest line and resolves with the app's reply", async () => {
    const { writes, restore } = spyStdout();
    try {
      const pending = requestCurrentDesign();
      expect(writes).toHaveLength(1);
      const event = JSON.parse(writes[0] ?? "{}") as { zplabEvent: string; id: number };
      expect(event.zplabEvent).toBe("designRequest");

      const delivered = resolveDesignResponse({ id: event.id, designFile });
      expect(delivered).toBe(true);
      const response = await pending;
      expect(response?.designFile).toEqual(designFile);
    } finally {
      restore();
    }
  });

  it("rejects an unknown id and a malformed payload", () => {
    expect(resolveDesignResponse({ id: 999999, designFile })).toBe(false);
    expect(resolveDesignResponse({ designFile })).toBe(false);
    expect(resolveDesignResponse("garbage")).toBe(false);
  });

  it("resolves null on timeout and ignores the late reply", async () => {
    vi.useFakeTimers();
    const { writes, restore } = spyStdout();
    try {
      const pending = requestCurrentDesign();
      const event = JSON.parse(writes[0] ?? "{}") as { id: number };
      vi.advanceTimersByTime(DESIGN_RESPONSE_TIMEOUT_MS + 1);
      expect(await pending).toBeNull();
      expect(resolveDesignResponse({ id: event.id, designFile })).toBe(false);
    } finally {
      restore();
    }
  });

  it("gives a raster longer than the app needs to give up on the decode", async () => {
    expect(RASTER_TIMEOUT_MS).toBeGreaterThan(DECODE_TIMEOUT_MS);
    vi.useFakeTimers();
    const { restore } = spyStdout();
    try {
      const pending = requestRaster("data:image/png;base64,AA", 200, 128);
      vi.advanceTimersByTime(APP_RESPONSE_TIMEOUT_MS + 1);
      // Still waiting: the plain budget must not cut a raster short.
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      vi.advanceTimersByTime(RASTER_TIMEOUT_MS);
      expect(await pending).toBeNull();
    } finally {
      restore();
    }
  });
  it("gives a draft the raster budget: the apply lands before the receipt", async () => {
    // The plain 4s budget reported failure on a push the app had already
    // applied (document replaced, undo cleared), inviting a double-apply retry.
    vi.useFakeTimers();
    const { writes, restore } = spyStdout();
    try {
      const pending = requestOpenDraft(designFile);
      const { id } = JSON.parse(writes[0] ?? "{}") as { id: number };
      vi.advanceTimersByTime(APP_RESPONSE_TIMEOUT_MS + 1);
      expect(resolveDraftReceipt({ id, ok: true })).toBe(true);
      expect((await pending)?.ok).toBe(true);
      expect(OPEN_DRAFT_TIMEOUT_MS).toBeGreaterThan(APP_RESPONSE_TIMEOUT_MS);
    } finally {
      restore();
    }
  });
});

describe("a reply on the wrong route", () => {
  it("does not settle a request of a different kind", async () => {
    const { writes, restore } = spyStdout();
    try {
      const pending = requestRaster("data:image/png;base64,AA", 200, 128);
      const { id } = JSON.parse(writes[0] ?? "{}") as { id: number };
      // Both schemas are satisfied by {id, ok}, so only the route tells them apart.
      expect(resolveDraftReceipt({ id, ok: true })).toBe(false);
      expect(resolveRasterResponse({ id, ok: true, gfa: "^GFA,1,1,1,00" })).toBe(true);
      expect((await pending)?.gfa).toBe("^GFA,1,1,1,00");
    } finally {
      restore();
    }
  });
});

describe("request ids across sidecar generations", () => {
  it("does not start at one, so a reply in flight cannot hit a fresh request", async () => {
    // The webview outlives a sidecar restart; a reply carrying id 1 must not
    // resolve whatever the new process numbered 1.
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const pending = requestCurrentDesign();
    const line = String(write.mock.calls[0]?.[0] ?? "{}");
    write.mockRestore();
    const { id } = JSON.parse(line) as { id: number };
    expect(id).toBeGreaterThan(1000);
    // Settle the request so its real 20s timer does not outlive the test.
    resolveDesignResponse({ id, designFile: {} });
    await pending;
  });
});
