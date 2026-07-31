import { objectResolvesCtrl, type LeafObject } from "@zplab/core/registry";
import { maxicodeScmOwnedByPreflight, type MaxicodeProps } from "@zplab/core/registry/maxicode";
import { isBarcode } from "@zplab/core/lib/objectBounds";
import { PREFLIGHT_SEVERITY, type PreflightFinding } from "@zplab/core/lib/preflight";
import type { Variable } from "@zplab/core/types/Variable";
import {
  applyBindingToObject,
  getObjectStringContent,
  type ActiveRow,
  type ClockResolveCtx,
} from "@zplab/core/lib/variableBinding";
import { renderBarcodeCanvas } from "./bwipHelpers";

/** Binding context so the check encodes what PRINTS: `«marker»` content is
 *  resolved exactly like the canvas preview. Encoding the raw marker text
 *  would flag valid payloads (e.g. a GS1 fixed AI filled by a variable) as
 *  too long. */
export interface EncodeEnv {
  variables: readonly Variable[];
  active: ActiveRow | null;
  clock?: ClockResolveCtx;
}

// Cache encode verdicts per object identity (the store is identity-
// preserving). The RESOLVED content string is the binding-sensitive key: a
// marker-free barcode stays stable across unrelated variable/CSV/clock edits,
// a marker barcode re-encodes exactly when its substituted payload changes.
const encodeCache = new WeakMap<
  LeafObject,
  { scale: number; dpmm: number; content: string; error: string | null }
>();

function cachedEncodeError(
  leaf: LeafObject,
  resolved: LeafObject,
  scale: number,
  dpmm: number,
): string | null {
  const content = getObjectStringContent(resolved) ?? "";
  const hit = encodeCache.get(leaf);
  if (hit && hit.scale === scale && hit.dpmm === dpmm && hit.content === content) {
    return hit.error;
  }
  const error = renderBarcodeCanvas(resolved, scale, dpmm).error;
  encodeCache.set(leaf, { scale, dpmm, content, error });
  return error;
}

/** Preview-resolved leaf for the encoder (identity-preserving when unbound). */
export function resolveForEncode(leaf: LeafObject, env: EncodeEnv): LeafObject {
  return applyBindingToObject(leaf, env.variables, env.active, "preview", env.clock, objectResolvesCtrl(leaf));
}

/** Encode check over ALL exportable leaves, not just rendered ones, so a
 *  hidden-but-exported barcode with an uncodable payload (QR overflow, invalid
 *  EAN, ...) still badges. Lives at the canvas layer because the encoder does.
 *  `encodeError` is injectable so the mapping is testable without the encoder. */
export function barcodeEncodeFindings(
  leaves: readonly LeafObject[],
  scale: number,
  dpmm: number,
  env: EncodeEnv,
  encodeError: (leaf: LeafObject, resolved: LeafObject) => string | null = (leaf, resolved) =>
    cachedEncodeError(leaf, resolved, scale, dpmm),
): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const leaf of leaves) {
    // Barcode-only producer: text and shapes never encode, and a bound TEXT
    // field resolving empty stays quiet (configured field, and the canvas
    // shows an honest empty box there, unlike the barcode's sample bars).
    if (!isBarcode(leaf)) continue;
    const resolved = resolveForEncode(leaf, env);
    if ((getObjectStringContent(resolved) ?? "").trim() === "") {
      // A blank payload has nothing to encode, so never a renderFailed error.
      // A literal-blank field is already owned by computePreflight's
      // emptyContent (raw content ""); a BARCODE whose marker resolves empty
      // (empty variable default / empty CSV cell) is raw-nonempty there, yet
      // renders as sample bars, so surface its emptiness here.
      if ((getObjectStringContent(leaf) ?? "").trim() !== "") {
        findings.push({ objectId: leaf.id, kind: "emptyContent", severity: PREFLIGHT_SEVERITY.emptyContent });
      }
      continue;
    }
    // A literal mode 2/3 MaxiCode without a carrier message is owned by
    // maxicodeModeMissingScm (computePreflight); skip renderFailed to avoid a
    // double report. Marker content isn't skipped: the producer guards it out.
    if (
      resolved.type === "maxicode" &&
      maxicodeScmOwnedByPreflight(getObjectStringContent(leaf) ?? "", resolved.props as MaxicodeProps)
    ) {
      continue;
    }
    const error = encodeError(leaf, resolved);
    if (error) {
      findings.push({ objectId: leaf.id, kind: "renderFailed", severity: PREFLIGHT_SEVERITY.renderFailed, detail: error });
    }
  }
  return findings;
}
