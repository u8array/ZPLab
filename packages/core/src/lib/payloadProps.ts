import { isGroup, type LabelObject } from "../types/Group";

/** Props a field's handler reads from its ^FD payload rather than from the field's commands. */
const PAYLOAD_PROPS: Record<string, readonly string[]> = {
  qrcode: ["errorCorrection"],
  datamatrix: ["gs1"],
  symbol: ["symbol"],
};

/** Types whose emitter and renderer read the payload from `content`, so the template keeps its own prop. */
const CONTENT_CARRIES = new Set(["symbol"]);

/** The payload-decided props of an object, empty for groups and for types that read none. */
export function payloadSettings(o: LabelObject): Record<string, unknown> {
  if (isGroup(o) || CONTENT_CARRIES.has(o.type)) return {};
  const props = o.props as unknown as Record<string, unknown>;
  return Object.fromEntries((PAYLOAD_PROPS[o.type] ?? []).flatMap((key) => (key in props ? [[key, props[key]]] : [])));
}

const sorted = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** What prints for an object apart from its data: everything the commands and the stream state decided.
 *  `anchor` stands in for the model position, see the parser's anchorById. */
export function printShape(o: LabelObject, anchor?: readonly [number, number]): string {
  const { id: _id, ...rest } = o;
  if (isGroup(o)) return JSON.stringify(sorted(rest as unknown as Record<string, unknown>));
  const skipped = new Set(["content", ...(PAYLOAD_PROPS[o.type] ?? [])]);
  const props = sorted(Object.fromEntries(Object.entries(o.props as unknown as Record<string, unknown>).filter(([key]) => !skipped.has(key))));
  const at = anchor ? { x: anchor[0], y: anchor[1] } : {};
  return JSON.stringify(sorted({ ...rest, ...at, props }));
}
