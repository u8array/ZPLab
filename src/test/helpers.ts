import { expect } from 'vitest';
import type { SerialMode } from '@zplab/core/registry/serialField';
import { parseZPL, type ImportFindingKind } from '@zplab/core/lib/zplParser';

/** Parse a single-label stream: the sole page merged with the document-wide
 *  fields. Asserts exactly one page; multi-page tests read `pages` directly. */
export function parseSingle(zpl: string, dpmm = 8, opts?: { captureOverlay?: boolean }) {
  const r = parseZPL(zpl, dpmm, opts);
  expect(r.pages).toHaveLength(1);
  // Keep the document labelConfig: the page snapshot predates the sidecar.
  return { ...r, ...defined(r.pages[0]), labelConfig: r.labelConfig };
}

/** Findings of one kind, in occurrence order. */
export const findingsOf = <F extends { kind: ImportFindingKind }>(
  parsed: { findings: F[] },
  kind: ImportFindingKind,
): F[] => parsed.findings.filter((f) => f.kind === kind);

/** Commands of one finding kind, in occurrence order (per-page findings
 *  replaced the old document-wide report buckets). */
export const commandsOf = (
  parsed: { findings: { kind: ImportFindingKind; command: string }[] },
  kind: ImportFindingKind,
): string[] => findingsOf(parsed, kind).map((f) => f.command);

/** Read the serial-mode prop off a parsed leaf for assertions. */
export const serialOf = (
  obj: { type?: string; props?: unknown } | undefined,
): SerialMode | undefined => props(obj).serial as SerialMode | undefined;

/** Assert that a value is defined and narrow its type. */
export function defined<T>(val: T | undefined | null): T {
  expect(val).toBeDefined();
  return val as T;
}

/** Extract props from a label object as a plain record for assertions.
 *  Accepts the wide LabelObject union: groups have no `props`, so the
 *  field is optional here and treated as an empty record. The `type`
 *  field is required only to keep the parameter shape compatible with
 *  GroupObject (which has no `props` key at all; without `type` as a
 *  common field, TS rejects the union assignment). */
export const props = (
  obj: { type?: string; props?: unknown } | undefined,
): Record<string, unknown> =>
  (obj?.props ?? {}) as Record<string, unknown>;
