import type { Translations } from "../locales";
import type { PreviewProvider } from "../store/slices/uiSlice";

/** The one wording per renderer, shared by the settings and the PDF metadata. */
export function previewProviderLabel(t: Translations, provider: PreviewProvider): string {
  const loc = t.printerSettings.preview;
  return { labelary: loc.providerLabelary, printer: loc.providerPrinter, none: loc.providerNone }[provider];
}
