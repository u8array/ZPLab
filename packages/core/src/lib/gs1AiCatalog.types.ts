/** Types for the generated GS1 AI catalog (gs1AiCatalog.ts). Hand-written so
 *  the compiler and IDE check them; the generator emits data only. */

export type Gs1AiKind =
  | 'gtin' | 'fixedNum' | 'fixedAlnum' | 'varNum' | 'varAlnum' | 'date' | 'decimal';

/** Value-shape linters from the dictionary. 'cset39'/'cset64' are charset
 *  overrides (types Y/Z); 'csumalpha' (GMN check pair) is carried but not
 *  validated yet. */
export type Gs1AiLinter = 'yesno' | 'iso3166alpha2' | 'csumalpha' | 'cset39' | 'cset64';

export type Gs1AiGroup =
  | 'identification' | 'date' | 'batchQty' | 'measures'
  | 'logistics' | 'attributes' | 'internal' | 'url' | 'other';

export interface Gs1AiCatalogEntry {
  /** AI code, or a 4-digit range like '3100-3105' for decimal-position families. */
  ai: string;
  kind: Gs1AiKind;
  /** Exact length for fixed kinds, maximum for variable kinds. */
  len: number;
  checkDigit?: boolean;
  linters?: readonly Gs1AiLinter[];
  /** Date AIs only: DD=00 ("whole month") is permitted (dict flavor yymmd0). */
  day00?: boolean;
  /** Mandatory associations: at least one alternative (inner array = AIs that
   *  must all be present) must be satisfied. Members may use 'n' digit
   *  wildcards (e.g. '31nn'). Defined across ALL carriers on the item; which
   *  symbologies enforce it in-symbol is GS1_REQ_ENFORCED_TYPES
   *  (gs1BuilderPalette.ts). */
  req?: readonly (readonly string[])[];
  /** AIs (or 'n'-wildcard patterns) invalid alongside this one in a symbol. */
  ex?: readonly string[];
  /** Digital Link primary key: the ordered qualifier sequences it accepts, one
   *  alternative per inner array, an empty one for a key without qualifiers. */
  dlKey?: readonly (readonly string[])[];
  /** AI carries more than one data field; only the primary component is modeled. */
  multiComponent?: boolean;
  group: Gs1AiGroup;
  /** Short EN title from the source dict; localize before display. */
  title: string;
}
