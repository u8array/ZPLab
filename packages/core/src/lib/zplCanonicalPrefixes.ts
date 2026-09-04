import { applyPrefixRemap, PAYLOAD_CMDS, tokenize, type TokenizerChars } from "./zplParser/helpers";

/** Image and font payloads carry any byte, hex or binary, so their lines stay as typed. */
const BYTE_PAYLOAD_CMDS = new Set(["GF", "DY"]);

/** The same bytes with ^CC/^CT/^CD undone: every live prefix back to ^ or ~ and every
 *  parameter delimiter to a comma, data left alone, so texts compare across a remap.
 *  Length-preserving in UTF-16 units, the offsets every span is measured in. */
export function canonicalPrefixes(zpl: string): string {
  const st: TokenizerChars = { caretChar: "^", tildeChar: "~", delimiterChar: "," };
  let out: string[] | undefined;
  for (const t of tokenize(zpl, st)) {
    if (out) {
      out[t.start] = zpl[t.start] === st.caretChar ? "^" : "~";
      if (st.delimiterChar !== "," && !PAYLOAD_CMDS.has(t.cmd) && !BYTE_PAYLOAD_CMDS.has(t.cmd)) {
        for (let i = t.start + 3; i < t.end; i++) if (zpl[i] === st.delimiterChar) out[i] = ",";
      }
    }
    if (applyPrefixRemap(st, t.cmd, t.rest[0])) out ??= zpl.split("");
  }
  return out ? out.join("") : zpl;
}
