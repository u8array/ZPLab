import { bytesToLatin1 } from "@zplab/core/lib/binaryText";
import { unsafeRawFieldSpans } from "@zplab/core/lib/zplParser/helpers";

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

/** UTF-8 when valid, else byte-per-char. */
function decodeTextGap(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytesToLatin1(bytes);
  }
}

/** BOM-declared encoding first (readAsText sniffed these too); raw counted
 *  payload spans stay byte-per-char (a valid-UTF-8 pair must not collapse to
 *  one char), the text between them decodes normally. */
export function zplBytesToText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const raw = bytesToLatin1(bytes);
  const spans = unsafeRawFieldSpans(raw);
  if (spans.length === 0) return decodeTextGap(bytes);
  let out = "";
  let cursor = 0;
  for (const sp of spans) {
    out += decodeTextGap(bytes.subarray(cursor, sp.dataStart));
    out += raw.slice(sp.dataStart, sp.end);
    cursor = sp.end;
  }
  return out + decodeTextGap(bytes.subarray(cursor));
}

/** ZPL streams may carry raw binary ^GF/~DY payloads that readAsText would
 *  destroy. */
export function readFileAsZplText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) =>
      resolve(zplBytesToText(new Uint8Array(e.target?.result as ArrayBuffer)));
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}
