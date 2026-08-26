import { useEffect } from "react";
import { prepareSourceApply, MAX_SOURCE_CHARS } from "@zplab/core/lib/zplSourceEdit";
import { walkObjects, type Page } from "@zplab/core/types/Group";
import { useLabelStore, selectSourceDocumentState } from "../store/labelStore";

const DEBOUNCE_MS = 300;

/** Deterministic ids keep Konva node identity across re-parses of unchanged
 *  leading fields (an insertion renumbers the tail); shadow objects never
 *  enter the model, so collisions cannot occur. Mutates in place: the plan's
 *  pages are freshly built and consumed only by the shadow. */
function stampShadowIds(pages: Page[]): void {
  let i = 0;
  for (const p of pages) {
    for (const o of walkObjects(p.objects)) {
      (o as { id: string }).id = `shadow:${i++}`;
    }
  }
}

/** Keeps `sourceShadow` following the session draft through the same
 *  prepareSourceApply (baseline included) an apply would run; an untouched
 *  buffer clears the shadow (the live model IS the buffer). */
export function useSourceShadowSync(): void {
  const sourceEdit = useLabelStore((s) => s.sourceEdit);
  const draft = sourceEdit.status === "editing" ? sourceEdit.draft : null;
  const baseline = sourceEdit.status === "editing" ? sourceEdit.baseline : null;
  useEffect(() => {
    // Session-end actions clear the shadow themselves.
    if (draft === null || baseline === null) return;
    const shadow = useLabelStore.getState().setSourceShadow;
    if (draft === baseline) {
      const id = setTimeout(() => shadow({ doc: null, refusal: null, draft }), 0);
      return () => clearTimeout(id);
    }
    if (draft.length > MAX_SOURCE_CHARS) {
      const id = setTimeout(() => {
        useLabelStore.getState().setSourceRefusal({ reason: "tooLarge" }, draft);
      }, 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      const s = useLabelStore.getState();
      const plan = prepareSourceApply({
        text: draft,
        baseline,
        current: selectSourceDocumentState(s),
      });
      if (plan.ok) {
        stampShadowIds(plan.next.pages);
        shadow({
          doc: {
            label: plan.next.label,
            pages: plan.next.pages,
            variables: plan.next.variables,
            columnMapping: plan.next.columnMapping,
          },
          refusal: null,
          draft,
        });
      } else if (
        baseline === '' &&
        (plan.reason === 'empty' || plan.reason === 'noContent' || plan.reason === 'unbalanced')
      ) {
        // Authoring from scratch, every prefix of a label is "broken": live
        // complaints would make error the default state. An exit attempt
        // reports it, and its verdict must survive this branch.
        if (useLabelStore.getState().sourceShadow?.draft !== draft) {
          s.setSourceRefusal(null, draft);
        }
      } else {
        s.setSourceRefusal(plan, draft);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [draft, baseline]);
}
