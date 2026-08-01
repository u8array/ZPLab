import { exportableLeaves, type LabelObject } from "../types/Group";
import { extractTemplateRefs } from "./fnTemplate";
import { getObjectStringContent } from "./variableBinding";
import type { Variable } from "../types/Variable";

/** ^BR and GS1 DataMatrix encode FNC1 differently and must not match. */
export function isModeDLeaf(leaf: LabelObject): boolean {
  return leaf.type === "code128" && (leaf.props as { gs1?: boolean }).gs1 === true;
}

function sweepFnConsumers(
  objects: readonly LabelObject[],
  variables: readonly Variable[],
): { modeD: Set<number>; plain128: Set<number>; other: Set<number> } {
  const fnByName = new Map(variables.map((v) => [v.name, v.fnNumber]));
  const modeD = new Set<number>();
  const plain128 = new Set<number>();
  const other = new Set<number>();
  // A non-exported consumer never prints, so it must not influence the sets.
  for (const leaf of exportableLeaves(objects)) {
    const c = getObjectStringContent(leaf);
    if (c === undefined) continue;
    // Type literal mirrors the only fdPlainEscape carrier (registry/code128);
    // a second carrier must be bucketed here too or its defaults emit raw.
    const target = isModeDLeaf(leaf)
      ? modeD
      : leaf.type === "code128" ? plain128 : other;
    for (const name of extractTemplateRefs(c)) {
      const fn = fnByName.get(name);
      if (fn !== undefined) target.add(fn);
    }
  }
  return { modeD, plain128, other };
}

export interface FnConsumerBuckets {
  modeDExclusive: Set<number>;
  modeDShared: Set<number>;
  plainExclusive: Set<number>;
  plainShared: Set<number>;
}

/** One sweep, all four slot classes. Firmware substitutes one ^FN value into
 *  every consumer, so a slot encoding is only correct when no other field
 *  type shares the slot; shared slots emit raw and preflight warns. */
export function fnConsumerBuckets(
  objects: readonly LabelObject[],
  variables: readonly Variable[],
): FnConsumerBuckets {
  const { modeD, plain128, other } = sweepFnConsumers(objects, variables);
  const split = (own: Set<number>, f1: Set<number>, f2: Set<number>) => ({
    exclusive: new Set([...own].filter((fn) => !f1.has(fn) && !f2.has(fn))),
    shared: new Set([...own].filter((fn) => f1.has(fn) || f2.has(fn))),
  });
  const d = split(modeD, other, plain128);
  const p = split(plain128, other, modeD);
  return {
    modeDExclusive: d.exclusive,
    modeDShared: d.shared,
    plainExclusive: p.exclusive,
    plainShared: p.shared,
  };
}

/** ^FN numbers consumed exclusively by GS1 mode-D Code 128 fields. */
export function gs1ModeDExclusiveFns(
  objects: readonly LabelObject[],
  variables: readonly Variable[],
): Set<number> {
  return fnConsumerBuckets(objects, variables).modeDExclusive;
}

/** ^FN numbers consumed exclusively by plain (non-GS1) Code 128 fields. */
export function code128PlainExclusiveFns(
  objects: readonly LabelObject[],
  variables: readonly Variable[],
): Set<number> {
  return fnConsumerBuckets(objects, variables).plainExclusive;
}

/** Mode-D slots shared with another field type. */
export function gs1ModeDSharedFns(
  objects: readonly LabelObject[],
  variables: readonly Variable[],
): Set<number> {
  return fnConsumerBuckets(objects, variables).modeDShared;
}

/** Plain-^BC slots shared with another field type. */
export function code128PlainSharedFns(
  objects: readonly LabelObject[],
  variables: readonly Variable[],
): Set<number> {
  return fnConsumerBuckets(objects, variables).plainShared;
}
