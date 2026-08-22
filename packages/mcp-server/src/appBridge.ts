import { randomInt } from "node:crypto";
import { z } from "zod";
import type { MeasuredFootprint } from "@zplab/core/lib/objectBounds";

// Request/response bridge to the hosting desktop app, reusing the two existing
// channels: requests leave as zplabEvent lines on stdout (the pipe the app
// reads, like openDraft), responses arrive on the HTTP design-response route.

// z.object strips unknown keys, so both halves are needed: satisfies checks the
// value types, the Record line below checks key coverage (which the covariant
// satisfies misses for optional fields).
const measuredFootprintSchema = z.object({
  width: z.number(),
  height: z.number(),
  barHeightDots: z.number().optional(),
  barLeftDots: z.number().optional(),
  barTopDots: z.number().optional(),
  uprightBarWDots: z.number().optional(),
  uprightBarHDots: z.number().optional(),
}) satisfies z.ZodType<MeasuredFootprint>;
void (measuredFootprintSchema.shape satisfies Record<keyof MeasuredFootprint, unknown>);

export const designResponseSchema = z.object({
  id: z.number().int(),
  designFile: z.record(z.string(), z.unknown()),
  /** Render-measured footprints (dots) keyed by object id; see ObjectBoundsCtx. */
  measured: z.record(z.string(), measuredFootprintSchema).optional(),
});
export type DesignResponse = z.infer<typeof designResponseSchema>;

/** The app confirms it applied a pushed draft; `ok:false` carries its reason. */
export const draftReceiptSchema = z.object({
  id: z.number().int(),
  ok: z.boolean(),
  error: z.string().optional(),
  /** Objects the push displaced, so the caller can say what it overwrote. */
  replacedObjects: z.number().int().optional(),
});
export type DraftReceipt = z.infer<typeof draftReceiptSchema>;

/** The app's raster of an image the agent supplied, ready to place. */
export const rasterResponseSchema = z.object({
  id: z.number().int(),
  ok: z.boolean(),
  error: z.string().optional(),
  gfa: z.string().optional(),
  widthDots: z.number().optional(),
  heightDots: z.number().optional(),
});
export type RasterResponse = z.infer<typeof rasterResponseSchema>;

/** The app answers via its Tauri event loop plus one local fetch; anything
 *  slower means no app, no listener yet (boot), or no desktop at all. Only for
 *  receipts; a design read-back does real work first (see below). */
export const APP_RESPONSE_TIMEOUT_MS = 4000;

/** Reading the design back waits for the canvas to settle, serializes a
 *  possibly multi-MB envelope and round-trips it over IPC on the same busy
 *  webview thread the 20s sibling budgets were sized for. */
export const DESIGN_RESPONSE_TIMEOUT_MS = 20_000;

/** A raster decodes and dithers megapixels in the webview, so it outlives the
 *  plain reply budget. Kept above the app's own decode timeout (loadImage), so
 *  a stuck image answers with its reason instead of a bare "no answer". */
export const RASTER_TIMEOUT_MS = 20_000;

/** Applying a draft replaces the document BEFORE the receipt is posted, so a
 *  timeout here can report failure on a push that already landed (a retry
 *  would apply it twice). Sized like the sibling 20s budgets above. */
export const OPEN_DRAFT_TIMEOUT_MS = 20_000;

/** The event a pending entry is waiting on. Kept per request because the
 *  reply schemas are mutually satisfiable: a draft receipt and a raster
 *  response both parse as `{id, ok}`, so an id alone cannot tell them apart. */
type RequestKind = "designRequest" | "openDraft" | "rasterRequest";

interface Pending {
  kind: RequestKind;
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, Pending>();
// Random base per process: the webview outlives a sidecar restart, and a
// reply in flight across it must not resolve a recycled id. Floor 1001 keeps
// the invariant testable.
let nextId = randomInt(1001, 2 ** 31);

/** Whether a ZPLab window announced itself on this server. The tools that talk
 *  to the app are registered per request, so a standalone server never offers
 *  them and a client cannot call into the void. */
let attached = false;

/** Only the session that announced itself may withdraw: a detach posted by a
 *  window that has already been replaced would otherwise unhook the live one. */
export function markAppDetached(session: string): boolean {
  if (attachedSession !== null && session !== attachedSession) return false;
  attached = false;
  attachedSession = null;
  // Nobody will answer the in-flight asks; settling them now beats letting
  // each block its full timeout (and inviting the open_in_app retry).
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve(null);
    pending.delete(id);
  }
  return true;
}

let attachedSession: string | null = null;

export function markAppAttached(session: string): void {
  // Required: a null session would disarm markAppDetached's ownership guard,
  // a shape no production caller can produce.
  attachedSession = session;
  attached = true;
}

/** Test seam: the attach latch is process-global by design (one window per
 *  server), so a test that needs the unattached shape has to say so. */
export function resetAppAttachedForTest(): void {
  attached = false;
  attachedSession = null;
}

export function isAppAttached(): boolean {
  return attached;
}

/** Emit an event line the app answers by id; null on timeout. */
function ask<T>(
  event: RequestKind,
  extra: Record<string, unknown> = {},
  timeoutMs: number = APP_RESPONSE_TIMEOUT_MS,
): Promise<T | null> {
  const id = nextId++;
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeoutMs);
    pending.set(id, { kind: event, resolve: resolve as (value: unknown) => void, timer });
    process.stdout.write(JSON.stringify({ zplabEvent: event, id, ...extra }) + "\n");
  });
}

/** Deliver an app reply to the waiting request. False for an unknown id, a
 *  timed-out one, or a reply posted on the route of a different request kind. */
function deliver(kind: RequestKind, id: number, value: unknown): boolean {
  const entry = pending.get(id);
  if (!entry || entry.kind !== kind) return false;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.resolve(value);
  return true;
}

export function requestCurrentDesign(): Promise<DesignResponse | null> {
  return ask<DesignResponse>("designRequest", {}, DESIGN_RESPONSE_TIMEOUT_MS);
}

export function requestOpenDraft(designFile: unknown): Promise<DraftReceipt | null> {
  return ask<DraftReceipt>("openDraft", { designFile }, OPEN_DRAFT_TIMEOUT_MS);
}

export function resolveDesignResponse(payload: unknown): boolean {
  const parsed = designResponseSchema.safeParse(payload);
  return parsed.success && deliver("designRequest", parsed.data.id, parsed.data);
}

/** Ask the app to rasterize an image: the encoder needs a canvas, which only
 *  the window has (the sidecar is headless). */
export function requestRaster(
  dataUrl: string,
  widthDots: number,
  threshold: number,
): Promise<RasterResponse | null> {
  return ask<RasterResponse>("rasterRequest", { dataUrl, widthDots, threshold }, RASTER_TIMEOUT_MS);
}

export function resolveRasterResponse(payload: unknown): boolean {
  const parsed = rasterResponseSchema.safeParse(payload);
  return parsed.success && deliver("rasterRequest", parsed.data.id, parsed.data);
}

export function resolveDraftReceipt(payload: unknown): boolean {
  const parsed = draftReceiptSchema.safeParse(payload);
  return parsed.success && deliver("openDraft", parsed.data.id, parsed.data);
}
