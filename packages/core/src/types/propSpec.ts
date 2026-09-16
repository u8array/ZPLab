/** How a density change or a resize treats a numeric prop. `never` is a decision, not an omission. */
export type PropScale =
  | 'never'
  /** Dot length, floored at 1 after scaling; 0 (unset) stays 0. */
  | 'dots'
  /** Dot length that is legitimately 0 (auto width, no gap). */
  | 'dotsMin0'
  /** Signed dot length (^FB line spacing), scaled with its sign. */
  | 'dotsSigned'
  /** ^BY-style module width. */
  | 'module'
  /** The single module or magnification prop of a uniform 2D symbology. */
  | 'uniform';

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface NumberPropSpec<V extends number = number> {
  type: 'number';
  /** What the wire accepts; a caller's value is refused outside, a parsed design is not. */
  min?: number;
  max?: number;
  integer?: true;
  values?: readonly V[];
  scale: PropScale;
  /** Editor bounds where the wire allows more; resize, rescale and panels clamp into these. */
  clamp?: Range;
}

export interface StringPropSpec<V extends string = string> {
  type: 'string';
  values?: readonly V[];
}

export interface BooleanPropSpec {
  type: 'boolean';
}

export interface ObjectPropSpec {
  type: 'object';
}

export type PropSpec = NumberPropSpec | StringPropSpec | BooleanPropSpec | ObjectPropSpec;

export type PropSpecFor<V> = [V] extends [number]
  ? NumberPropSpec<V>
  : [V] extends [string]
    ? StringPropSpec<V>
    : [V] extends [boolean]
      ? BooleanPropSpec
      : ObjectPropSpec;

/** Every key of the props type, optional ones included, so a new prop cannot ship without its contract. */
export type PropSpecs<P extends object> = { readonly [K in keyof P]-?: PropSpecFor<NonNullable<P[K]>> };

export function wireBounds(spec: PropSpec | undefined): Range {
  const n = spec?.type === 'number' ? spec : undefined;
  return { min: n?.min ?? -Infinity, max: n?.max ?? Infinity };
}

export function editBounds(spec: PropSpec | undefined): Range {
  return spec?.type === 'number' && spec.clamp ? spec.clamp : wireBounds(spec);
}

export function moduleScaledProps<P extends object>(specs: PropSpecs<P>): (keyof P & string)[] {
  const all = specs as Readonly<Record<string, PropSpec>>;
  return Object.keys(all).filter((k) => all[k]?.type === 'number' && all[k]?.scale === 'module') as (keyof P & string)[];
}

function valueKind(value: unknown): string {
  return Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
}

/** Tail of a "<prop> …" sentence. */
export function propTypeIssue(spec: PropSpec, value: unknown): string | null {
  const kind = valueKind(value);
  if (kind !== spec.type) return `must be ${spec.type} (got ${kind})`;
  if (spec.type === 'number' && !Number.isFinite(value as number)) return 'must be a finite number';
  return null;
}

/** Assumes `propTypeIssue` passed. */
export function propDomainIssue(spec: PropSpec, value: unknown): string | null {
  if (spec.type === 'number') {
    const v = value as number;
    if (spec.values) return spec.values.includes(v) ? null : `must be ${spec.values.join(', ')} (got ${v})`;
    if (spec.integer && !Number.isInteger(v)) return `must be an integer (got ${v})`;
    if (spec.min !== undefined && spec.max !== undefined && (v < spec.min || v > spec.max)) return `must be between ${spec.min} and ${spec.max} (got ${v})`;
    if (spec.min !== undefined && v < spec.min) return `must be at least ${spec.min} (got ${v})`;
    if (spec.max !== undefined && v > spec.max) return `must be at most ${spec.max} (got ${v})`;
  }
  if (spec.type === 'string' && spec.values && !spec.values.includes(value as string)) {
    return `must be ${spec.values.join(', ')} (got ${JSON.stringify(value)})`;
  }
  return null;
}

/** The wire domain in words. */
export function describePropDomain(spec: PropSpec): string | undefined {
  if (spec.type === 'string') return spec.values ? spec.values.join(' | ') : undefined;
  if (spec.type !== 'number') return undefined;
  if (spec.values) return spec.values.join(' | ');
  const kind = spec.integer ? 'integer' : 'number';
  if (spec.min !== undefined && spec.max !== undefined) return `${kind} ${spec.min}..${spec.max}`;
  if (spec.min !== undefined) return `${kind} >= ${spec.min}`;
  if (spec.max !== undefined) return `${kind} <= ${spec.max}`;
  return spec.integer ? kind : undefined;
}
