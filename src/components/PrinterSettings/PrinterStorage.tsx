import { useState } from "react";
import { InformationCircleIcon } from "@heroicons/react/16/solid";
import { hostObjectPath, type HostObject } from "@zplab/core/lib/hostDirectory";
import { isWritableDevice } from "@zplab/core/lib/storagePath";
import { deleteKnowledge, driveUsage, listedObject, originState, type DeleteKnowledge, type OriginState, type StoredObjectKind, type StoredObjectOrigin } from "@zplab/core/lib/storedObjectOrigins";
import { isDesktopShell } from "../../lib/platform";
import { usePrinterListing } from "../../hooks/usePrinterListing";
import { useT } from "../../hooks/useT";
import type { Translations } from "../../locales";
import { formatTemplate } from "../../lib/formatTemplate";
import type { PrinterOutcome } from "../../lib/printerQuery";
import type { PrinterObjectsState } from "../../store/slices/printerObjectsSlice";
import { failureText, readingText } from "../../lib/printerStatusText";
import { selectPrinterObjects, useLabelStore } from "../../store/labelStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { MemoryBar } from "../ui/MemoryBar";
import { Tooltip } from "../ui/Tooltip";
import { buttonCls, disabledCls, sectionHeadingCls, zplCommandTagCls } from "../ui/formStyles";
import { PrinterImageDialog } from "./PrinterImageDialog";
import { useStoredObjectHover } from "../../hooks/useStoredObjectHover";

const kb = (bytes: number): string => String(bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024)));

export function StoredObjectsHeading() {
  const loc = useT().printerSettings.objects;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <h3 className={sectionHeadingCls}>{loc.listHeading}</h3>
        <Tooltip content={isDesktopShell ? `${loc.listHint} ${loc.listHintPrinter}` : loc.listHint}>
          <InformationCircleIcon className="w-3 h-3 text-muted/60 cursor-help shrink-0" />
        </Tooltip>
      </div>
      <span className="flex items-center gap-1">
        <span className={zplCommandTagCls}>~DY</span>
        {isDesktopShell && <span className={zplCommandTagCls}>^HW</span>}
      </span>
    </div>
  );
}

export function PrinterStorageBar() {
  const t = useT();
  const loc = t.printerSettings.objects;
  const status = t.printerSettings.printerStatus;
  const state = useLabelStore(selectPrinterObjects);
  const step = useLabelStore((s) => s.printerReading);
  const read = useLabelStore((s) => s.readPrinterObjects);
  const line =
    step !== undefined
      ? readingText(status, step)
      : state.phase === "failed"
        ? failureText(status, state.failure)
        : state.phase === "done"
          ? formatTemplate(status.checkedAtFmt, { time: new Date(state.at).toLocaleTimeString() })
          : loc.printerNotRead;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={step !== undefined} onClick={() => void read()}>
          {loc.readPrinter}
        </button>
        <span className={`text-[10px] ${state.phase === "failed" ? "text-error" : "text-muted"}`} aria-live="polite">
          {line}
        </span>
      </div>
    </div>
  );
}

