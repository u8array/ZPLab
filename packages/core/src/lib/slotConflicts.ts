import { exportableLeaves, type LabelObject } from "../types/Group";
import { classifyField } from "./variableField";
import { qrPrintsAsGraphic } from "./objectBounds";
import { resolveContentPreview } from "./markerResolve";
import { planCode128Fd } from "./code128Plan";
import { getEntry, isGs1Active, usesPlainCode128Escape } from "../registry";
import { extractTemplateRefs } from "./fnTemplate";
import { getObjectStringContent } from "./variableBinding";
import { fnConsumerBuckets, type FnConsumerBuckets } from "./gs1ModeDFns";
import type { Variable } from "../types/Variable";

type SlotEncoder = ((s: string) => string) | undefined;

export interface SlotConflicts {
  fns: Set<number>;
  /** Leaves that consume a conflicted slot; findings must not blame others. */
  consumerIds: Set<string>;
}

/** Slots whose consumers would put DIFFERENT bytes in the one substituted
 *  value: the emitting field wins, every consumer prints its encoding.
 *  Values must be RAW (chips unresolved): fdFieldFor transforms the
 *  unresolved default; the code128 plans resolve chips internally. */
export function slotEncodingConflicts(
  objects: readonly LabelObject[],
  variables: readonly Variable[],
  substitutionsOf: (v: Variable) => readonly string[] = (v) => [v.defaultValue],
  buckets: FnConsumerBuckets = fnConsumerBuckets(objects, variables),
): SlotConflicts {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const perSlot = new Map<
    number,
    { encoders: SlotEncoder[]; vars: Set<Variable>; leafIds: string[] }
  >();
  const note = (v: Variable, encode: SlotEncoder, leafId: string) => {
    const slot =
      perSlot.get(v.fnNumber) ??
      { encoders: [], vars: new Set<Variable>(), leafIds: [] };
    slot.encoders.push(encode);
    slot.vars.add(v);
    slot.leafIds.push(leafId);
    perSlot.set(v.fnNumber, slot);
  };
  for (const leaf of exportableLeaves(objects)) {
    const c = getObjectStringContent(leaf);
    if (c === undefined) continue;
    const entry = getEntry(leaf.type);
    // An unregistered type emits nothing, so it consumes no slot.
    if (!entry) continue;
    const props = (leaf as { props?: { serial?: object } }).props;
    // ^SN serial replaces the whole ^FD (no ^FN); GS1-mode serial keeps fdFieldFor.
    if (props?.serial && !isGs1Active(entry, props)) continue;
    // A rotated QR ships as ^GFA (no ^FN) only when its content resolves
    // non-empty; empty falls back to a real ^BQ+^FN emit (registry/qrcode).
    if (qrPrintsAsGraphic(leaf) && resolveContentPreview(c, variables)) continue;
    const cls = classifyField(c, variables);
    if (cls.kind === "single") {
      // fdFieldFor encodes the single-bind value; a plain-^BC lone bind on a
      // shared slot is degraded to sharedRaw by the emit (barcode1d, rawFdFns).
      note(
        cls.variable,
        usesPlainCode128Escape(entry, props) && buckets.plainShared.has(cls.variable.fnNumber)
          ? (s: string) => planCode128Fd(s, "sharedRaw").fd
          : entry.fdTransform?.(leaf),
        leaf.id,
      );
      continue;
    }
    // Every other shape embeds the slot inside its own payload and reads it raw.
    for (const name of extractTemplateRefs(c)) {
      const v = byName.get(name);
      if (v) note(v, undefined, leaf.id);
    }
  }
  const fns = new Set<number>();
  const consumerIds = new Set<string>();
  for (const [fn, { encoders, vars, leafIds }] of perSlot) {
    if (encoders.length < 2) continue;
    // Exclusive code128-family slots are emit-coordinated: all consumers
    // share the ^BC grammar, so byte differences (>0) decode identically.
    if (buckets.modeDExclusive.has(fn) || buckets.plainExclusive.has(fn)) continue;
    // All-raw readers cannot diverge; skip the row walk.
    if (encoders.every((e) => e === undefined)) continue;
    const diverges = [...vars].some((v) =>
      substitutionsOf(v).some(
        (val) => new Set(encoders.map((e) => (e ? e(val) : val))).size > 1,
      ),
    );
    if (diverges) {
      fns.add(fn);
      for (const id of leafIds) consumerIds.add(id);
    }
  }
  return { fns, consumerIds };
}
