// Label-geometry sidecar carried in a leading ^FX comment. Plain ZPL can't
// express dpmm and rounds mm through ^PW/^LL dots, so a re-imported label loses
// the exact width/height/dpmm. We stash them in a namespaced comment the
// printer and Labelary ignore, and recover them on import.

import { isDpmm } from "../types/LabelConfig";
import type { SourceSpan } from "./zplParser/types";

/** Namespace so a foreign ^FX comment can't be mistaken for our metadata. */
const SIDECAR_PREFIX = "ZPLab:";
/** The 0.4.x envelope, read forever. */
const LEGACY_SIDECAR_PREFIX = "ZPLLAB:";
const SIDECAR_PREFIXES = [SIDECAR_PREFIX, LEGACY_SIDECAR_PREFIX];

const MM_MIN = 1;
const MM_MAX = 5000;

/** The ONE plausibility bound for a label dimension, shared by the sidecar
 *  meta and the ^PW/^LL fold: firmware clamps to a physical head, our model
 *  has none. */
export const isPlausibleLabelMm = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= MM_MIN && v <= MM_MAX;

/** Document identity: survives a buffer edit that deletes ^PW/^LL and outlives a design. */
export const LABEL_META_KEYS = ["dpmm", "widthMm", "heightMm"] as const;

export type LabelMeta = Record<(typeof LABEL_META_KEYS)[number], number>;

export function labelMetaOf(label: LabelMeta): LabelMeta {
  return Object.fromEntries(LABEL_META_KEYS.map((k) => [k, label[k]])) as LabelMeta;
}

/** Shared sidecar envelope (label meta, QR props). Body must be free of ^/~
 *  or the ^FX comment terminates mid-payload. */
export function formatSidecarComment(body: string): string {
  return `^FX${SIDECAR_PREFIX}${body}^FS`;
}

/** Every envelope we ever wrote; a foreign comment without the colon survives. */
const SIDECAR_LINE_RE = new RegExp(`\\^[Ff][Xx](?:${SIDECAR_PREFIXES.join("|")})[^^~]*\\^[Ff][Ss](?:\\r?\\n)?`, "g");

/** The byte ranges the export strips: each sidecar plus any line break right after it. */
export function sidecarRanges(zpl: string): SourceSpan[] {
  return [...zpl.matchAll(SIDECAR_LINE_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/** Printer bytes only: a re-import then inherits the density and rebuilds
 *  ^GFA QR codes as images. */
export function stripSidecarComments(zpl: string): string {
  return zpl.replace(SIDECAR_LINE_RE, "");
}

/** The ZPL that leaves ZPLab: plain unless the caller wants its metadata back. */
export function zplForExport(zpl: string, keepMetadata = false): string {
  return keepMetadata ? zpl : stripSidecarComments(zpl);
}

/** Sidecar payload, or null for a foreign comment. */
export function sidecarBody(commentBody: string): string | null {
  const trimmed = commentBody.trim();
  const prefix = SIDECAR_PREFIXES.find((p) => trimmed.startsWith(p));
  return prefix === undefined ? null : trimmed.slice(prefix.length);
}

/** The leading sidecar line. Numbers only, no `^`/`~`, so it is a valid ^FX
 *  comment terminated by ^FS (verified against the ZPL spec and Labelary). */
export function formatLabelMetaComment(meta: LabelMeta): string {
  return formatSidecarComment(JSON.stringify({ dpmm: meta.dpmm, w: meta.widthMm, h: meta.heightMm }));
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
  const { dpmm, w, h, wMm, hMm } = parsed as Record<string, unknown>;
  // Emit assumes dpmm ∈ DPMM_VALUES (the only densities the UI produces); keep
  // emit and this guard on the same source of truth.
  if (typeof dpmm !== "number" || !isDpmm(dpmm)) return null;
  const widthMm = w ?? wMm;
  const heightMm = h ?? hMm;
  if (!isPlausibleLabelMm(widthMm) || !isPlausibleLabelMm(heightMm)) return null;
  return { dpmm, widthMm, heightMm };
}
