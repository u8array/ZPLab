import { useEffect, useState } from "react";
import { useLabelStore } from "../store/labelStore";
import { loadCatalogSummaries, type CatalogSummaries } from "../locales/catalogSummaries";
import type { LocaleCode } from "../locales";

const NONE: CatalogSummaries = {};

/** The command descriptions for the applied UI locale; empty until the chunk arrives, and for en. */
export function useCatalogSummaries(): CatalogSummaries {
  // The applied dictionary, not the preference: the panel must not switch language ahead of the UI.
  const locale = useLabelStore((s) => s.loadedLocale);
  // Keyed by locale, so a switch shows English rather than the previous language next to the new UI.
  const [loaded, setLoaded] = useState<{ locale: LocaleCode; rows: CatalogSummaries }>();
  useEffect(() => {
    let current = true;
    loadCatalogSummaries(locale)
      .then((rows) => {
        if (current) setLoaded({ locale, rows });
      })
      .catch(() => console.warn(`catalog chunk for "${locale}" failed to load`));
    return () => {
      current = false;
    };
  }, [locale]);
  return loaded?.locale === locale ? loaded.rows : NONE;
}
