import { afterAll, describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { certificateTable, hasCertificateTable, stripCertificateTable, withoutCertificateTable } from "../../packages/mcp-server/scripts/pe.mjs";

const PE_AT = 0x80;
const OPTIONAL_AT = PE_AT + 4 + 20;
// PE32+ data directories start at optional header + 112, the Certificate Table is entry 4.
const DIRECTORY_AT = OPTIONAL_AT + 112 + 4 * 8;

/** A PE32+ image with a body and, when given, an Authenticode table the directory points at. */
function image(magic: number, body: Buffer, table?: { offset: number; length: number; bytes?: Buffer }): Buffer {
  const header = Buffer.alloc(OPTIONAL_AT + 240);
  header.write("MZ", 0, "latin1");
  header.writeUInt32LE(PE_AT, 0x3c);
  header.write("PE\0\0", PE_AT, "latin1");
  header.writeUInt16LE(magic, OPTIONAL_AT);
  if (table) {
    header.writeUInt32LE(table.offset, DIRECTORY_AT);
    header.writeUInt32LE(table.length, DIRECTORY_AT + 4);
  }
  return Buffer.concat([header, body, table?.bytes ?? Buffer.alloc(0)]);
}

const body = Buffer.alloc(64, 0xab);
const signature = Buffer.alloc(24, 0xcd);
const signedAt = OPTIONAL_AT + 240 + body.length;

const scratch = mkdtempSync(join(tmpdir(), "pe-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the Authenticode table of a PE32+ image", () => {
  it("is cut off together with its directory entry when it closes the file", () => {
    const signed = image(0x20b, body, { offset: signedAt, length: signature.length, bytes: signature });
    expect(certificateTable(signed)).toEqual({ offset: signedAt, length: 24 });
    const stripped = withoutCertificateTable(signed);
    expect(stripped.length).toBe(signedAt);
    expect(certificateTable(stripped)).toBeUndefined();
    expect(stripped.subarray(OPTIONAL_AT + 240)).toEqual(body);
    expect(certificateTable(signed)).toEqual({ offset: signedAt, length: 24 });
  });

  it("strips a file on disk and reports what it carries", () => {
    const file = join(scratch, "x.exe");
    writeFileSync(file, image(0x20b, body, { offset: signedAt, length: signature.length, bytes: signature }));
    expect(hasCertificateTable(file)).toBe(true);
    stripCertificateTable(file);
    expect(hasCertificateTable(file)).toBe(false);
    expect(statSync(file).size).toBe(signedAt);
  });

  /** Node's own signed image pins the directory offset the synthetic layout only asserts. */
  it("finds the table at the end of a real signed node.exe", () => {
    const real = readFileSync(process.execPath);
    const pe = real.length > 0x40 ? real.readUInt32LE(0x3c) : 0;
    const pe32Plus = pe > 0 && real.toString("latin1", pe, pe + 4) === "PE\0\0" && real.readUInt16LE(pe + 24) === 0x20b;
    const table = pe32Plus ? certificateTable(real) : undefined;
    if (!table) return;
    expect(table.offset + table.length).toBe(real.length);
  });

  it("leaves an unsigned image as it is", () => {
    const unsigned = image(0x20b, body);
    expect(certificateTable(unsigned)).toBeUndefined();
    expect(withoutCertificateTable(unsigned)).toBe(unsigned);
  });

  it("refuses to cut when the entry points inside the file, as it does after postject appends a section", () => {
    const grown = Buffer.concat([image(0x20b, body, { offset: signedAt, length: 24, bytes: signature }), Buffer.alloc(4096)]);
    expect(() => withoutCertificateTable(grown)).toThrow(/ends at/);
  });

  it("refuses images that are not PE32+", () => {
    expect(() => certificateTable(image(0x10b, body))).toThrow(/PE32\+/);
    expect(() => certificateTable(Buffer.from("not an image"))).toThrow(/not a PE/);
  });
});
