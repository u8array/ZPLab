// Split out of build-sea.mjs so peScripts.test.ts can check the header arithmetic on a synthetic binary.
import { readFileSync, writeFileSync } from "node:fs";

const E_LFANEW = 0x3c;
const PE32_PLUS = 0x20b;
// Data directory 4, at optional header + 112 + 4 * 8, holding a file offset rather than an RVA.
const CERTIFICATE_DIRECTORY = 144;

function certificateDirectoryAt(image) {
  const pe = image.length >= E_LFANEW + 4 ? image.readUInt32LE(E_LFANEW) : 0;
  if (pe === 0 || image.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("not a PE image");
  const optional = pe + 4 + 20;
  if (image.readUInt16LE(optional) !== PE32_PLUS) throw new Error("not a PE32+ image");
  return optional + CERTIFICATE_DIRECTORY;
}

/** The Authenticode table an image carries, undefined when it has none. */
export function certificateTable(image) {
  const at = certificateDirectoryAt(image);
  const offset = image.readUInt32LE(at);
  const length = image.readUInt32LE(at + 4);
  return offset === 0 && length === 0 ? undefined : { offset, length };
}

/** The image without its Authenticode table. The table must close the file, so nothing but the signature is cut. */
export function withoutCertificateTable(image) {
  const table = certificateTable(image);
  if (!table) return image;
  if (table.offset + table.length !== image.length) {
    throw new Error(`certificate table ends at ${table.offset + table.length}, file at ${image.length}`);
  }
  const stripped = Buffer.from(image.subarray(0, table.offset));
  const at = certificateDirectoryAt(stripped);
  stripped.fill(0, at, at + 8);
  return stripped;
}

export function stripCertificateTable(file) {
  writeFileSync(file, withoutCertificateTable(readFileSync(file)));
}

export function hasCertificateTable(file) {
  return certificateTable(readFileSync(file)) !== undefined;
}
