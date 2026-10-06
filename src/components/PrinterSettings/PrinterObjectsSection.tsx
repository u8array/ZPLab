import { useState } from "react";
import { InformationCircleIcon } from "@heroicons/react/16/solid";
import { hostObjectKind, hostObjectPath, type HostGraphic, type HostObject, type HostObjectKind } from "@zplab/core/lib/hostDirectory";
import { findSetupEntry } from "@zplab/core/lib/setupEntries";
import { useT } from "../../hooks/useT";
import { formatTemplate } from "../../lib/formatTemplate";
import type { PrinterOutcome } from "../../lib/printerQuery";
import { failureText, readingText } from "../../lib/printerStatusText";
import { selectPrinterObjects, useLabelStore } from "../../store/labelStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Tooltip } from "../ui/Tooltip";
import { buttonCls, disabledCls, sectionHeadingCls, zplCommandTagCls } from "../ui/formStyles";
import { PrinterGraphicDialog } from "./PrinterGraphicDialog";

type Kind = Extract<HostObjectKind, "graphic" | "font">;

const kb = (bytes: number): string => String(bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024)));

/** The printer's own listing beside the setup script, read on request. */
export function PrinterObjectsSection({ kind }: { kind: Kind }) {
  const t = useT();
  const loc = t.printerSettings.objects;
  const status = t.printerSettings.printerStatus;
  const state = useLabelStore(selectPrinterObjects);
  const step = useLabelStore((s) => s.printerReading);
  const setupEntries = useLabelStore((s) => (kind === "graphic" ? s.printerProfile.setupGraphics : s.printerProfile.setupFonts));
  const read = useLabelStore((s) => s.readPrinterObjects);
  const readGraphic = useLabelStore((s) => s.readPrinterGraphic);
  const remove = useLabelStore((s) => s.deletePrinterObject);
  const [pendingDelete, setPendingDelete] = useState<HostObject | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [graphic, setGraphic] = useState<{ path: string; read: PrinterOutcome<HostGraphic> | "reading" } | undefined>();

  const reading = step !== undefined;
  // A drive answering with two DIR blocks would list its objects and its free space twice.
  const drives = state.phase === "done" ? [...new Map(state.directories.map((d) => [d.device, d])).values()] : [];
  const objects = [...new Map(drives.flatMap((d) => d.objects).map((o) => [hostObjectPath(o), o])).values()].filter((o) => hostObjectKind(o.ext) === kind);
  const free = drives.flatMap((d) => (d.bytesFree === undefined ? [] : [formatTemplate(loc.printerFreeFmt, { device: d.device, kb: kb(d.bytesFree) })]));
  const line =
    step !== undefined
      ? readingText(status, step)
      : state.phase === "failed"
        ? failureText(status, state.failure)
        : state.phase === "done"
          ? formatTemplate(status.checkedAtFmt, { time: new Date(state.at).toLocaleTimeString() })
          : loc.printerNotRead;
  const show = (object: HostObject) => {
    const path = hostObjectPath(object);
    setGraphic({ path, read: "reading" });
    void readGraphic(object).then((result) => setGraphic((current) => (current?.path === path ? { path, read: result } : current)));
  };
  const confirmDelete = (object: HostObject) => {
    setPendingDelete(null);
    void remove(object).then((failure) => setIssue(failure ? failureText(status, failure) : null));
  };
  const readListing = () => {
    setIssue(null);
    void read();
  };
  const deleteMessage = (object: HostObject) => {
    const path = hostObjectPath(object);
    const question = formatTemplate(kind === "graphic" ? loc.deleteGraphicConfirmFmt : loc.deleteFontConfirmFmt, { path });
    return findSetupEntry(setupEntries, path) ? `${question} ${loc.setupReuploadHint}` : question;
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className={sectionHeadingCls}>{loc.printerHeading}</h3>
          <Tooltip content={loc.printerHint}>
            <InformationCircleIcon className="w-3 h-3 text-muted/60 cursor-help shrink-0" />
          </Tooltip>
        </div>
        <span className={zplCommandTagCls}>^HW</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={reading} onClick={readListing}>
          {loc.readPrinter}
        </button>
        <span className={`text-[10px] ${state.phase === "failed" ? "text-error" : "text-muted"}`} aria-live="polite">
          {line}
        </span>
      </div>
      {issue && (
        <p role="alert" className="text-[10px] text-error">
          {issue}
        </p>
      )}
      {state.phase === "done" &&
        (objects.length === 0 ? (
          <p className="text-xs text-muted/70">{loc.printerEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {objects.map((o) => {
              const path = hostObjectPath(o);
              return (
                <li key={path} className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-transparent hover:border-border-2 hover:bg-surface-2/40 transition-colors">
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-mono text-xs text-text truncate" title={path}>
                      {path}
                    </span>
                    <span className="text-[10px] text-muted">{formatTemplate(loc.objectSizeFmt, { kb: kb(o.size) })}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {kind === "graphic" && (
                      <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={reading} onClick={() => show(o)}>
                        {loc.showObject}
                      </button>
                    )}
                    <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={reading} onClick={() => setPendingDelete(o)}>
                      {loc.deleteObject}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ))}
      {free.length > 0 && <p className="text-[10px] text-muted">{free.join(", ")}</p>}
      {state.phase === "done" && pendingDelete && (
        <ConfirmDialog
          message={deleteMessage(pendingDelete)}
          confirmLabel={loc.deleteObject}
          cancelLabel={t.app.cancel}
          destructive
          onConfirm={() => confirmDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {state.phase === "done" && graphic && <PrinterGraphicDialog path={graphic.path} read={graphic.read} onClose={() => setGraphic(undefined)} />}
    </section>
  );
}
