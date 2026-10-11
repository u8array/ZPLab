import type { Translations } from "../locales";
import type { LabelState } from "../store/labelStore";
import type { PreviewProvider } from "../store/slices/uiSlice";
import { isDesktopShell } from "./platform";

/** The one wording per renderer, so every place names it the same. */
export function previewProviderLabel(t: Translations, provider: PreviewProvider): string {
  const loc = t.printerSettings.preview;
  return { labelary: loc.providerLabelary, printer: loc.providerPrinter, none: loc.providerNone }[provider];
}

export interface PreviewProviderChoice {
  provider: PreviewProvider;
  label: string;
  disabled: boolean;
  /** Wording for the lock, absent where there is none to show. */
  reason?: string;
}

/** The renderers as one choice list, so every place locks the same ones. */
export function previewProviderChoices(t: Translations, s: Pick<LabelState, "thirdParty">): PreviewProviderChoice[] {
  const loc = t.printerSettings.preview;
  return [
    { provider: "labelary", label: loc.providerLabelary, disabled: !s.thirdParty.labelary },
    { provider: "printer", label: loc.providerPrinter, disabled: !isDesktopShell, ...(isDesktopShell ? {} : { reason: loc.providerPrinterDesktopOnly }) },
    { provider: "none", label: loc.providerNone, disabled: false },
  ];
}
