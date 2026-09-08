// Command descriptions per locale, one JSON chunk each, fetched on demand like
// the UI dictionaries. Each row carries the hash of the English text it was
// translated from; catalogSummaries.test.ts fails the build on a stale one.
import type { LocaleCode } from ".";

export interface CatalogTranslation {
  hash: string;
  summary: string;
}
export type CatalogSummaries = Readonly<Record<string, CatalogTranslation>>;

const loaders = {
  de: () => import("./catalog/de.json"),
  fr: () => import("./catalog/fr.json"),
  es: () => import("./catalog/es.json"),
  pt: () => import("./catalog/pt.json"),
  it: () => import("./catalog/it.json"),
  nl: () => import("./catalog/nl.json"),
  pl: () => import("./catalog/pl.json"),
  cs: () => import("./catalog/cs.json"),
  sk: () => import("./catalog/sk.json"),
  hu: () => import("./catalog/hu.json"),
  ro: () => import("./catalog/ro.json"),
  sv: () => import("./catalog/sv.json"),
  no: () => import("./catalog/no.json"),
  da: () => import("./catalog/da.json"),
  fi: () => import("./catalog/fi.json"),
  el: () => import("./catalog/el.json"),
  bg: () => import("./catalog/bg.json"),
  hr: () => import("./catalog/hr.json"),
  sr: () => import("./catalog/sr.json"),
  sl: () => import("./catalog/sl.json"),
  et: () => import("./catalog/et.json"),
  lv: () => import("./catalog/lv.json"),
  lt: () => import("./catalog/lt.json"),
  ar: () => import("./catalog/ar.json"),
  he: () => import("./catalog/he.json"),
  fa: () => import("./catalog/fa.json"),
  tr: () => import("./catalog/tr.json"),
  "zh-hans": () => import("./catalog/zh-hans.json"),
  "zh-hant": () => import("./catalog/zh-hant.json"),
  ja: () => import("./catalog/ja.json"),
  ko: () => import("./catalog/ko.json"),
} satisfies Partial<Record<LocaleCode, () => Promise<{ default: CatalogSummaries }>>>;

export const CATALOG_SUMMARY_LOCALES = Object.keys(loaders) as readonly (keyof typeof loaders)[];

const NONE: CatalogSummaries = {};
const cache = new Map<LocaleCode, CatalogSummaries>();

/** The descriptions in `locale`; `en` resolves to none, so the caller shows the catalog's own text. */
export async function loadCatalogSummaries(locale: LocaleCode): Promise<CatalogSummaries> {
  const cached = cache.get(locale);
  if (cached) return cached;
  const load = locale in loaders ? loaders[locale as keyof typeof loaders] : null;
  const loaded = load ? (await load()).default : NONE;
  cache.set(locale, loaded);
  return loaded;
}
