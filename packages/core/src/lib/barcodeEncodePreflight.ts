// Single decision tree for encode findings, shared by editor and MCP sidecar so the two reports cannot drift.

import { ctrlParityFor, gs1StaticUnparsed, type LeafObject } from "../registry";
import { maxicodeScmOwnedByPreflight, type MaxicodeProps } from "../registry/maxicode";
import { isBarcode } from "./objectBounds";
import { PREFLIGHT_SEVERITY, type PreflightFinding } from "./preflight";
import type { Variable } from "../types/Variable";
import {
  applyBindingToObject,
  getObjectStringContent,
  type ActiveRow,
  type ClockResolveCtx,
} from "./variableBinding";

/** Binding context so the check encodes what PRINTS: `«marker»` content is
 *  resolved exactly like the caller's render. */
export interface EncodeEnv {
  variables: readonly Variable[];
  active: ActiveRow | null;
  clock?: ClockResolveCtx;
}

export interface EncodeVerdict {
  error: string | null;
  approximated: boolean;
}

/** Preview-resolved leaf for the encoder (identity-preserving when unbound). */
export function resolveForEncode(leaf: LeafObject, env: EncodeEnv): LeafObject {
  return applyBindingToObject(
    leaf,
    env.variables,
    env.active,
    // Always the resolved values: a schema render substitutes placeholders,
    // and encoding those would clear a barcode whose real payload cannot code.
    "preview",
    env.clock,
    ctrlParityFor(leaf),
  );
}

/** Encode check over ALL exportable leaves, not just rendered ones, so a
 *  hidden-but-exported barcode with an uncodable payload still reports.
 *  `encode` is the caller's encoder seam (canvas or headless bwip). */
export function barcodeEncodeFindingsCore(
  leaves: readonly LeafObject[],
  env: EncodeEnv,
  encode: (leaf: LeafObject, resolved: LeafObject) => EncodeVerdict,
): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const leaf of leaves) {
    // Barcode-only producer: text and shapes never encode, and a bound TEXT
    // field resolving empty stays quiet (configured field, and the canvas
    // shows an honest empty box there, unlike the barcode's sample bars).
    if (!isBarcode(leaf)) continue;
    const resolved = resolveForEncode(leaf, env);
    if ((getObjectStringContent(resolved) ?? "").trim() === "") {
      // A literal-blank field is already owned by computePreflight's
      // emptyContent (raw content ""); a BARCODE whose marker resolves empty
      // is raw-nonempty there, yet renders as sample bars, so surface it here.
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
    // Static unparsed GS1 is owned by gs1ContentUnparsed (see
    // gs1StaticUnparsed); a second renderFailed would contradict it.
    if (gs1StaticUnparsed(leaf.type, leaf.props, getObjectStringContent(leaf) ?? "")) {
      continue;
    }
    const verdict = encode(leaf, resolved);
    if (verdict.error) {
      findings.push({ objectId: leaf.id, kind: "renderFailed", severity: PREFLIGHT_SEVERITY.renderFailed, detail: verdict.error });
    } else if (verdict.approximated) {
      findings.push({ objectId: leaf.id, kind: "previewApproximate", severity: PREFLIGHT_SEVERITY.previewApproximate });
    }
  }
  return findings;
}
