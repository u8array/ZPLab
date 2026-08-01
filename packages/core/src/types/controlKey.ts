/** Reserved control-key marker grammar: `ctrl:` plus a catalogued key name
 *  (e.g. `ctrl:TAB`). Chips resolve to their control byte at emit/encode via
 *  ^FH hex escaping; scanner keyboard-wedge setups use them to jump form
 *  fields (TAB) or submit (CR). Lives in the types base layer like
 *  `clockMarker` so `types/Variable`'s name guard can consume it. */

/** Key name -> control byte. Small catalogue on purpose: the scanner-relevant
 *  whitespace keys plus the AIM data separators. */
export const CONTROL_KEYS = {
  TAB: "\x09",
  CR: "\x0D",
  LF: "\x0A",
  GS: "\x1D",
  FS: "\x1C",
} as const;

export type ControlKeyName = keyof typeof CONTROL_KEYS;

export const CONTROL_KEY_NAMES = Object.keys(CONTROL_KEYS) as ControlKeyName[];

const CTRL_BODY_SRC = `ctrl:(${CONTROL_KEY_NAMES.join("|")})`;

/** Whole-string match: the entire marker body IS a control key. */
export const CTRL_BODY_RE = new RegExp(`^${CTRL_BODY_SRC}$`);

/** Fresh global regex per call (stateful `lastIndex`, so never share one). */
export const ctrlMarkerReGlobal = (): RegExp => new RegExp(`«${CTRL_BODY_SRC}»`, "g");

export function controlKeyBody(key: ControlKeyName): string {
  return `ctrl:${key}`;
}

/** Key name from a marker body (`ctrl:TAB` -> `TAB`), inverse of controlKeyBody. */
export function controlKeyFromBody(body: string): string {
  return body.slice("ctrl:".length);
}

export function isControlBody(body: string): boolean {
  return CTRL_BODY_RE.test(body);
}

export function hasControlMarkers(content: string): boolean {
  return ctrlMarkerReGlobal().test(content);
}

/** `«ctrl:TAB»` -> raw control byte, for emit and canvas encode. */
export function resolveControlMarkers(content: string): string {
  return content.replace(ctrlMarkerReGlobal(), (_m, key: ControlKeyName) => CONTROL_KEYS[key]);
}

const byteToKey = new Map<string, ControlKeyName>(
  CONTROL_KEY_NAMES.map((k) => [CONTROL_KEYS[k], k]),
);
// Derived from the catalogue so a new key cannot desync the import side.
const CTRL_BYTE_RE = new RegExp(`[${Object.values(CONTROL_KEYS).join("")}]`, "g");

// eslint-disable-next-line no-control-regex
const ANY_C0_RE = /[\x00-\x1F\x7F]/g;

/** True when `content` holds at least one control byte and every one of them is
 *  catalogued, i.e. the whole string survives the chip round-trip. */
export function controlBytesAllCatalogued(content: string): boolean {
  const found = content.match(ANY_C0_RE);
  return !!found && found.every((ch) => byteToKey.has(ch));
}

/** Raw control byte -> `«ctrl:…»` chip, the import symmetry of
 *  {@link resolveControlMarkers}. Only catalogued bytes tokenise. */
export function controlBytesToMarkers(content: string): string {
  return content.replace(CTRL_BYTE_RE, (ch) => `«ctrl:${byteToKey.get(ch) ?? ""}»`);
}
