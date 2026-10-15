import { walkObjects, type LabelObject } from "../types/Group";
import type { LabelObjectBase } from "../types/LabelObject";
import { SINGLE_MARKER_RE, type Variable } from "../types/Variable";
import { getObjectStringContent } from "./variableBinding";
import { extractTemplateRefs } from "./fnTemplate";
import { extractClockTokens } from "./fcTemplate";

/** Any bindable leaf: a base object with a string `content` prop. The registry
 *  panels' narrowed obj types satisfy this structurally; `asLabelObject` is the
 *  one documented seam for passing it to the union-typed helpers below. */
export type BindableLeaf = LabelObjectBase & { props: { content: string } };
export const asLabelObject = (obj: BindableLeaf): LabelObject => obj as unknown as LabelObject;

/** True when content is exactly one `«marker»` and nothing else: the shape that
 *  emits inline (single-bind) rather than expanding to `^FE` embeds. */
export function isLoneMarker(content: string): boolean {
  return SINGLE_MARKER_RE.test(content);
}

/** The single-bound Variable for a field (content === exactly one known
 *  marker), or undefined for template/literal/empty content. Drives the layer
 *  badge and the canvas fallback tint. */
export function lookupBoundVariable(
  obj: LabelObject,
  variables: readonly Variable[],
): Variable | undefined {
  const content = getObjectStringContent(obj);
  if (content === undefined) return undefined;
  const cls = classifyField(content, variables);
  return cls.kind === "single" ? cls.variable : undefined;
}

export type FieldMode = "single" | "template" | "literal" | "empty";

/** Content-only classification, the variableId-free model: content that is
 *  exactly one known variable marker is Single-Bind (emits the inline
 *  `^FN{n}^FD{default}^FS`); any other marker shape is Template (`^FD` + `^FE`
 *  embeds + header); no known markers is Literal. This is the single decision
 *  emit and preview both consume, so they can never diverge. Ignores
 *  `variableId` entirely. */
export type FieldClassification =
  | { kind: "single"; variable: Variable }
  | { kind: "template"; refs: Variable[] }
  | { kind: "literal" };

export function classifyField(
  content: string,
  variables: readonly Variable[],
): FieldClassification {
  const single = SINGLE_MARKER_RE.exec(content);
  if (single && single[1] !== undefined) {
    const v = variables.find((x) => x.name === single[1]);
    if (v) return { kind: "single", variable: v };
  }
  // Known variable refs only; clock markers and orphan names resolve to nothing
  // here (clock is emitted via ^FC, an orphan stays literal).
  const names = extractTemplateRefs(content);
  const byName = new Map(variables.map((v) => [v.name, v]));
  const refs: Variable[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const v = byName.get(name);
    if (v && !seen.has(v.id)) {
      seen.add(v.id);
      refs.push(v);
    }
  }
  return names.length > 0 ? { kind: "template", refs } : { kind: "literal" };
}

/** Drives the always-visible mode badge. */
export function fieldMode(
  obj: LabelObject,
  variables: readonly Variable[],
): FieldMode {
  const content = getObjectStringContent(obj) ?? "";
  if (content === "") return "empty";
  return classifyField(content, variables).kind;
}

/** The literal value a field prints absent a CSV row: a single-bind field
 *  prints its variable's CURRENT default (the object's `content` is only a
 *  mirror that can go stale when the default is edited in the Variables panel),
 *  everything else prints its own content. Template content is markers with no
 *  fixed length, so callers gate length/charset checks to non-template modes. */
export function boundDefaultOrContent(
  obj: LabelObject,
  variables: readonly Variable[],
): string {
  const content = getObjectStringContent(obj) ?? "";
  const cls = classifyField(content, variables);
  return cls.kind === "single" ? cls.variable.defaultValue : content;
}

/** True when the field carries a variable (single-bind or template); callers
 *  use this to gate literal-only affordances (length checks, typed-content
 *  builders) that don't apply once a binding is present. */
export function fieldHasVariable(
  obj: LabelObject,
  variables: readonly Variable[],
): boolean {
  const m = fieldMode(obj, variables);
  return m === "single" || m === "template";
}

/** The field's ^FN variables (single-bind marker ∪ template marker refs),
 *  deduped; excludes clock tokens and orphan markers. Feeds the "used in this
 *  field" inspector and the layer badge. Thin view over classifyField so the
 *  ref extraction has one implementation. */
export function fieldVariableRefs(
  obj: LabelObject,
  variables: readonly Variable[],
): Variable[] {
  const content = getObjectStringContent(obj) ?? "";
  const cls = classifyField(content, variables);
  return cls.kind === "single" ? [cls.variable] : cls.kind === "template" ? cls.refs : [];
}

/** Walk every page (groups too) and tally how many fields reference each
 *  variable via inline `«name»` markers in their content (single-bind is the
 *  lone-marker case). Returns a Map keyed by variable.id. Variables with no
 *  bindings are absent; callers default to 0. */
export function countBindings(
  pages: readonly { objects: LabelObject[] }[],
  variables: readonly Variable[],
): Map<string, number> {
  const byName = new Map(variables.map((v) => [v.name, v.id]));
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const obj of walkObjects(page.objects)) {
      // De-dupe per OBJECT: a field repeating `«V»` counts as one usage of V,
      // not two. One field = one place, mirroring how the user thinks about it.
      const refsInThisObj = new Set<string>();
      const c = getObjectStringContent(obj);
      if (c !== undefined) {
        for (const name of extractTemplateRefs(c)) {
          const id = byName.get(name);
          if (id) refsInThisObj.add(id);
        }
      }
      for (const id of refsInThisObj) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Token counts for the disclosure header ("2× ^FN · 1× ^FC"). Single-bind is
 *  the lone-marker case, so the generic content scan already yields fn=1. */
export function fieldTokenSummary(
  obj: LabelObject,
  variables: readonly Variable[],
): { fn: number; fc: number } {
  const content = getObjectStringContent(obj) ?? "";
  const names = new Set(variables.map((v) => v.name));
  const fn = extractTemplateRefs(content).filter((n) => names.has(n)).length;
  const fc = extractClockTokens(content).length;
  return { fn, fc };
}