/** Beside the lists rather than inside one, so it stands while the tabs change. */
export function PrinterStorageUsage() {
  const loc = useT().printerSettings.objects;
  const listing = usePrinterListing();
  const { hoveredKey } = useStoredObjectHover();
  const drives = listing ? driveUsage(listing) : [];
  const hovered = listing && hoveredKey ? listedObject(listing, hoveredKey) : undefined;
  if (drives.length === 0) return null;
  return (
    <div className="px-3 pb-3 pt-2 border-t border-border flex flex-col gap-2">
      {drives.map((usage) => {
        const share = hovered?.device === usage.device ? hovered : undefined;
        return (
          <div key={usage.device} className="flex flex-col gap-0.5">
            <Tooltip content={loc.usageHint}>
              <span className="text-[10px] text-muted cursor-help">
                {formatTemplate(loc.usageFmt, { device: usage.device, used: kb(usage.used), free: kb(usage.free) })}
              </span>
            </Tooltip>
            <MemoryBar used={usage.used} capacity={usage.capacity} highlight={share?.size ?? 0} />
            {share && (
              <span className="text-[10px] text-accent truncate" title={hostObjectPath(share)}>
                {formatTemplate(loc.usageObjectFmt, {
                  path: hostObjectPath(share),
                  kb: kb(share.size),
                  percent: ((share.size / usage.capacity) * 100).toFixed(1),
                })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const ORIGIN_KEY = {
  missingOnPrinter: "originMissing",
  notOnPrinter: "originAbsent",
  onPrinter: "originOnPrinter",
  printerOnly: "originPrinterOnly",
} as const satisfies Record<Exclude<OriginState, "unread">, keyof Translations["printerSettings"]["objects"]>;

export function PrinterOriginMark({ origin }: { origin: StoredObjectOrigin }) {
  const loc = useT().printerSettings.objects;
  const state = originState(origin);
  if (state === "unread") return null;
  return (
    <span className="flex items-center gap-2">
      <span className={`text-[10px] ${state === "missingOnPrinter" ? "text-warning" : "text-muted"}`}>{loc[ORIGIN_KEY[state]]}</span>
      {origin.hostObject && <span className="text-[10px] text-muted">{formatTemplate(loc.objectSizeFmt, { kb: kb(origin.hostObject.size) })}</span>}
    </span>
  );
}

const KNOWLEDGE_KEY = {
  setupReuploads: "setupReuploadHint",
  localCopy: "deleteLocalCopyHint",
  noCopy: "deleteNoCopyHint",
} as const satisfies Record<DeleteKnowledge, keyof Translations["printerSettings"]["objects"]>;

export function PrinterObjectActions({ origin, kind }: { origin: StoredObjectOrigin & { hostObject: HostObject }; kind: StoredObjectKind }) {
  const t = useT();
  const loc = t.printerSettings.objects;
  const object = origin.hostObject;
  const reading = useLabelStore((s) => s.printerReading !== undefined);
  const listing = useLabelStore(selectPrinterObjects);
  const readImage = useLabelStore((s) => s.readPrinterObjectImage);
  const remove = useLabelStore((s) => s.deletePrinterObject);
  const [pendingDelete, setPendingDelete] = useState(false);
  // The message belongs to the listing it was reported against, so the next read retires it.
  const [issue, setIssue] = useState<{ listing: PrinterObjectsState; text: string }>();
  const [image, setImage] = useState<PrinterOutcome<string | null> | "reading">();
  const writable = isWritableDevice(object.device);

  const show = () => {
    setImage("reading");
    // The dialog closed while the read ran, so its result has nowhere to land.
    void readImage(object).then((read) => setImage((current) => (current === undefined ? current : read)));
  };
  const confirmDelete = () => {
    setPendingDelete(false);
    setIssue(undefined);
    void remove(object).then((failure) => {
      const listing = selectPrinterObjects(useLabelStore.getState());
      setIssue(failure ? { listing, text: failureText(t.printerSettings.printerStatus, failure) } : undefined);
    });
  };

  return (
    <>
      <span className="flex items-center gap-1 shrink-0">
        {issue?.listing === listing && (
          <span role="alert" className="text-[10px] text-error">
            {issue.text}
          </span>
        )}
        <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={reading} onClick={show}>
          {loc.showObject}
        </button>
        <Tooltip content={writable ? undefined : loc.firmwareObject}>
          <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={reading || !writable} onClick={() => setPendingDelete(true)}>
            {loc.deleteObject}
          </button>
        </Tooltip>
      </span>
      {pendingDelete && (
        <ConfirmDialog
          message={`${formatTemplate(kind === "graphic" ? loc.deleteGraphicConfirmFmt : loc.deleteFontConfirmFmt, { path: origin.path })} ${loc[KNOWLEDGE_KEY[deleteKnowledge(origin)]]}`}
          confirmLabel={loc.deleteObject}
          cancelLabel={t.app.cancel}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(false)}
        />
      )}
      {image && <PrinterImageDialog path={origin.path} read={image} blankText={kind === "font" ? loc.fontSampleBlank : loc.graphicUnreadable} onClose={() => setImage(undefined)} />}
    </>
  );
}
