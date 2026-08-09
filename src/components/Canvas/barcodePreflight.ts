import type { LeafObject } from "@zplab/core/registry";
import {
  barcodeEncodeFindingsCore,
  resolveForEncode,
  type EncodeEnv,
  type EncodeVerdict,
} from "@zplab/core/lib/barcodeEncodePreflight";
import type { PreflightFinding } from "@zplab/core/lib/preflight";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { renderBarcodeCanvas } from "./bwipHelpers";

export type { EncodeEnv, EncodeVerdict };
export { resolveForEncode };

// Cache encode verdicts per object identity (the store is identity-
// preserving). The RESOLVED content string is the binding-sensitive key: a
// marker-free barcode stays stable across unrelated variable/CSV/clock edits,
// a marker barcode re-encodes exactly when its substituted payload changes.
const encodeCache = new WeakMap<
  LeafObject,
  { scale: number; dpmm: number; content: string } & EncodeVerdict
>();

function cachedEncode(
  leaf: LeafObject,
  resolved: LeafObject,
  scale: number,
  dpmm: number,
): EncodeVerdict {
  const content = getObjectStringContent(resolved) ?? "";
  const hit = encodeCache.get(leaf);
  if (hit && hit.scale === scale && hit.dpmm === dpmm && hit.content === content) {
    return hit;
  }
  const r = renderBarcodeCanvas(resolved, scale, dpmm);
  const verdict = { error: r.error, approximated: r.approximated === true };
  encodeCache.set(leaf, { scale, dpmm, content, ...verdict });
  return verdict;
}

/** The shared decision tree bound to the canvas encoder. Lives at the canvas
 *  layer because the encoder does; `encodeError` stays injectable so the
 *  mapping is testable without it. */
export function barcodeEncodeFindings(
  leaves: readonly LeafObject[],
  scale: number,
  dpmm: number,
  env: EncodeEnv,
  encodeError?: (leaf: LeafObject, resolved: LeafObject) => string | null | EncodeVerdict,
): PreflightFinding[] {
  return barcodeEncodeFindingsCore(leaves, env, (leaf, resolved) => {
    const raw = encodeError ? encodeError(leaf, resolved) : cachedEncode(leaf, resolved, scale, dpmm);
    return raw === null || typeof raw === "string" ? { error: raw, approximated: false } : raw;
  });
}
