import type { Translations } from "../locales";
import type { PreviewProvider } from "../store/slices/uiSlice";
import type { PrintReach } from "./printTarget";

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
export function previewProviderChoices(t: Translations, offered: { labelary: boolean; printer: boolean }, reach: PrintReach): PreviewProviderChoice[] {
  const loc = t.printerSettings.preview;
  return [
    { provider: "labelary", label: loc.providerLabelary, disabled: !offered.labelary },
    { provider: "printer", label: loc.providerPrinter, disabled: !offered.printer, ...(offered.printer ? {} : { reason: reach.server ? loc.providerPrinterServerOnly : loc.providerPrinterDesktopOnly }) },
    { provider: "none", label: loc.providerNone, disabled: false },
  ];
}
