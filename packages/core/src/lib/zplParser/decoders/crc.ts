import { BITS_PER_BYTE } from "./constants";
import { bytesToLatin1 } from "../../binaryText";

const CRC16_POLY = 0x1021;
const CRC16_MSB_MASK = 0x8000;
const CRC16_MASK = 0xffff;

/**
 * CRC-16/XMODEM (poly 0x1021, init 0x0000, no reflect, no xorout):
 * Zebra's ZB64/ZB16 wrapper uses this variant. Computed over the
 * base64 (or hex) payload between the `:B64:`/`:Z64:` prefix and the
 * trailing `:CRC` suffix. (Note: this is *not* CRC-16/CCITT-FALSE,
 * which uses init=0xFFFF; empirically verified against Labelary.)
 */
function crc16Xmodem(s: string): number {
  let crc = 0;
  for (const ch of s) {
    crc ^= ch.charCodeAt(0) << BITS_PER_BYTE;
    for (let j = 0; j < BITS_PER_BYTE; j++) {
      crc = (crc & CRC16_MSB_MASK)
        ? ((crc << 1) ^ CRC16_POLY) & CRC16_MASK
        : (crc << 1) & CRC16_MASK;
    }
  }
  return crc;
}

/** Bytes -> `:B64:<base64>:<crc>` wrapper (spec p.1602): the text-safe form
 *  of a raw binary payload, decoded identically by firmware and re-import. */
export function wrapGfB64(bytes: Uint8Array): string {
  const b64 = btoa(bytesToLatin1(bytes));
  return `:B64:${b64}:${crc16Xmodem(b64).toString(16).padStart(CRC_HEX_DIGITS, "0").toUpperCase()}`;
}

type GfWrapperKind = "b64" | "z64";

export interface GfWrapperDecoded {
  kind: GfWrapperKind;
  /** Raw decoded bytes; for `:Z64:` this is still zlib-compressed. */
  bytes: Uint8Array;
  /** True if the trailing CRC matches the base64 payload. */
  crcOk: boolean;
}

const CRC_HEX_DIGITS = 4;
// \s in the base64 char class tolerates the line-break-every-N-chars
// formatting that some ZPL generators apply to long ^GF payloads.
const GF_WRAPPER_RE = new RegExp(
  `^:(B64|Z64):([A-Za-z0-9+/=\\s]+):([0-9A-Fa-f]{${CRC_HEX_DIGITS}})$`,
);

/** Decode a base64 string to bytes; empty array on malformed input. */
function base64ToBytes(b64: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return new Uint8Array(0);
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Parse a `:B64:<base64>:<crc>` or `:Z64:<base64>:<crc>` wrapper.
 * Returns null if the payload doesn't carry a wrapper. CRC mismatches
 * are surfaced as a flag rather than a hard reject; printers tolerate
 * mismatches, and we'd rather render a slightly-suspect graphic than
 * silently drop it.
 *
 * `payload.trim()` because real-world ZPL is often line-broken between
 * commands; the tokenizer keeps the trailing newline on `rest`.
 */
export function parseGfWrapper(payload: string): GfWrapperDecoded | null {
  const m = GF_WRAPPER_RE.exec(payload.trim());
  if (!m) return null;
  // atob and the CRC both fail on embedded whitespace; strip after
  // match so the regex stays permissive but downstream decoders see
  // pure base64.
  const b64 = (m[2] ?? "").replace(/\s/g, "");
  const declaredCrc = parseInt(m[3] ?? "0", 16);
  return {
    kind: (m[1] ?? "").toLowerCase() as GfWrapperKind,
    bytes: base64ToBytes(b64),
    crcOk: crc16Xmodem(b64) === declaredCrc,
  };
}
