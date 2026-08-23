// Label-geometry sidecar carried in a leading ^FX comment. Plain ZPL can't
// express dpmm and rounds mm through ^PW/^LL dots, so a re-imported label loses
// the exact width/height/dpmm. We stash them in a namespaced comment the
// printer and Labelary ignore, and recover them on import.

import { isDpmm } from "../types/LabelConfig";

/** Namespace so a foreign ^FX comment can't be mistaken for our metadata. */
export const LABEL_META_PREFIX = "ZPLLAB:";

const MM_MIN = 1;
const MM_MAX = 5000;

/** The ONE plausibility bound for a label dimension, shared by the sidecar
 *  meta and the ^PW/^LL fold: firmware clamps to a physical head, our model
 *  has none. */
export const isPlausibleLabelMm = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= MM_MIN && v <= MM_MAX;

export interface LabelMeta {
  dpmm: number;
  widthMm: number;
  heightMm: number;
}

/** Shared ZPLLAB envelope (label meta, QR props). Body must be free of ^/~
 *  or the ^FX comment terminates mid-payload. */
export function formatSidecarComment(body: string): string {
  return `^FX${LABEL_META_PREFIX}${body}^FS`;
}

/** Sidecar payload, or null for a foreign comment. */
export function sidecarBody(commentBody: string): string | null {
  const trimmed = commentBody.trim();
  return trimmed.startsWith(LABEL_META_PREFIX) ? trimmed.slice(LABEL_META_PREFIX.length) : null;
}

/** The leading sidecar line. Numbers only, no `^`/`~`, so it is a valid ^FX
 *  comment terminated by ^FS (verified against the ZPL spec and Labelary). */
export function formatLabelMetaComment(meta: LabelMeta): string {
  return formatSidecarComment(
    JSON.stringify({ dpmm: meta.dpmm, wMm: meta.widthMm, hMm: meta.heightMm }),
  );
}

/** Parse a ^FX comment body (text after `^FX`) into validated label meta, or
 *  null if it is not our sentinel or any field is out of range. Defensive
 *  against foreign comments and corrupt payloads. */
export function parseLabelMetaComment(commentBody: string): LabelMeta | null {
  const body = sidecarBody(commentBody);
  if (body === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { dpmm, wMm, hMm } = parsed as Record<string, unknown>;
  // Emit assumes dpmm ∈ DPMM_VALUES (the only densities the UI produces); keep
  // emit and this guard on the same source of truth.
  if (typeof dpmm !== "number" || !isDpmm(dpmm)) return null;
  if (!isPlausibleLabelMm(wMm) || !isPlausibleLabelMm(hMm)) return null;
  return { dpmm, widthMm: wMm, heightMm: hMm };
}
