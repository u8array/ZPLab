import { describe, it, expect } from "vitest";
import {
  parseCsvFile,
  parseCsvText,
  rememberImport,
  forgetImport,
  decodeImportedText,
  getImportedBytes,
} from "./csvImport";

function fileOf(text: string, name = "test.csv"): File {
  return new File([text], name, { type: "text/csv" });
}

describe("parseCsvFile", () => {
  it("parses headers + rows from a simple comma-delimited CSV", async () => {
    const file = fileOf("sku,qty\nA1,10\nB2,5\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(["sku", "qty"]);
    expect(result.value.rows).toEqual([
      ["A1", "10"],
      ["B2", "5"],
    ]);
    expect(result.value.source.filename).toBe("test.csv");
    expect(result.value.source.rowCount).toBe(2);
  });

  it("pads ragged rows to header length", async () => {
    const file = fileOf("a,b,c\n1,2\n4,5,6\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toEqual([
      ["1", "2", ""],
      ["4", "5", "6"],
    ]);
  });

  it("truncates rows that are longer than headers", async () => {
    const file = fileOf("a,b\n1,2,3\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toEqual([["1", "2"]]);
  });

  it("auto-detects semicolon delimiter (Excel-locale CSVs)", async () => {
    const file = fileOf("sku;qty\nA1;10\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(["sku", "qty"]);
    expect(result.value.source.delimiter).toBe(";");
  });

  it("returns 'empty' for a zero-byte file", async () => {
    const file = fileOf("");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty");
  });

  it("preserves quoted values containing the delimiter", async () => {
    const file = fileOf('name,note\n"Smith, J.","hi, there"\n');
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows[0]).toEqual(["Smith, J.", "hi, there"]);
  });

  it("returns header-only CSV with zero rows (not an error)", async () => {
    const file = fileOf("sku,qty\n");
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(["sku", "qty"]);
    expect(result.value.rows).toEqual([]);
    expect(result.value.source.rowCount).toBe(0);
  });
});

describe('parseCsvText options', () => {
  it('skipRows discards leading rows before treating the next as header', () => {
    const text = 'Preamble line\nMore preamble\nsku,qty\nA1,10\n';
    const result = parseCsvText(text, { skipRows: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(['sku', 'qty']);
    expect(result.value.rows).toEqual([['A1', '10']]);
  });

  it('hasHeaderRow=false synthesises Column N names', () => {
    const text = 'A1,10\nB2,5\n';
    const result = parseCsvText(text, { hasHeaderRow: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(['Column 1', 'Column 2']);
    expect(result.value.rows).toEqual([['A1', '10'], ['B2', '5']]);
  });

  it('skipRows + headerless combines correctly', () => {
    const text = 'Preamble\nA1,10\nB2,5\n';
    const result = parseCsvText(text, { skipRows: 1, hasHeaderRow: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(['Column 1', 'Column 2']);
    expect(result.value.rows).toEqual([['A1', '10'], ['B2', '5']]);
  });

  it('skipRows greater than row count returns empty', () => {
    const text = 'a,b\n1,2\n';
    const result = parseCsvText(text, { skipRows: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('empty');
  });

  it('headerless with ragged rows uses max width for synthetic headers', () => {
    const text = 'A1\nB2,5,extra\n';
    const result = parseCsvText(text, { hasHeaderRow: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
    expect(result.value.rows).toEqual([
      ['A1', '', ''],
      ['B2', '5', 'extra'],
    ]);
  });

  it('names the columns of a very long file without a header row', () => {
    const result = parseCsvText('a,b\n'.repeat(200_000), { hasHeaderRow: false });
    expect(result.ok && result.value.headers).toEqual(['Column 1', 'Column 2']);
  });
});

describe('encoding cache', () => {
  it('decodeImportedText returns null when no import is cached', () => {
    forgetImport();
    expect(decodeImportedText('utf-8')).toBeNull();
  });

  it('rememberImport + decodeImportedText round-trips UTF-8', () => {
    const bytes = new TextEncoder().encode('sku,qty\n');
    rememberImport(bytes);
    expect(getImportedBytes()).toBe(bytes);
    expect(decodeImportedText('utf-8')).toBe('sku,qty\n');
    forgetImport();
  });

  it('decodeImportedText with windows-1252 turns 0xE4 into ä', () => {
    // 0xE4 in windows-1252 (ANSI) is "ä". The same byte in UTF-8 is
    // a continuation byte (invalid as a standalone), so the two
    // decodings of the same bytes should differ.
    const bytes = new Uint8Array([0x73, 0xE4, 0x6F]); // s ä o (CP1252)
    rememberImport(bytes);
    expect(decodeImportedText('windows-1252')).toBe('säo');
    forgetImport();
  });

  it('re-decoding to utf-8 rescues a file first imported under cp1252', () => {
    // Bytes are valid UTF-8 for "café". The modal always re-decodes from bytes,
    // so switching to utf-8 recovers the original even after a cp1252 import.
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9]); // café in UTF-8
    rememberImport(bytes);
    expect(decodeImportedText('utf-8')).toBe('café');
    forgetImport();
  });

  it('forgetImport clears the cache', () => {
    rememberImport(new Uint8Array([1, 2, 3]));
    forgetImport();
    expect(getImportedBytes()).toBeNull();
    expect(decodeImportedText('utf-8')).toBeNull();
  });
});
