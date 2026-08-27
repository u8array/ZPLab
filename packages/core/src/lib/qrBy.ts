// Lives in lib so both registry/qrcode and lib/qrGraphic may import it
// without a registry<->lib cycle.

/** ZPL power-up value of ^BY h (spec p.148); also what Labelary simulates. */
export const QR_BY_DEFAULT_HEIGHT = 10;

/** The one answer to "does this pin a ^BY height": positive integer. The spec
 *  states no upper bound for ^BY h, and imports must round-trip whatever the
 *  source printed with, so none is invented here. */
export function isQrByHeight(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

/** Effective ^BY height: the pinned prop or the power-up default. Also the
 *  ^FO sink distance (see QrCodeProps.byHeight); render, bounds, drag inverse,
 *  rescale and the emit all read this one function. */
export function qrByHeight(props: { byHeight?: number }): number {
  return props.byHeight ?? QR_BY_DEFAULT_HEIGHT;
}
