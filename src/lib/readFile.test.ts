import { describe, it, expect } from "vitest";
import { zplBytesToText } from "./readFile";

describe("zplBytesToText", () => {
  it("decodes valid UTF-8 normally", () => {
    const bytes = new TextEncoder().encode("^XA^FDÄhreü^FS^XZ");
    expect(zplBytesToText(bytes)).toBe("^XA^FDÄhreü^FS^XZ");
  });

  it("reads a raw binary field byte-per-char even when the file is valid UTF-8", () => {
    // C3 A9 is a valid UTF-8 pair; collapsing it to one char would shift the
    // byte-counted payload span.
    const head = "^XA^FO0,0^GFB,8,8,1,";
    const tail = "^FS^XZ";
    const payload = [0xc3, 0xa9, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46];
    const bytes = new Uint8Array([
      ...Array.from(head, (c) => c.charCodeAt(0)),
      ...payload,
      ...Array.from(tail, (c) => c.charCodeAt(0)),
    ]);
    const text = zplBytesToText(bytes);
    expect(text.length).toBe(bytes.length);
    expect(text.charCodeAt(head.length)).toBe(0xc3);
  });

  it("threads ^CD remaps when sniffing raw binary fields", () => {
    // A remapped delimiter must not hide the field from the byte-per-char
    // decision; the sniffer walks the same tokenizer as the parser.
    const head = "^XA^CD;^GFB;8;8;1;";
    const tail = "^FS^XZ";
    const payload = [0xc3, 0xa9, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46];
    const bytes = new Uint8Array([
      ...Array.from(head, (c) => c.charCodeAt(0)),
      ...payload,
      ...Array.from(tail, (c) => c.charCodeAt(0)),
    ]);
    expect(zplBytesToText(bytes).length).toBe(bytes.length);
  });

  it("decodes text gaps as UTF-8 while payload spans stay byte-per-char", () => {
    // Mixed stream: the ^FD text keeps its encoding, the counted payload its
    // bytes; neither may bleed into the other.
    const A_UML = [0xc3, 0x84];
    const head = "^XA^CI28^FD";
    const mid = "hre^FS^GFB,8,8,1,";
    const payload = [0xc3, 0xa9, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46];
    const tail = "^FS^XZ";
    const bytes = new Uint8Array([
      ...Array.from(head, (c) => c.charCodeAt(0)),
      ...A_UML,
      ...Array.from(mid, (c) => c.charCodeAt(0)),
      ...payload,
      ...Array.from(tail, (c) => c.charCodeAt(0)),
    ]);
    const text = zplBytesToText(bytes);
    expect(text).toContain("^FD" + String.fromCharCode(0xc4) + "hre");
    const at = text.indexOf("^GFB,8,8,1,") + "^GFB,8,8,1,".length;
    expect(Array.from(text.slice(at, at + 8), (c) => c.charCodeAt(0))).toEqual(payload);
  });

  it("honours a UTF-16 BOM like readAsText did", () => {
    const chars = "^XA^FDX^FS^XZ";
    const bytes = new Uint8Array(2 + chars.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < chars.length; i++) bytes[2 + i * 2] = chars.charCodeAt(i);
    expect(zplBytesToText(bytes)).toBe(chars);
  });

  it("falls back to byte-per-char for invalid UTF-8 (raw binary payloads)", () => {
    // 0x80-0x9F must survive identically; TextDecoder latin1 labels alias
    // windows-1252 and would remap them.
    const bytes = new Uint8Array([0x5e, 0x47, 0x46, 0x42, 0x80, 0x9f, 0xff, 0x00]);
    const text = zplBytesToText(bytes);
    expect(Array.from(text, (c) => c.charCodeAt(0))).toEqual(Array.from(bytes));
  });
});
