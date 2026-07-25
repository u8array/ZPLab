import { useState } from "react";
import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { FONT_LINKS_MAX_PER_BASE } from "@zplab/core/types/PrinterProfile";
import { SafeStringInput, ZplCommandLabel, ZplField, ZplFieldHint } from "./zplFieldPrimitives";

import { newId } from "@zplab/core/lib/ids";
function overflowingBases(links: readonly { base: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const l of links) {
    const key = l.base.trim();
    if (key.length === 0) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > FONT_LINKS_MAX_PER_BASE).map(([b]) => b);
}

/** ^FL font-link editor; each row is one (ext, base) pair. */
export function FontLinksField() {
  const t = useT();
  const loc = t.printerSettings.encodingLanguage;
  const profile = useLabelStore((s) => s.printerProfile);
  const patch = useLabelStore((s) => s.patchPrinterProfile);
  const links = profile.fontLinks ?? [];
  const overflowing = overflowingBases(links);

  // Stable per-row IDs preserve focus when rows are removed mid-list.
  // Re-synced when links arrive from outside the component (import, rehydrate).
  const [rowIds, setRowIds] = useState<string[]>(() => links.map(() => newId()));
  if (rowIds.length !== links.length) {
    const next = rowIds.slice(0, links.length);
    while (next.length < links.length) next.push(newId());
    setRowIds(next);
  }

  const updateRow = (i: number, patchRow: Partial<{ ext: string; base: string }>) => {
    patch({ fontLinks: links.map((x, idx) => idx === i ? { ...x, ...patchRow } : x) });
  };
  const removeRow = (i: number) => {
    const next = links.filter((_, idx) => idx !== i);
    setRowIds(rowIds.filter((_, idx) => idx !== i));
    patch({ fontLinks: next.length > 0 ? next : undefined });
  };
  const addRow = () => {
    setRowIds([...rowIds, newId()]);
    patch({ fontLinks: [...links, { ext: "", base: "" }] });
  };

  return (
    <ZplField>
      <ZplCommandLabel text={loc.fontLinks} command="^FL" />
      <ZplFieldHint>{loc.fontLinksHint}</ZplFieldHint>
      {links.length === 0 && (
        <p className="font-mono text-[10px] text-muted/70">{loc.fontLinksEmpty}</p>
      )}
      {overflowing.length > 0 && (
        <p className="font-mono text-[10px] text-warning">
          {loc.fontLinksOverLimitFmt.replaceAll("{bases}", overflowing.join(", "))}
        </p>
      )}
      {links.map((l, i) => (
        <div key={rowIds[i]} className="grid grid-cols-[1fr_1fr_auto] gap-1 items-center">
          <SafeStringInput
            value={l.ext}
            placeholder={loc.fontLinksExt}
            onChange={(v) => updateRow(i, { ext: v })}
          />
          <SafeStringInput
            value={l.base}
            placeholder={loc.fontLinksBase}
            onChange={(v) => updateRow(i, { base: v })}
          />
          <button
            type="button"
            className="font-mono text-[10px] text-muted hover:text-red-400 px-1"
            onClick={() => removeRow(i)}
            aria-label={loc.fontLinksRemove}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="font-mono text-[10px] text-accent hover:text-accent-bright self-start"
        onClick={addRow}
      >
        + {loc.fontLinksAdd}
      </button>
    </ZplField>
  );
}
