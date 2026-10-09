import { useState, type ReactNode } from "react";
import { LabelaryNoticeModal } from "../components/Output/LabelaryNoticeModal";
import { useLabelStore, selectEffectivePreviewProvider, selectLabelaryNoticeRequired } from "../store/labelStore";

/** The consent a third-party render needs before the first request. `gate` holds the action while the
 *  notice is open, so the caller's own waiting state covers the first render like every later one. */
export function useLabelaryConsent(): { gate: (action: () => void) => void; notice: ReactNode } {
  const renderer = useLabelStore(selectEffectivePreviewProvider);
  const required = useLabelStore(selectLabelaryNoticeRequired);
  const [pending, setPending] = useState<(() => void) | null>(null);

  const gate = (action: () => void) => {
    if (renderer === "labelary" && required) {
      setPending(() => action);
      return;
    }
    action();
  };

  return {
    gate,
    notice: pending ? (
      <LabelaryNoticeModal
        onClose={() => setPending(null)}
        onContinue={() => {
          setPending(null);
          pending();
        }}
      />
    ) : null,
  };
}
