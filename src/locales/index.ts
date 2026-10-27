/**
 * Locale registry with lazy loading: only `en` (type anchor + fallback) is
 * bundled into the main chunk; every other language becomes its own Vite
 * chunk fetched on demand. The loader map's return type checks each locale
 * module against the `en` shape at compile time.
 */
import en from './en';

/** Widen the `as const` literal strings of a locale to plain `string`,
 *  keeping the key structure: the shape check must accept translated
 *  values, not demand en's exact literals. */
type DeepWiden<T> = T extends string
  ? string
  : T extends number | boolean | null | undefined
    ? T
    : T extends readonly (infer U)[]
      ? readonly DeepWiden<U>[]
      : { readonly [K in keyof T]: DeepWiden<T[K]> };

/** Shape of a single locale dictionary, anchored on `en`. */
export type Translations = DeepWiden<typeof en>;

/** Bundled fallback; also the pre-seeded store default before bootstrap. */
export const fallbackTranslations: Translations = en;

// The `satisfies` clause checks every loader's module shape against the en
// anchor, so a locale missing keys fails to compile.
const loaders = {
  en: async () => ({ default: en }),
  de: () => import('./de'),
  fr: () => import('./fr'),
  es: () => import('./es'),
  ca: () => import('./ca'),
  pt: () => import('./pt'),
  it: () => import('./it'),
  nl: () => import('./nl'),
  pl: () => import('./pl'),
  cs: () => import('./cs'),
  sk: () => import('./sk'),
  hu: () => import('./hu'),
  ro: () => import('./ro'),
  sv: () => import('./sv'),
  no: () => import('./no'),
  da: () => import('./da'),
  fi: () => import('./fi'),
  el: () => import('./el'),
  bg: () => import('./bg'),
  hr: () => import('./hr'),
  sr: () => import('./sr'),
  sl: () => import('./sl'),
  et: () => import('./et'),
  lv: () => import('./lv'),
  lt: () => import('./lt'),
  ar: () => import('./ar'),
  he: () => import('./he'),
  fa: () => import('./fa'),
  tr: () => import('./tr'),
  'zh-hans': () => import('./zh-hans'),
  'zh-hant': () => import('./zh-hant'),
  ja: () => import('./ja'),
  ko: () => import('./ko'),
} satisfies Record<string, () => Promise<{ default: Translations }>>;

export type LocaleCode = keyof typeof loaders;

export const LOCALE_CODES = Object.keys(loaders) as readonly LocaleCode[];

export function isLocaleCode(value: string): value is LocaleCode {
  // hasOwn, not `in`: a guard must stay false for prototype keys
  // ("constructor") no matter what callers pass.
  return Object.hasOwn(loaders, value);
}

const cache = new Map<LocaleCode, Translations>([['en', en]]);

/** Load (and cache) a locale's translations. */
export async function loadLocale(code: LocaleCode): Promise<Translations> {
  const hit = cache.get(code);
  if (hit) return hit;
  const mod = await loaders[code]();
  cache.set(code, mod.default);
  return mod.default;
}

export const localeNames: Record<LocaleCode, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ca: 'Català',
  pt: 'Português',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  cs: 'Čeština',
  sk: 'Slovenčina',
  hu: 'Magyar',
  ro: 'Română',
  sv: 'Svenska',
  no: 'Norsk',
  da: 'Dansk',
  fi: 'Suomi',
  el: 'Ελληνικά',
  bg: 'Български',
  hr: 'Hrvatski',
  sr: 'Srpski',
  sl: 'Slovenščina',
  et: 'Eesti',
  lv: 'Latviešu',
  lt: 'Lietuvių',
  ar: 'العربية',
  he: 'עברית',
  fa: 'فارسی',
  tr: 'Türkçe',
  'zh-hans': '中文 (简体)',
  'zh-hant': '中文 (繁體)',
  ja: '日本語',
  ko: '한국어',
};

/** localeNames as `{value, label}` options for the language pickers (settings
 *  Select and the web-header dropdown consume the same source). */
export function localeOptions(): { value: LocaleCode; label: string }[] {
  return (Object.entries(localeNames) as [LocaleCode, string][]).map(
    ([value, label]) => ({ value, label }),
  );
}
