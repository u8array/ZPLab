import { useState } from "react";
import { ArrowTopRightOnSquareIcon, LockClosedIcon, TrashIcon } from "@heroicons/react/16/solid";
import { useT } from "../../hooks/useT";
import { controlKeyFromBody } from "@zplab/core/types/controlKey";
import { useLabelStore } from "../../store/labelStore";
import { channelDatesFrom, resolveClockMarkers } from "@zplab/core/lib/fcTemplate";
import { isValidVariableName, markerOf } from "@zplab/core/types/Variable";
import type { SelectedMarker } from "./TemplateContentInput";

const CARD = "rounded-[9px] p-[13px] flex flex-col gap-2";
const LABEL = "text-[9px] font-mono uppercase tracking-wider text-muted";
const INPUT = "w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs font-mono text-text focus:border-accent focus:outline-none";
const REMOVE = "inline-flex items-center gap-1 text-[10px] text-muted border border-border rounded px-1.5 py-0.5 hover:text-error hover:border-error transition-colors";

/** Right-column contextual inspector. Mirrors the selected badge: variable
 *  default (global), clock read-only + channel hint, or a control key.
 *  Nothing selected shows the dashed default hint. */
export function VariableInspector({
  selected,
  onRemoveSelected,
  onLeave,
  onRename,
}: {
  selected: SelectedMarker | null;
  onRemoveSelected: () => void;
  onLeave: () => void;
  /** Renaming a variable here ripples through the store; the modal must also
   *  rewrite its uncommitted content draft so Apply doesn't revert the marker. */
  onRename: (oldName: string, newName: string) => void;
}) {
  const t = useT();
  const tv = t.variableBuilder;

  if (!selected) {
    return (
      <section className="rounded-[9px] border border-dashed border-border p-[13px]">
        <p className="text-[10px] leading-relaxed text-muted">{tv.inspectorEmpty}</p>
      </section>
    );
  }

  if (selected.kind === "var") {
    // Key by name so selecting another variable remounts with a fresh draft.
    return <VariableState key={selected.key} name={selected.key} onRemove={onRemoveSelected} onLeave={onLeave} onRename={onRename} />;
  }

  if (selected.kind === "clock") {
    return <ClockState body={selected.key} onRemove={onRemoveSelected} />;
  }

  if (selected.kind === "ctrl") {
    return (
      <section className={`${CARD} border border-ok/60`}>
        <Head
          label={controlKeyFromBody(selected.key)}
          color="text-ok"
          onRemove={onRemoveSelected}
          removeLabel={tv.remove}
        />
        <p className="text-[10px] leading-relaxed text-muted">{tv.controlHint}</p>
      </section>
    );
  }

  // Orphan marker: unknown name, can only be removed.
  return (
    <section className={`${CARD} border border-warning/60`}>
      <Head label={markerOf(selected.key)} color="text-warning" onRemove={onRemoveSelected} removeLabel={tv.remove} />
      <p className="text-[10px] leading-relaxed text-muted">{tv.inspectorOrphanHint}</p>
    </section>
  );
}

function Head({ label, color, onRemove, removeLabel }: { label: string; color: string; onRemove: () => void; removeLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-xs font-mono ${color}`}>{label}</span>
      <button type="button" className={REMOVE} onClick={onRemove}>
        <TrashIcon className="w-3 h-3" />
        {removeLabel}
      </button>
    </div>
  );
}

function VariableState({
  name,
  onRemove,
  onLeave,
  onRename,
}: {
  name: string;
  onRemove: () => void;
  onLeave: () => void;
  onRename: (oldName: string, newName: string) => void;
}) {
  const t = useT();
  const tv = t.variableBuilder;
  const variable = useLabelStore((s) => s.variables.find((v) => v.name === name));
  const updateVariable = useLabelStore((s) => s.updateVariable);
  const setSidebarTab = useLabelStore((s) => s.setSidebarTab);
  // Local draft so a transiently invalid name (empty / duplicate) does not
  // snap back on every keystroke; commit on blur / Enter like the Variables tab.
  const [nameDraft, setNameDraft] = useState(variable?.name ?? "");
  const [nameError, setNameError] = useState(false);
  if (!variable) return null;

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === variable.name) {
      setNameDraft(variable.name);
      setNameError(false);
      return;
    }
    const oldName = variable.name;
    updateVariable(variable.id, { name: trimmed });
    // The store no-ops a duplicate/invalid rename. On success resync the draft;
    // on failure KEEP the rejected input so the user can fix it and the error
    // message reflects its real cause (invalid vs in-use), not the old name.
    const after = useLabelStore.getState().variables.find((v) => v.id === variable.id);
    if (after?.name === trimmed) {
      setNameDraft(after.name);
      setNameError(false);
      onRename(oldName, trimmed); // keep the modal's content draft in sync
    } else {
      setNameError(true);
    }
  };

  // Delete and CSV mapping live in the Variables tab.
  const goManage = () => {
    onLeave();
    setSidebarTab("variables");
  };

  return (
    <section className={`${CARD} border border-indigo`}>
      <Head label={variable.name} color="text-indigo" onRemove={onRemove} removeLabel={tv.remove} />
      <div className="flex flex-col gap-1">
        <span className={LABEL}>{t.variables.nameLabel}</span>
        <input
          className={`${INPUT} text-indigo!`}
          aria-label={t.variables.nameLabel}
          value={nameDraft}
          onChange={(e) => { setNameDraft(e.target.value); setNameError(false); }}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
        {nameError && (
          <span className="text-[10px] text-error">
            {isValidVariableName(nameDraft.trim()) ? t.variables.nameInUse : t.variables.nameInvalid}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className={LABEL}>{tv.defaultValueLabel}</span>
        <input
          className={INPUT}
          value={variable.defaultValue}
          onChange={(e) => updateVariable(variable.id, { defaultValue: e.target.value })}
        />
      </div>
      <p className="text-[10px] leading-relaxed text-muted">{tv.inspectorVarHint}</p>
      <button type="button" className="inline-flex items-center gap-0.5 self-start text-[10px] text-muted hover:text-text transition-colors" onClick={goManage}>
        {tv.variablesTabLink}
        <ArrowTopRightOnSquareIcon className="w-2.5 h-2.5" />
      </button>
    </section>
  );
}

function ClockState({ body, onRemove }: { body: string; onRemove: () => void }) {
  const t = useT();
  const tv = t.variableBuilder;
  const secondaryOffset = useLabelStore((s) => s.label.secondaryClockOffset);
  const tertiaryOffset = useLabelStore((s) => s.label.tertiaryClockOffset);
  const dates = channelDatesFrom(new Date(), secondaryOffset, tertiaryOffset);
  const preview = resolveClockMarkers(markerOf(body), dates);
  return (
    <section className={`${CARD} border border-info`}>
      <Head label={tv.paletteDateTimeTitle} color="text-info" onRemove={onRemove} removeLabel={tv.remove} />
      <div className="flex items-center gap-2">
        <span className="text-base font-mono text-text">{preview}</span>
        <span className="inline-flex items-center gap-1 text-[9px] text-muted border border-border rounded px-1 py-0.5">
          <LockClosedIcon className="w-2.5 h-2.5" />
          {tv.readonly}
        </span>
      </div>
      <p className="text-[10px] leading-relaxed text-muted">{tv.inspectorClockHint}</p>
    </section>
  );
}
