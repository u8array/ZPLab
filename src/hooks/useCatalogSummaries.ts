import { useEffect, useState } from "react";
import { useLabelStore } from "../store/labelStore";
import { loadCatalogSummaries, type CatalogSummaries } from "../locales/catalogSummaries";

const NONE: CatalogSummaries = {};

/** The command descriptions for the applied UI locale; empty until the chunk arrives, and for en. */
export function useCatalogSummaries(): CatalogSummaries {
  // The applied dictionary, not the preference: the panel must not switch language ahead of the UI.
  const locale = useLabelStore((s) => s.loadedLocale);
  const [summaries, setSummaries] = useState<CatalogSummaries>(NONE);
  useEffect(() => {
    let current = true;
    void loadCatalogSummaries(locale).then((rows) => {
      if (current) setSummaries(rows);
    });
    return () => {
      current = false;
    };
  }, [locale]);
  return summaries;
}
